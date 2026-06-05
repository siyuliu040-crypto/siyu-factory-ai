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

const VIDU_SIZE_TO_RESOLUTION: Record<string, string> = {
  "540x960": "540p",
  "720x1280": "720p",
  "1080x1920": "1080p"
};
const UPLOAD_DIR = "/tmp/siyu-factory-uploads";
const VERIFIED_VIDEO_MODELS = new Set([
  "sora-2-4s-9x16",
  "sora2-pro-12s-9x16",
  "veo_3_1-fast-portrait-fl-hd",
  "vidu:viduq3-pro-fast",
  "vidu:viduq3-turbo",
  "vidu:viduq3-pro",
  "grok-imagine-1.0-video-ref-6s",
  "grok-imagine-1.0-video-ref-10s"
]);
const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function getImageExtension(file: File) {
  const extensionFromType = IMAGE_EXTENSION_BY_TYPE[file.type];
  if (extensionFromType) return extensionFromType;
  const extensionFromName = path.extname(file.name || "").replace(".", "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(extensionFromName)) return extensionFromName;
  return "jpg";
}

async function fileToReferenceInput(file: File, origin: string) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type || "image/jpeg";
  const extension = getImageExtension(file);
  const id = `${randomUUID()}.${extension}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, id), buffer);
  return {
    dataUrl: `data:${mediaType};base64,${buffer.toString("base64")}`,
    publicUrl: `${origin.replace(/\/$/, "")}/api/uploads/${id}`
  };
}

function getPublicOrigin(request: Request) {
  const configured =
    process.env.PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    "";
  if (configured) return configured.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
  }

  const origin = new URL(request.url).origin.replace(/\/$/, "");
  if (origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("0.0.0.0")) {
    return "https://siyu-factory-ai.onrender.com";
  }
  return origin;
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

function referencePayloadFields(referenceUrls: string[]) {
  if (!referenceUrls.length) return {};
  const first = referenceUrls[0];
  return {
    image_url: first,
    image: first,
    input_reference: first,
    input_image: first,
    first_frame_image: first,
    first_frame_url: first,
    start_frame: first,
    start_frame_url: first,
    frame_image: first,
    frame_image_url: first,
    reference_image: first,
    image_input: referenceUrls,
    image_urls: referenceUrls,
    images: referenceUrls,
    input_images: referenceUrls,
    reference_images: referenceUrls,
    reference_image_urls: referenceUrls,
    frames: referenceUrls,
    frame_urls: referenceUrls
  };
}

function minimalReferencePayloadFields(referenceUrls: string[]) {
  if (!referenceUrls.length) return {};
  return { image_url: referenceUrls[0] };
}

function isGrokReferenceVideoModel(model: string) {
  return model === "grok-imagine-1.0-video-ref-6s" || model === "grok-imagine-1.0-video-ref-10s";
}

function requiresFirstFrame(model: string) {
  return model === "veo_3_1-fast-portrait-fl-hd";
}

function normalizeUpstreamVideoRequest(model: string, seconds: FormDataEntryValue | null) {
  if (model === "grok-imagine-1.0-video-ref-6s") {
    return { upstreamModel: "grok-imagine-1.0-video", seconds: "6" };
  }
  if (model === "grok-imagine-1.0-video-ref-10s") {
    return { upstreamModel: "grok-imagine-1.0-video", seconds: "10" };
  }
  if (model === "grok-imagine-1.0-video-6s") {
    return { upstreamModel: "grok-imagine-1.0-video", seconds: "6" };
  }
  if (model === "grok-imagine-1.0-video-10s") {
    return { upstreamModel: "grok-imagine-1.0-video", seconds: "10" };
  }
  return { upstreamModel: model, seconds: seconds ? String(seconds) : "" };
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
    if (!VERIFIED_VIDEO_MODELS.has(model)) {
      return jsonError({
        error: "model_unavailable",
        message: "This video model has been removed because it did not complete generation in testing."
      }, 400);
    }

    const secondsInput = incoming.get("seconds");
    const { upstreamModel, seconds } = normalizeUpstreamVideoRequest(model, secondsInput);
    const size = incoming.get("size");
    const imageUrl = incoming.get("image_url");
    const origin = getPublicOrigin(request);
    const references = incoming
      .getAll("input_reference")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const uploadedReferenceInputs = await Promise.all(references.map((reference) => fileToReferenceInput(reference, origin)));
    const dataReferenceUrls = [
      ...(imageUrl ? [String(imageUrl)] : []),
      ...uploadedReferenceInputs.map((input) => input.dataUrl)
    ].filter(Boolean);
    const publicReferenceUrls = [
      ...(imageUrl ? [String(imageUrl)] : []),
      ...uploadedReferenceInputs.map((input) => input.publicUrl)
    ].filter(Boolean);

    if (isGrokReferenceVideoModel(model) && publicReferenceUrls.length === 0) {
      return jsonError({ error: "This model requires one reference image." }, 400);
    }
    if (requiresFirstFrame(model) && publicReferenceUrls.length === 0) {
      return jsonError({
        error: "first_frame_required",
        message: "This VEO frame-to-video model requires at least one first-frame reference image."
      }, 400);
    }

    const amount = getVideoGenerationCost(model, String(seconds || ""), String(size || ""));
    const charge = await chargeUserCredits(request, amount, "video generation", { model, size: String(size || "") });
    const billing = { userId: charge.user.id, amount, model };

    if (isViduModel(upstreamModel)) {
      const firstImage = dataReferenceUrls[0] || "";
      if (!firstImage) {
        await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", { model });
        return jsonError({ error: "Vidu image-to-video requires one reference image." }, 400);
      }

      return postViduPayload(
        {
          model: toViduModel(upstreamModel),
          images: [firstImage],
          prompt,
          ...(seconds ? { duration: Number(seconds) } : {}),
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
          model: upstreamModel,
          prompt,
          ...(seconds ? { seconds: String(seconds) } : {}),
          ...(size ? { size: String(size) } : {}),
          ...(isGrokReferenceVideoModel(model)
            ? minimalReferencePayloadFields(publicReferenceUrls)
            : referencePayloadFields(publicReferenceUrls))
        },
        billing
      );
    }

    return await postVideoPayload(
      {
        model: upstreamModel,
        prompt,
        ...(seconds ? { seconds: String(seconds) } : {}),
        ...(size ? { size: String(size) } : {}),
        ...(isGrokReferenceVideoModel(model)
          ? minimalReferencePayloadFields(publicReferenceUrls)
          : referencePayloadFields(publicReferenceUrls))
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
