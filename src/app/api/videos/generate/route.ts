import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";
import {
  AccountError,
  chargeUserCredits,
  readAccountState,
  refundCreditsForUser,
  recordGenerationHistory,
  recordGenerationTask,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";
import {
  getHfsyModel,
  getHfsyTaskId,
  hfsyHeaders,
  HFSY_BASE_URL,
  HFSY_MODELS,
  isHfsyModel,
  parseHfsyResponse
} from "@/lib/hfsy";
import { getVideoGenerationCost } from "@/lib/pricing";
import { getPromptLimit } from "@/lib/prompt-limits";
import {
  getSyCredentials,
  getSyModel,
  getSyTaskId,
  isSyModel,
  parseSyResponse,
  SY_BASE_URL,
  SY_MODELS,
  syModelSupportsEndFrame
} from "@/lib/sy";
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
  "veo_3_1-fast-portrait-fl-hd",
  "sora-2-4s-9x16",
  "sora-2-8s-9x16",
  "vidu:viduq3-pro-fast",
  "vidu:viduq3-turbo",
  "vidu:viduq3-pro",
  "grok-imagine-1.0-video-ref-6s",
  "grok-imagine-1.0-video-ref-10s",
  ...HFSY_MODELS.map((model) => model.id),
  ...SY_MODELS.map((model) => model.id)
]);
const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};
type VideoBilling = { userId: string; amount: number; model: string; originalPrompt?: string };

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

