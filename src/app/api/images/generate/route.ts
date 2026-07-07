import { HELLOBABYGO_BASE_URL, authHeaders, jsonError } from "@/lib/hellobabygo";
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

type ImageGeneratePayload = {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  response_format?: "url" | "b64_json";
};

function parseUpstreamText(text: string, status: number) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return status >= 200 && status < 300 ? parsed : { ...parsed, upstream_status: status };
  } catch {
    return { error: "Image upstream request failed", upstream_status: status, detail: text };
  }
}

function extractImageUrl(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) return "";
  const item = data[0] as { url?: unknown; b64_json?: unknown } | undefined;
  if (typeof item?.url === "string") return item.url;
  if (typeof item?.b64_json === "string") return `data:image/png;base64,${item.b64_json}`;
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
        const response = await fetch(`${HELLOBABYGO_BASE_URL}${path}`, {
          ...init,
          cache: "no-store"
        });
        const text = await response.text();
        const payload = parseUpstreamText(text, response.status);
        clearInterval(keepAlive);
        if (!response.ok && billing) {
          await refundCreditsForUser(billing.userId, billing.amount, "image generation failed refund", { path });
        }
        if (response.ok && billing && history) {
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
          headers: authHeaders({ Accept: "application/json" }),
          body: formData
        }, billing, { model, prompt });
      }

      return streamUpstream("/v1/images/generations", {
        method: "POST",
        headers: authHeaders({
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
      headers: authHeaders({
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
