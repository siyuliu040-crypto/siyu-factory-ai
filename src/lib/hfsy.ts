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
  resolution: "720P" | "1080P";
  referenceMode: "optional" | "required";
  description: string;
};

export const HFSY_MODELS: HfsyModel[] = [
  {
    id: "hfsy:sora-2",
    upstreamModel: "sora-2",
    label: "HFSY Sora 2 VIP",
    media: "video",
    credits: 240,
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
    credits: 900,
    upstreamPrice: 3,
    durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "HFSY SD 2 Fast is the economical fast video model. It supports text-to-video and image-to-video, with optional reference images."
  },
  {
    id: "hfsy:sd-2",
    upstreamModel: "sd-2",
    label: "HFSY SD 2",
    media: "video",
    credits: 1350,
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
    credits: 1350,
    upstreamPrice: 4.5,
    durationOptions: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "Stable Diffusion 2.0 VIP video model. Supports 4-15 second text-to-video and image-to-video generation."
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
