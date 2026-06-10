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
    credits: 1,
    upstreamPrice: 0.8,
    durationOptions: [10],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "Official-transfer Sora 2 video model. Supports text prompts or reference image input, with dialogue, sound effects, and background music."
  },
  {
    id: "hfsy:sd-2-vip",
    upstreamModel: "sd-2-vip",
    label: "HFSY SD 2 VIP",
    media: "video",
    credits: 5,
    upstreamPrice: 4.5,
    durationOptions: [8],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "Stable Diffusion 2.0 VIP video model. Supports text-to-video and image-to-video generation."
  },
  {
    id: "hfsy:kling-omni",
    upstreamModel: "Kling Omni",
    label: "HFSY Kling Omni VIP",
    media: "video",
    credits: 5,
    upstreamPrice: 0,
    durationOptions: [8],
    resolution: "1080P",
    referenceMode: "optional",
    description:
      "Kling Omni video model from HFSY. Supports prompt-based video and reference media workflows where the upstream account allows it."
  }
];

export function isHfsyModel(model: string) {
  return model.toLowerCase().startsWith("hfsy:");
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
  return String(record.task_id || record.id || record.video_id || data.task_id || data.id || "");
}