function stringifyPayload(payload: unknown) {
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function isHfsyFusionModel(model: string) {
  return model === "hfsy:sd-2-fast" || model === "hfsy:sd-2" || model === "hfsy:sd-2-vip";
}

async function getActiveHfsyFusionTask(model: string) {
  if (!isHfsyFusionModel(model)) return null;
  const state = await readAccountState(true);
  const cutoff = Date.now() - 20 * 60 * 1000;
  return state.generationTasks.find((task) => {
    if (!isHfsyFusionModel(task.model)) return false;
    if (task.status !== "queued" && task.status !== "in_progress") return false;
    const createdAt = Date.parse(task.createdAt);
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  }) || null;
}

async function getRecentHfsyFusionAccountBlock(model: string) {
  if (!isHfsyFusionModel(model)) return null;
  const state = await readAccountState(true);
  const cutoff = Date.now() - 30 * 60 * 1000;
  return state.history.find((item) => {
    if (!isHfsyFusionModel(item.model)) return false;
    const updatedAt = Date.parse(item.updatedAt || item.createdAt);
    if (!Number.isFinite(updatedAt) || updatedAt < cutoff) return false;
    return /account is blocked|account access is restricted|账号.*(限制|封|禁)|通道.*(限制|封|禁)/i.test(String(item.error || ""));
  }) || null;
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

function cleanReferenceLabel(label: string, index: number) {
  const cleaned = label.replace(/\s+/g, " ").trim().slice(0, 40);
  return cleaned || `Image ${index + 1}`;
}

function getReferenceAliases(label: string, index: number) {
  const aliases = new Set<string>();
  aliases.add(label);
  aliases.add(`Image ${index + 1}`);
  aliases.add(`@${index + 1}`);
  aliases.add(`第${index + 1}张图`);
  aliases.add(`第 ${index + 1} 张图`);
  return Array.from(aliases).filter(Boolean);
}

function buildReferenceImagePrompt(prompt: string, referenceLabels: string[]) {
  if (!referenceLabels.length) return prompt;
  const labels = referenceLabels.map(cleanReferenceLabel);
  return [
    "REFERENCE IMAGE MAP:",
    "Use the uploaded reference images according to the user's labels below. These labels are intentional and may not match upload order.",
    ...labels.map((label, index) => {
      const aliases = getReferenceAliases(label, index).join(" / ");
      return `${aliases}: uploaded reference image ${index + 1}. When the prompt mentions any of these aliases, use this exact image as the visual source.`;
    }),
    "",
    "COMMERCIAL VIDEO STYLE:",
    "If the user requests a TikTok US-market product ad, create an ultra-realistic live-action 9:16 vertical video with a Black female model, product consistency from the labeled product images, natural skin texture, real camera movement, premium ecommerce lighting, spoken selling points when dialogue is present, no logo, no watermark, and no unrelated on-screen text.",
    "If one labeled image contains a script, follow that script as the shot/dialogue structure. If other labeled images show product, hair texture, body wave style, outfit, or packaging, preserve those product details across the video.",
    "",
    "USER PROMPT:",
    prompt
  ].join("\n");
}

function buildCompactReferencePrompt(prompt: string, referenceLabels: string[]) {
  if (!referenceLabels.length) return prompt;
  const labels = referenceLabels.map(cleanReferenceLabel);
  return [
    `Reference images: ${labels.map((label, index) => `${label}/@${index + 1}=image ${index + 1}`).join("; ")}.`,
    "Follow the @ image references exactly when mentioned.",
    "",
    prompt
  ].join("\n");
}

function isGrokReferenceVideoModel(model: string) {
  return model === "grok-imagine-1.0-video-ref-6s" || model === "grok-imagine-1.0-video-ref-10s";
}

function isPromptOnlySoraModel(model: string) {
  const lower = model.toLowerCase();
  return lower.startsWith("sora-2-") || lower.startsWith("sora2-pro-") || lower.startsWith("ali-sora-");
}

function supportsStartEndFrames(model: string) {
  return model === "veo_3_1-fast-portrait-fl-hd";
}

function normalizeUpstreamVideoRequest(model: string, seconds: FormDataEntryValue | null) {
  if (model === "veo_3_1-fast-portrait-fl-hd") {
    return { upstreamModel: model, seconds: "8" };
  }
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

function prepareSyVideoPrompt(model: string, prompt: string) {
  const syModel = getSyModel(model);
  if (!syModel || !syModel.videoChannel.toLowerCase().includes("sora2")) return prompt;

  return [
    "IMPORTANT AUDIO REQUIREMENT:",
    "Generate a video with synchronized spoken audio. Do not make a silent video.",
    "If the prompt contains dialogue, the characters must speak those exact lines out loud in natural English, with matching mouth movement and timing.",
    "Do not express the dialogue only as subtitles or on-screen text. No logo, no watermark, no unrelated text.",
    "",
    "Important: spoken dialogue and narration must be audible, synchronized, and not replaced by subtitles.",
    "",
    prompt
  ].join("\n");
}

function prepareViduVideoPrompt(prompt: string) {
  return [
    "IMPORTANT AUDIO REQUIREMENT:",
    "Generate synchronized spoken audio when dialogue or voiceover is included. Do not make a silent video.",
    "All dialogue/voiceover lines in the prompt must be spoken out loud with natural timing. Do not express dialogue only as subtitles.",
    "",
    "Important: when the prompt includes dialogue, voiceover, or narration, generate audible speech instead of subtitles only.",
    "",
    prompt
  ].join("\n");
}

function promptRequestsSpokenAudio(prompt: string) {
  return /["“”]|(?:^|\n)\s*(Bestie|You|Narrator|Wearer|Friend|Host|Speaker|Model|Customer)\s*:|voiceover|dialogue|spoken|narration|talking|口播|旁白|对话|台词|说话/i.test(prompt);
}

function prepareHfsyVideoPrompt(model: string, prompt: string) {
  const hfsyModel = getHfsyModel(model);
  if (hfsyModel?.upstreamModel === "kling-o3") return prepareHfsyKlingPrompt(prompt);
  if (hfsyModel?.upstreamModel !== "sora-2") return prompt;
  if (!promptRequestsSpokenAudio(prompt)) return prompt;

  return [
    "IMPORTANT AUDIO REQUIREMENT:",
    "This is a spoken commercial video. Generate synchronized spoken audio, not a silent video.",
    "If the prompt contains dialogue, voiceover, Bestie:, You:, Narrator:, or quoted lines, the characters must speak those exact lines out loud.",
    "Match mouth movement and timing to the spoken lines. Do not express the dialogue only as subtitles or on-screen text.",
    "No logo, no watermark, no unrelated text.",
    "",
    "AUDIO MUST BE ENABLED. Dialogue and voiceover must be real audible speech.",
    "",
    prompt
  ].join("\n");
}

function prepareHfsyKlingPrompt(prompt: string) {
  const replacements: Array<[RegExp, string]> = [
    [/耶稣/g, "一位慈悲的长发长袍精神导师"],
    [/十字架/g, "木质手杖"],
    [/受伤/g, "疲惫"],
    [/伤口/g, "疲惫状态"],
    [/痛苦/g, "困难"],
    [/饥饿/g, "需要帮助"],
    [/恐怖/g, "紧张"],
    [/暴力/g, "冲突"],
    [/流血/g, "红色痕迹"],
    [/Jesus/gi, "a compassionate long-haired robed spiritual guide"],
    [/cross/gi, "wooden staff"],
    [/injured|wounded|hurt/gi, "tired"],
    [/pain|suffering/gi, "hardship"],
    [/hungry|starving/gi, "in need of help"],
    [/violence|violent|blood|bloody/gi, "dramatic tension"]
  ];
  const cleaned = replacements.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), prompt);
  return [
    "SAFETY AND ACCEPTANCE REQUIREMENT:",
    "Create a family-safe fictional commercial/cinematic video using only adult characters. Avoid real public or religious figure claims, injury, suffering, violence, gore, fear, horror, political persuasion, hateful content, or sexualized framing.",
    "If the user prompt contains symbolic spiritual or fantasy elements, render them as gentle fictional visual metaphors with peaceful expressions and no harm.",
    "No logo, no watermark, no subtitles unless explicitly required.",
    "",
    cleaned
  ].join("\n");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postVideoPayload(
  payload: Record<string, unknown>,
  billing: VideoBilling
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
        prompt: billing.originalPrompt || String(payload.prompt || ""),
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

async function postHfsyVideoPayload(
  payload: Record<string, unknown>,
  billing: VideoBilling
) {
  const hfsyModel = getHfsyModel(billing.model);
  const publicReferenceUrls = [
    ...(Array.isArray(payload.images) ? payload.images : []),
    ...(Array.isArray(payload.image_urls) ? payload.image_urls : []),
    ...(Array.isArray(payload.reference_images) ? payload.reference_images : [])
  ].map(String).filter(Boolean);
  const dataReferenceUrls = Array.isArray(payload.data_images)
    ? payload.data_images.map(String).filter(Boolean)
    : [];
  const size = String(payload.size || "");
  const [width, height] = size.split("x").map((value) => Number(value));
  const orientation = Number.isFinite(width) && Number.isFinite(height) && width > height ? "landscape" : "portrait";
  const duration = Number(payload.duration || payload.seconds || hfsyModel?.durationOptions[0] || 10);
  const originalPrompt = String(payload.prompt || "");
  const wantsSpokenAudio = hfsyModel?.upstreamModel === "sora-2" && promptRequestsSpokenAudio(originalPrompt);
  const isHfsySdFamily = Boolean(hfsyModel?.upstreamModel.startsWith("sd-2"));

  const trimReferencesForModel = (references: string[]) =>
    hfsyModel?.upstreamModel === "sora-2" ? references.slice(0, 1) : references;
  const preferredReferences = trimReferencesForModel(publicReferenceUrls);
  const fallbackReferences = isHfsySdFamily && dataReferenceUrls.length
    ? trimReferencesForModel(dataReferenceUrls)
    : [];

  const basePayload = {
    model: hfsyModel?.upstreamModel || String(payload.model || billing.model).replace(/^hfsy:/i, ""),
    prompt: prepareHfsyVideoPrompt(billing.model, originalPrompt),
    duration,
    orientation,
    ...(isHfsySdFamily ? { ratio: orientation === "portrait" ? "9:16" : "16:9" } : {}),
    ...(wantsSpokenAudio ? { audio: true } : {}),
    watermark: false,
    size: "large"
  };

  const submit = async (images: string[]) => {
    const upstreamPayload = {
      ...basePayload,
      ...(images.length ? { images } : {})
    };
    const response = await fetch(`${HFSY_BASE_URL}/v1/video/create`, {
      method: "POST",
      headers: hfsyHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(upstreamPayload),
      cache: "no-store"
    });
    return {
      response,
      data: await parseHfsyResponse(response),
      usedImages: images
    };
  };

  let result = await submit(preferredReferences);
  if (hfsyModel?.upstreamModel === "kling-o3" && isHfsySystemLoadFailure(result.response.status, result.data)) {
    await wait(7000);
    result = await submit(preferredReferences);
  }
  if (
    fallbackReferences.length &&
    fallbackReferences.join("\n") !== preferredReferences.join("\n") &&
    isHfsyReferenceUploadFailure(result.response.status, result.data)
  ) {
    result = await submit(fallbackReferences);
  }

  const { response, data } = result;
  const taskId = getHfsyTaskId(data);

  if (!response.ok || isImmediateFailure(data) || !taskId) {
    await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", {
      model: billing.model
    });
    if (isHfsyAccountBlockedFailure(data)) {
      return Response.json({
        error: "hfsy_account_blocked",
        message: "HFSY 上游 Fusion/SD 通道账号受限，当前无法创建 SD2Fast 任务。站内积分已自动退回，请先换用 HFSY KL3.0 / Kling O3 或其他模型，等上游账号恢复后再用 SD2Fast。",
        upstream: data
      }, { status: 503 });
    }
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
        prompt: billing.originalPrompt || String(payload.prompt || ""),
        taskId,
        status: String((data as { status?: unknown })?.status || "queued"),
        previewUrl: extractVideoUrl(data) || undefined
      });
    });
  }

  return Response.json(
    {
      ...(typeof data === "object" && data ? data : { data }),
      id: taskId,
      task_id: taskId,
      provider: "hfsy",
      charged: billing.amount
    },
    { status: response.status }
  );
}

