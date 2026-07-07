export const VIDU_BASE_URL = process.env.VIDU_API_BASE_URL?.replace(/\/$/, "") || "https://api.vidu.cn";

export const VIDU_MODELS = [
  "vidu:viduq3-pro-fast",
  "vidu:viduq3-turbo",
  "vidu:viduq3-pro"
];

export function isViduModel(model: string) {
  return model.startsWith("vidu:");
}

export function toViduModel(model: string) {
  return model.replace(/^vidu:/, "");
}

export function getViduApiKey() {
  const apiKey = process.env.VIDU_API_KEY;
  if (!apiKey) throw new Error("VIDU_API_KEY is not configured");
  return apiKey;
}

export function viduHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Token ${getViduApiKey()}`,
    ...extra
  };
}

export async function parseViduResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: "empty_vidu_response",
      message: "Vidu returned an empty response.",
      upstream_status: response.status
    };
  }
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return {
        error: "invalid_vidu_json",
        message: text,
        upstream_status: response.status
      };
    }
  }
  return text;
}

export function extractViduVideoUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  if (typeof record.url === "string") return record.url;
  const creations = record.creations;
  if (Array.isArray(creations)) {
    const first = creations[0] as Record<string, unknown> | undefined;
    if (typeof first?.url === "string") return first.url;
    if (typeof first?.watermarked_url === "string") return first.watermarked_url;
  }
  return "";
}

export function normalizeViduStatus(taskId: string, payload: unknown, upstreamStatus = 200) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const state = String(record.state || record.status || "queueing").toLowerCase();
  const status = state === "success"
    ? "completed"
    : state === "failed"
      ? "failed"
      : state === "processing"
        ? "in_progress"
        : "queued";
  const videoUrl = extractViduVideoUrl(record);
  const progress = status === "completed"
    ? 100
    : status === "failed"
      ? 100
      : status === "in_progress"
        ? 60
        : 8;
  return {
    id: taskId,
    task_id: taskId,
    status,
    progress,
    upstream_status: upstreamStatus,
    provider: "vidu",
    video_url: videoUrl || undefined,
    url: videoUrl || undefined,
    image_url: videoUrl || undefined,
    error: record.err_code || record.error || undefined,
    upstream: record
  };
}
