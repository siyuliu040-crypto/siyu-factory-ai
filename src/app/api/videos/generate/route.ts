import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";
import {
  AccountError,
  chargeUserCredits,
  refundCreditsForUser,
  recordGenerationHistory,
  recordGenerationTask,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";
import { getVideoGenerationCost } from "@/lib/pricing";
import { extractVideoUrl } from "@/lib/video-status";
import { isViduModel, parseViduResponse, toViduModel, VIDU_BASE_URL, viduHeaders } from "@/lib/vidu";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const UPLOAD_DIR = "/tmp/siyu-factory-uploads";
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
const VIDU_SIZE_TO_RESOLUTION: Record<string, string> = {
  "720x1280": "720p",
  "1080x1920": "1080p"
};

function getPublicBaseUrl(request: Request) {
  if (process.env.SIYU_PUBLIC_BASE_URL) {
    return process.env.SIYU_PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

async function fileToPublicUrl(request: Request, file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type || "image/jpeg";
  const extension = MIME_EXTENSIONS[mediaType] || "jpg";
  const id = `${randomUUID()}.${extension}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, id), buffer);
  return `${getPublicBaseUrl(request)}/api/uploads/${id}`;
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type || "image/jpeg";
  return `data:${mediaType};base64,${buffer.toString("base64")}`;
}

function getTaskId(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return String(record.task_id || record.id || record.video_id || "");
}

function isImmediateFailure(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const code = String(record.code || record.error || "");
  return Boolean(code && !getTaskId(payload));
}

async function postVideoPayload(
  payload: Record<string, unknown>,
  billing: { userId: string; amount: number; model: string }
) {
  const response = await fetch(`${HELLOBABYGO_BASE_URL}/v1/videos`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const data = await parseUpstreamResponse(response);
  const taskId = getTaskId(data);

  if (!response.ok || isImmediateFailure(data)) {
    await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", {
      model: billing.model
    });
    return Response.json(data, { status: response.status });
  }

  if (taskId) {
    await withAccountState((state) => {
      recordGenerationTask(state, {
        id: taskId,
        userId: billing.userId,
        type: "video",
        model: billing.model,
        amount: billing.amount
      });
      recordGenerationHistory(state, {
        userId: billing.userId,
        type: "video",
        model: billing.model,
        prompt: String(payload.prompt || ""),
        taskId,
        status: String((data as { status?: unknown })?.status || "queued"),
        previewUrl: extractVideoUrl(data) || undefined
      });
    });
  }

  return Response.json(
    {
      ...(typeof data === "object" && data ? data : { data }),
      charged: billing.amount
    },
    { status: response.status }
  );
}

async function postViduPayload(
  payload: Record<string, unknown>,
  billing: { userId: string; amount: number; model: string }
) {
  const response = await fetch(`${VIDU_BASE_URL}/ent/v2/img2video`, {
    method: "POST",
    headers: viduHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const data = await parseViduResponse(response);
  const taskId = getTaskId(data);

  if (!response.ok || !taskId) {
    await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", {
      model: billing.model
    });
    return Response.json(data, { status: response.status });
  }

  await withAccountState((state) => {
    recordGenerationTask(state, {
      id: taskId,
      userId: billing.userId,
      type: "video",
      model: billing.model,
      amount: billing.amount
    });
    recordGenerationHistory(state, {
      userId: billing.userId,
      type: "video",
      model: billing.model,
      prompt: String(payload.prompt || ""),
      taskId,
      status: String((data as { state?: unknown })?.state || "queued")
    });
  });

  return Response.json(
    {
      ...(typeof data === "object" && data ? data : { data }),
      id: taskId,
      task_id: taskId,
      status: String((data as { state?: unknown })?.state || "queued").toLowerCase(),
      provider: "vidu",
      charged: billing.amount
    },
    { status: response.status }
  );
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const model = String(incoming.get("model") || "");
    const prompt = String(incoming.get("prompt") || "").trim();

    if (!model || !prompt) {
      return jsonError({ error: "model and prompt are required" }, 400);
    }

    const seconds = incoming.get("seconds");
    const size = incoming.get("size");
    const imageUrl = incoming.get("image_url");
    const references = incoming
      .getAll("input_reference")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const uploadedReferenceUrls = isViduModel(model)
      ? []
      : await Promise.all(references.map((reference) => fileToPublicUrl(request, reference)));
    const referenceUrls = [
      ...(imageUrl ? [String(imageUrl)] : []),
      ...uploadedReferenceUrls
    ].filter(Boolean);
    const amount = getVideoGenerationCost(model, String(seconds || ""));
    const charge = await chargeUserCredits(request, amount, "video generation", { model, size: String(size || "") });
    const billing = { userId: charge.user.id, amount, model };

    if (isViduModel(model)) {
      const firstReference = references[0];
      const firstImage = firstReference ? await fileToDataUrl(firstReference) : String(imageUrl || "");
      if (!firstImage) {
        await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", { model });
        return jsonError({ error: "Vidu image-to-video requires one reference image." }, 400);
      }

      return postViduPayload(
        {
          model: toViduModel(model),
          images: [firstImage],
          prompt,
          resolution: VIDU_SIZE_TO_RESOLUTION[String(size || "")] || "720p",
          movement_amplitude: "auto",
          watermark: false,
          audio: false
        },
        billing
      );
    }

    if (references.length === 0) {
      return await postVideoPayload(
        {
          model,
          prompt,
          ...(seconds ? { seconds: String(seconds) } : {}),
          ...(size ? { size: String(size) } : {}),
          ...(imageUrl
            ? { image_url: String(imageUrl), image_input: [String(imageUrl)], input_reference: String(imageUrl) }
            : {})
        },
        billing
      );
    }

    return await postVideoPayload(
      {
        model,
        prompt,
        ...(seconds ? { seconds: String(seconds) } : {}),
        ...(size ? { size: String(size) } : {}),
        image_url: referenceUrls[0],
        image_input: referenceUrls,
        input_reference: referenceUrls[0]
      },
      billing
    );
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    const detail = error instanceof Error ? error.message : error;
    return jsonError({
      error: "Video generation request failed",
      message:
        "Video generation failed before the upstream task was created. Try fewer or smaller reference images, then submit again.",
      detail
    });
  }
}