function isHfsyReferenceUploadFailure(status: number, payload: unknown) {
  const message = stringifyPayload(payload);
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    message.includes("参考图上传失败") ||
    message.includes("上传接口返回") ||
    message.includes("upload") ||
    message.includes("Bad Gateway")
  );
}

function isHfsyAccountBlockedFailure(payload: unknown) {
  const message = stringifyPayload(payload);
  return /account is blocked|account access is restricted|账号.*(限制|封|禁)|通道.*(限制|封|禁)/i.test(message);
}

function isHfsySystemLoadFailure(status: number, payload: unknown) {
  const message = stringifyPayload(payload);
  return (
    status === 408 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /system under load|timeout_error|temporarily unavailable|too many requests|系统繁忙|负载|超时/i.test(message)
  );
}

async function postFrameVideoPayload(
  payload: {
    model: string;
    prompt: string;
    seconds?: string;
    size?: string;
    image: Blob;
    fileName: string;
    lastImage?: Blob;
    lastFileName?: string;
  },
  billing: VideoBilling
) {
  const formData = new FormData();
  formData.set("model", payload.model);
  formData.set("prompt", payload.prompt);
  if (payload.seconds) formData.set("seconds", payload.seconds);
  if (payload.size) formData.set("size", payload.size);
  formData.set("image", payload.image, payload.fileName);
  if (payload.lastImage) {
    formData.set("last_frame", payload.lastImage, payload.lastFileName || "last-frame.jpg");
  }

  const response = await fetch(`${HELLOBABYGO_BASE_URL}/v1/videos`, {
    method: "POST",
    headers: authHeaders({ Accept: "application/json" }),
    body: formData,
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
        prompt: billing.originalPrompt || payload.prompt,
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

async function imageUrlToBlob(imageUrl: string) {
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch first-frame image URL: ${response.status}`);
  }
  return {
    blob: await response.blob(),
    fileName: imageUrl.split("/").pop()?.split("?")[0] || "first-frame.jpg"
  };
}

async function postViduPayload(
  payload: Record<string, unknown>,
  billing: VideoBilling
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
      prompt: billing.originalPrompt || String(payload.prompt || ""),
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

async function postSyPayload(
  payload: {
    model: string;
    prompt: string;
    imageUrls: string[];
  },
  billing: VideoBilling
) {
  const syModel = getSyModel(payload.model);
  if (!syModel) {
    await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", {
      model: billing.model
    });
    return jsonError({ error: "sy_model_unavailable" }, 400);
  }

  const credentials = getSyCredentials();
  const upstreamPrompt = prepareSyVideoPrompt(payload.model, payload.prompt);
  const formData = new URLSearchParams();
  formData.set("currentVideoType", "图生视频");
  formData.set("cardNo", credentials.cardNo);
  formData.set("video_prompt", upstreamPrompt);
  formData.set("video_count", "1");
  formData.set("username", credentials.username);
  formData.set("userpwd", credentials.userpwd);
  formData.set("ratio", "9:16");
  formData.set("duration", String(syModel.duration));
  formData.set("videoType", syModel.videoType);
  formData.set("videoChannel", syModel.videoChannel);
  formData.set("promptType", "custom");
  formData.set("languageValue", "English");
  formData.set("remarks", "siyu-factory");
  if (payload.imageUrls.length) {
    formData.set("imageUrl", payload.imageUrls[0]);
  }
  payload.imageUrls.slice(1).forEach((url, index) => {
    formData.set(`imageUrl${index + 2}`, url);
  });
  if (payload.imageUrls.length > 1) {
    formData.set("imageUrls", payload.imageUrls.join(","));
  }
  if (syModelSupportsEndFrame(payload.model) && payload.imageUrls[1]) {
    formData.set("lastImageUrl", payload.imageUrls[1]);
    formData.set("endImageUrl", payload.imageUrls[1]);
  }

  const response = await fetch(`${SY_BASE_URL}/dm/action_card.php?action=generateOneVideo_dragImage_image2Video`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formData,
    cache: "no-store"
  });
  const data = await parseSyResponse(response);
  const taskId = getSyTaskId(data);
  const syFailure =
    !response.ok ||
    !taskId ||
    String((data as { code?: unknown })?.code || "").toLowerCase().includes("fail") ||
    String((data as { error?: unknown })?.error || "").toLowerCase().includes("invalid_sy_json") ||
    String((data as { message?: unknown })?.message || "").toLowerCase().includes("error code:");

  if (syFailure) {
    await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", {
      model: billing.model
    });
    return Response.json(data, { status: response.ok ? 502 : response.status });
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
      prompt: billing.originalPrompt || payload.prompt,
      taskId,
      status: String((data as { status?: unknown })?.status || "queued")
    });
  });

  return Response.json(
    {
      ...(typeof data === "object" && data ? data : { data }),
      id: taskId,
      task_id: taskId,
      status: String((data as { status?: unknown })?.status || "queued").toLowerCase(),
      provider: "sy",
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
    const initialPromptLimit = getPromptLimit(model, "video");
    if (prompt.length > initialPromptLimit) {
      return jsonError({
        error: "prompt_too_long",
        message: `This model supports up to ${initialPromptLimit} prompt characters. Shorten the prompt and try again.`
      }, 400);
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
    const uploadedReferenceLabels = incoming
      .getAll("reference_label")
      .map((value, index) => cleanReferenceLabel(String(value), index))
      .slice(0, references.length);
    const uploadedReferenceInputs = await Promise.all(references.map((reference) => fileToReferenceInput(reference, origin)));
    const dataReferenceUrls = [
      ...(imageUrl ? [String(imageUrl)] : []),
      ...uploadedReferenceInputs.map((input) => input.dataUrl)
    ].filter(Boolean);
    const publicReferenceUrls = [
      ...(imageUrl ? [String(imageUrl)] : []),
      ...uploadedReferenceInputs.map((input) => input.publicUrl)
    ].filter(Boolean);
    const referenceLabels = [
      ...(imageUrl ? ["Image URL"] : []),
      ...uploadedReferenceInputs.map((_, index) => uploadedReferenceLabels[index] || `Image ${index + 1}`)
    ];
    const hfsyModel = getHfsyModel(model);
    const enhancedPrompt = hfsyModel
      ? buildCompactReferencePrompt(prompt, referenceLabels)
      : buildReferenceImagePrompt(prompt, referenceLabels);
    const finalPromptLimit = getPromptLimit(model, "video");
    if (enhancedPrompt.length > finalPromptLimit) {
      return jsonError({
        error: "prompt_too_long",
        message: `This model supports up to ${finalPromptLimit} prompt characters after reference labels are added. Shorten the prompt and try again.`
      }, 400);
    }

    if (isGrokReferenceVideoModel(model) && publicReferenceUrls.length === 0) {
      return jsonError({ error: "This model requires one reference image." }, 400);
    }
    if (isSyModel(model) && publicReferenceUrls.length === 0) {
      return jsonError({ error: "This SY model requires one reference image." }, 400);
    }
    if (hfsyModel?.referenceMode === "required" && publicReferenceUrls.length === 0) {
      return jsonError({ error: "This HFSY model requires one reference image." }, 400);
    }
    if (isHfsyModel(model) && !process.env.HFSY_API_KEY) {
      return jsonError({
        error: "hfsy_not_configured",
        message: "This HFSY model is not enabled because HFSY_API_KEY is not configured."
      }, 503);
    }
    const recentHfsyBlock = await getRecentHfsyFusionAccountBlock(model);
    if (recentHfsyBlock) {
      return jsonError({
        error: "hfsy_account_blocked",
        message: "HFSY 上游 Fusion/SD 通道账号受限，当前无法创建 SD2Fast/SD2 任务。没有扣除站内积分。请先换用 HFSY KL3.0 / Kling O3 或其他模型，等上游账号恢复后再试。",
        detail: {
          last_failed_task_id: recentHfsyBlock.taskId,
          last_error: recentHfsyBlock.error
        }
      }, 503);
    }
    const activeFusionTask = await getActiveHfsyFusionTask(model);
    if (activeFusionTask) {
      return jsonError({
        error: "hfsy_fusion_concurrency_limit",
        message: "[ErrCode=500044] Fusion upstream has reached the concurrent generation limit. Wait for the current SD/Fusion task to finish, then submit again. No site credits were deducted.",
        detail: {
          active_task_id: activeFusionTask.id,
          active_model: activeFusionTask.model
        }
      }, 429);
    }
    if (supportsStartEndFrames(model) && publicReferenceUrls.length === 0) {
      return jsonError({
        error: "first_frame_required",
        message: "This VEO frame-to-video model requires at least one first-frame reference image. Upload a second image to control the ending frame."
      }, 400);
    }
    const preparedFrameImages = supportsStartEndFrames(model)
      ? references[0]
        ? {
            first: { blob: references[0], fileName: references[0].name || "first-frame.jpg" },
            last: references[1] ? { blob: references[1], fileName: references[1].name || "last-frame.jpg" } : null
          }
        : { first: await imageUrlToBlob(String(imageUrl || "")), last: null }
      : null;

    const amount = getVideoGenerationCost(model, String(seconds || ""), String(size || ""));
    const charge = await chargeUserCredits(request, amount, "video generation", { model, size: String(size || "") });
    const billing = { userId: charge.user.id, amount, model, originalPrompt: prompt };

    if (supportsStartEndFrames(model)) {
      return postFrameVideoPayload(
        {
          model: upstreamModel,
          prompt: enhancedPrompt,
          ...(seconds ? { seconds: String(seconds) } : {}),
          ...(size ? { size: String(size) } : {}),
          image: preparedFrameImages!.first.blob,
          fileName: preparedFrameImages!.first.fileName,
          ...(preparedFrameImages!.last
            ? {
                lastImage: preparedFrameImages!.last.blob,
                lastFileName: preparedFrameImages!.last.fileName
              }
            : {})
        },
        billing
      );
    }

    if (isSyModel(model)) {
      return postSyPayload(
        {
          model,
          prompt: enhancedPrompt,
          imageUrls: publicReferenceUrls
        },
        billing
      );
    }

    if (isViduModel(upstreamModel)) {
      const firstImage = dataReferenceUrls[0] || "";
      if (!firstImage) {
        await refundCreditsForUser(billing.userId, billing.amount, "video generation failed refund", { model });
        return jsonError({ error: "Vidu image-to-video requires one reference image." }, 400);
      }

      return postViduPayload(
        {
          model: toViduModel(upstreamModel),
          images: dataReferenceUrls,
          prompt: prepareViduVideoPrompt(enhancedPrompt),
          ...(seconds ? { duration: Number(seconds) } : {}),
          resolution: VIDU_SIZE_TO_RESOLUTION[String(size || "")] || "720p",
          movement_amplitude: "auto",
          watermark: false,
          audio: true,
          voice_id: "professional_host"
        },
        billing
      );
    }

    if (isHfsyModel(model)) {
      return postHfsyVideoPayload(
        {
          model,
          prompt: enhancedPrompt,
          ...(seconds ? { seconds: String(seconds) } : {}),
          ...(size ? { size: String(size) } : {}),
          ...(publicReferenceUrls.length ? { images: publicReferenceUrls } : {}),
          ...(dataReferenceUrls.length ? { data_images: dataReferenceUrls } : {})
        },
        billing
      );
    }

    return await postVideoPayload(
      {
        model: upstreamModel,
        prompt: enhancedPrompt,
        ...(seconds ? { seconds: String(seconds) } : {}),
        ...(size ? { size: String(size) } : {}),
        ...(isPromptOnlySoraModel(model)
          ? {}
          : isGrokReferenceVideoModel(model)
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

