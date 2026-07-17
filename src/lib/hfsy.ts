export const HFSY_BASE_URL =
  process.env.HFSY_API_BASE_URL?.replace(/\/$/, "") ||
  "https://www.hfsyapi.cn";

export type HfsyModel = {
  id: string;
  upstreamModel: string;
  label: string;
  media: "video";
  credits: number;
  upstreamPrice: number;
  durationOptions: number[];
  resolution: "480P" | "720P" | "1080P";
  referenceMode: "optional" | "required";
  description: string;
};

export type HfsyImageModel = {
  id: string;
  upstreamModel: string;
  label: string;
  media: "image";
  endpoint: "gemini" | "image-generation";
  credits: number;
  upstreamPrice: number;
  referenceMode: "optional" | "text-only";
  description: string;
};

export const HFSY_IMAGE_MODELS: HfsyImageModel[] = [
  {
    id: "hfsy:nano-banana-2",
    upstreamModel: "nano-banana-2",
    label: "HFSY Nano Banana 2",
    media: "image",
    endpoint: "gemini",
    credits: 1,
    upstreamPrice: 0.06,
    referenceMode: "optional",
    description:
      "HFSY light image model. Supports text-to-image and image-to-image with up to 6 reference images; best for fast product images and high-frequency drafts."
  },
  {
    id: "hfsy:nano-banana-pro",
    upstreamModel: "nano-banana-pro",
    label: "HFSY Nano Banana Pro",
    media: "image",
    endpoint: "gemini",
    credits: 2,
    upstreamPrice: 0.12,
    referenceMode: "optional",
    description:
      "HFSY flagship Nano Banana image model. Higher detail, richer color and commercial-grade reference-image fusion."
  },
  {
    id: "hfsy:gpt-image-2",
    upstreamModel: "gpt-image-2",
    label: "HFSY GPT Image 2",
    media: "image",
    endpoint: "image-generation",
    credits: 1,
    upstreamPrice: 0.03,
    referenceMode: "text-only",
    description:
      "HFSY GPT Image 2 image-generation model. Strong prompt understanding and text rendering for product images, ads and creative drafts."
  },
  {
    id: "hfsy:gpt-image-2pro",
    upstreamModel: "gpt-image-2pro",
    label: "HFSY GPT Image 2 Pro",
    media: "image",
    endpoint: "image-generation",
    credits: 2,
    upstreamPrice: 0.2,
    referenceMode: "text-only",
    description:
      "HFSY GPT Image 2 Pro image-generation model. Supports native high-resolution image creation with stronger detail and scene consistency."
  }
];

export const HFSY_MODELS: HfsyModel[] = [
  {
    id: "hfsy:sora-2",
    upstreamModel: "sora-2",
    label: "HFSY Sora 2 VIP",
    media: "video",
    credits: 8,
    upstreamPrice: 0.8,
    durationOptions: [4, 8, 10],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "HFSY Sora 2 official transfer API. Supports prompt-only video, optional reference image input, and spoken dialogue prompts."
  },
  {
    id: "hfsy:sd-2-fast",
    upstreamModel: "sd-2-fast",
    label: "HFSY SD 2 Fast",
    media: "video",
    credits: 30,
    upstreamPrice: 3,
    durationOptions: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolution: "720P",
    referenceMode: "optional",
    description:
      "HFSY SD 2 Fast is the economical fast 720P video model. It supports 5-15 second text-to-video and image-to-video generation, with optional reference images."
  },
  {
    id: "hfsy:sd-2",
    upstreamModel: "sd-2",
    label: "HFSY SD 2",
    media: "video",
    credits: 45,
    upstreamPrice: 4.5,
    durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "Stable Diffusion 2.0 video model from HFSY. Supports 4-15 second text-to-video and image-to-video generation."
  },
  {
    id: "hfsy:sd-2-vip",
    upstreamModel: "sd-2-vip",
    label: "HFSY SD 2 VIP",
    media: "video",
    credits: 45,
    upstreamPrice: 4.5,
    durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "Stable Diffusion 2.0 VIP video model. Supports 4-15 second text-to-video and image-to-video generation."
  },
  {
    id: "hfsy:kling-o3",
    upstreamModel: "kling-o3",
    label: "HFSY KL3.0 / Kling O3",
    media: "video",
    credits: 45,
    upstreamPrice: 4.5,
    durationOptions: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolution: "720P",
    referenceMode: "required",
    description:
      "HFSY KL3.0 / Kling O3 video model. Supports 5-15 second 9:16 reference-image video generation at 720P. A reference image is required. Recent failures can indicate upstream account access restrictions."
  }
];

export function isHfsyModel(model: string) {
  return model.toLowerCase().startsWith("hfsy:");
}

export function toHfsyModel(model: string) {
  return model.replace(/^hfsy:/i, "");
}

export function getHfsyModel(model: string) {
  return HFSY_MODELS.find((item) => item.id === model || item.upstreamModel === model);
}

export function isHfsyImageModel(model: string) {
  return Boolean(getHfsyImageModel(model));
}

export function getHfsyImageModel(model: string) {
  return HFSY_IMAGE_MODELS.find((item) => item.id === model || item.upstreamModel === model);
}

export function getHfsyApiKey() {
  const apiKey = process.env.HFSY_API_KEY;
  if (!apiKey) throw new Error("HFSY_API_KEY is not configured");
  return apiKey;
}

export function hfsyHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${getHfsyApiKey()}`,
    ...extra
  };
}

export async function parseHfsyResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: "empty_hfsy_response",
      message: "HFSY returned an empty response.",
      upstream_status: response.status
    };
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      error: "invalid_hfsy_response",
      message: text,
      upstream_status: response.status
    };
  }
}

export function getHfsyTaskId(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : {};
  return String(record.task_id || record.id || record.video_id || data.task_id || data.id || data.video_id || "");
}
