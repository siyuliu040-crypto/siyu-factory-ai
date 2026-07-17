import { jsonError } from "@/lib/hellobabygo";
import {
  AccountError,
  chargeUserCredits,
  recordGenerationHistory,
  refundCreditsForUser,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";
import { normalizeImageRequestForUpstream } from "@/lib/image-models";
import { getGenerationCost } from "@/lib/pricing";
import { getPromptLimit, isPromptTooLong } from "@/lib/prompt-limits";
import { getHfsyImageModel, HFSY_BASE_URL, hfsyHeaders, isHfsyImageModel } from "@/lib/hfsy";

type ImageGeneratePayload = {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  response_format?: "url" | "b64_json";
};

const IMAGE_STATUS_POLL_INTERVAL_MS = 5000;
const IMAGE_STATUS_MAX_ATTEMPTS = 180;

function parseUpstreamText(text: string, status: number) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return status >= 200 && status < 300 ? parsed : { ...parsed, upstream_status: status };
  } catch {
    return { error: "Image upstream request failed", upstream_status: status, detail: text };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getImageTaskId(payload: unknown) {
  if (!isRecord(payload)) return "";
  const data = isRecord(payload.data) ? payload.data : {};
  return String(payload.task_id || payload.id || data.task_id || data.id || "");
}

function normalizeImageStatus(payload: unknown) {
  if (!isRecord(payload)) return "completed";
  const raw = String(payload.status || "").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(raw)) return "completed";
  if (["failed", "fail", "error", "cancelled", "canceled"].includes(raw)) return "failed";
  if (["queued", "pending", "processing", "running", "in_progress", "generating"].includes(raw)) return "in_progress";
  return extractImageUrl(payload) ? "completed" : "in_progress";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForImageCompletion(initialPayload: unknown) {
  const taskId = getImageTaskId(initialPayload);
  const initialStatus = normalizeImageStatus(initialPayload);
  if (!taskId || initialStatus === "completed" || initialStatus === "failed") return initialPayload;

  let lastPayload = initialPayload;
  for (let attempt = 0; attempt < IMAGE_STATUS_MAX_ATTEMPTS; attempt += 1) {
    await wait(IMAGE_STATUS_POLL_INTERVAL_MS);
    const response = await fetch(`${HFSY_BASE_URL}/v1/images/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: hfsyHeaders({ Accept: "application/json" }),
      cache: "no-store"
    });
    const payload = parseUpstreamText(await response.text(), response.status);
    lastPayload = payload;
    if (!response.ok) return payload;
    const status = normalizeImageStatus(payload);
    if (status === "completed" || status === "failed") return payload;
  }

  return {
    error: "Image task is still processing after the site polling window.",
    status: "failed",
    task_id: taskId,
    upstream: lastPayload
  };
}

function extractImageUrl(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const data = (result as { data?: unknown }).data;
  const item = Array.isArray(data) ? data[0] as { url?: unknown; b64_json?: unknown } | undefined : undefined;
  if (typeof item?.url === "string") return item.url;
  if (typeof item?.b64_json === "string") return `data:image/png;base64,${item.b64_json}`;
  const fallback = findImageUrl(result);
  if (fallback) return fallback;
  return "";
}

function findImageUrl(value: unknown, seen = new Set<unknown>()): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (/^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(value)) return value;
    if (/^data:image\//i.test(value)) return value;
    return "";
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ["url", "image_url", "output_url", "result_url", "previewUrl"]) {
    const found = findImageUrl(record[key], seen);
    if (found) return found;
  }
  const b64 = record.b64_json || record.base64 || record.image_base64;
  if (typeof b64 === "string" && b64.length > 100) return `data:image/png;base64,${b64}`;
  for (const nested of Object.values(record)) {
    const found = findImageUrl(nested, seen);
    if (found) return found;
  }
  return "";
}

function streamUpstream(
  path: string,
  init: RequestInit,
  billing?: { userId: string; amount: number },
  history?: { model: string; prompt: string }
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(" "));
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(" "));
      }, 5000);

      try {
        const response = await fetch(`${HFSY_BASE_URL}${path}`, {
          ...init,
          cache: "no-store"
        });
        const text = await response.text();
        const parsedPayload = parseUpstreamText(text, response.status);
        const payload = response.ok ? await waitForImageCompletion(parsedPayload) : parsedPayload;
        clearInterval(keepAlive);
        if ((!response.ok || normalizeImageStatus(payload) === "failed") && billing) {
          await refundCreditsForUser(billing.userId, billing.amount, "image generation failed refund", { path });
        }
        if (response.ok && normalizeImageStatus(payload) === "completed" && billing && history) {
          await withAccountState((state) =>
            recordGenerationHistory(state, {
              userId: billing.userId,
              type: "image",
              model: history.model,
              prompt: history.prompt,
              previewUrl: extractImageUrl(payload) || undefined,
              status: "completed"
            })
          );
        }
        controller.enqueue(encoder.encode(JSON.stringify(payload)));
      } catch (error) {
        clearInterval(keepAlive);
        if (billing) {
          await refundCreditsForUser(billing.userId, billing.amount, "image generation failed refund", { path });
        }
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: "Image generation request failed",
              detail: error instanceof Error ? error.message : error
            })
          )
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const incoming = await request.formData();
      const model = String(incoming.get("model") || "");
      const prompt = String(incoming.get("prompt") || "").trim();

      if (!model || !prompt) {
        return jsonError({ error: "model and prompt are required" }, 400);
      }
      if (!isHfsyImageModel(model)) {
        return jsonError({
          error: "unsupported_image_model",
          message: "Only HFSY image models are enabled on this site."
        }, 400);
      }
      if (isPromptTooLong(model, prompt, "image")) {
        return jsonError({
          error: "prompt_too_long",
          message: `This image model supports up to ${getPromptLimit(model, "image")} prompt characters. Shorten the prompt and try again.`
        }, 400);
      }
      const amount = getGenerationCost(model, Number(incoming.get("n") || 1));
      const upstream = normalizeImageRequestForUpstream({
        model,
        size: String(incoming.get("size") || "1024x1024"),
        aspect_ratio: incoming.get("aspect_ratio") ? String(incoming.get("aspect_ratio")) : undefined
      });
      const charge = await chargeUserCredits(request, amount, "image generation", {
        model,
        size: String(incoming.get("size") || "1024x1024")
      });
      const billing = { userId: charge.user.id, amount };

      const references = incoming
        .getAll("image")
        .filter((value): value is File => value instanceof File && value.size > 0);
      const hfsyImageModel = getHfsyImageModel(model);

      if (references.length > 0 && hfsyImageModel?.referenceMode === "text-only") {
        return jsonError({
          error: "reference_not_supported",
          message: "This HFSY image model only supports prompt-only image generation. Use Nano Banana for reference-image generation."
        }, 400);
      }

      if (references.length > 0) {
        const formData = new FormData();
        formData.set("model", upstream.model);
        formData.set("prompt", prompt);
        formData.set("n", String(incoming.get("n") || "1"));
        formData.set("size", upstream.size || "1024x1024");
        if (upstream.aspect_ratio) formData.set("aspect_ratio", upstream.aspect_ratio);
        formData.set("response_format", String(incoming.get("response_format") || "url"));

        for (const [index, reference] of references.entries()) {
          formData.append("image", reference, reference.name || `reference-${index + 1}.png`);
        }

        return streamUpstream("/v1/images/edits", {
          method: "POST",
          headers: hfsyHeaders({ Accept: "application/json" }),
          body: formData
        }, billing, { model, prompt });
      }

      return streamUpstream("/v1/images/generations", {
        method: "POST",
        headers: hfsyHeaders({
          "Content-Type": "application/json",
          Accept: "application/json"
        }),
        body: JSON.stringify({
          model: upstream.model,
          prompt,
          n: Number(incoming.get("n") || 1),
          size: upstream.size || "1024x1024",
          ...(upstream.aspect_ratio ? { aspect_ratio: upstream.aspect_ratio } : {}),
          response_format: String(incoming.get("response_format") || "url")
        })
      }, billing, { model, prompt });
    }

    const body = (await request.json()) as ImageGeneratePayload;

    if (!body.model || !body.prompt?.trim()) {
      return jsonError({ error: "model and prompt are required" }, 400);
    }
    if (!isHfsyImageModel(body.model)) {
      return jsonError({
        error: "unsupported_image_model",
        message: "Only HFSY image models are enabled on this site."
      }, 400);
    }
    if (isPromptTooLong(body.model, body.prompt.trim(), "image")) {
      return jsonError({
        error: "prompt_too_long",
        message: `This image model supports up to ${getPromptLimit(body.model, "image")} prompt characters. Shorten the prompt and try again.`
      }, 400);
    }
    const amount = getGenerationCost(body.model, body.n ?? 1);
    const upstream = normalizeImageRequestForUpstream({
      model: body.model,
      size: body.size,
      aspect_ratio: body.aspect_ratio
    });
    const charge = await chargeUserCredits(request, amount, "image generation", {
      model: body.model,
      size: body.size
    });

    return streamUpstream("/v1/images/generations", {
      method: "POST",
      headers: hfsyHeaders({
        "Content-Type": "application/json",
        Accept: "application/json"
      }),
      body: JSON.stringify({
        model: upstream.model,
        prompt: body.prompt.trim(),
        n: body.n ?? 1,
        size: upstream.size ?? "1024x1024",
        ...(upstream.aspect_ratio ? { aspect_ratio: upstream.aspect_ratio } : {}),
        response_format: body.response_format ?? "url"
      })
    }, { userId: charge.user.id, amount }, { model: body.model, prompt: body.prompt.trim() });
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({
      error: "Image generation request failed",
      detail: error instanceof Error ? error.message : error
    });
  }
}
