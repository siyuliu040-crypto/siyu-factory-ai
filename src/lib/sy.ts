export const SY_BASE_URL = process.env.SY_API_BASE_URL?.replace(/\/$/, "") || "https://sys.tk666666.com";

export type SyModelConfig = {
  id: string;
  videoType: string;
  videoChannel: string;
  label: string;
  credits: number;
  duration: number;
  mode: "reference" | "first-last";
  resolution: "720P" | "1080P" | "4K";
  successHint?: string;
  disabledReason?: string;
};

export const SY_MODELS: SyModelConfig[] = [
  {
    id: "sy:veo-X-veo_3_1-fast-fl",
    videoType: "Veo",
    videoChannel: "veo-X-veo_3_1-fast-fl",
    label: "SY VEO 3.1 Fast 首尾帧",
    credits: 120,
    duration: 8,
    mode: "first-last",
    resolution: "720P",
    successHint: "SY 上游：首尾帧，当前通道可能波动"
  },
  {
    id: "sy:grok-Yun",
    videoType: "Grok",
    videoChannel: "grok-Yun",
    label: "SY Grok 10秒参考图",
    credits: 120,
    duration: 10,
    mode: "reference",
    resolution: "1080P",
    successHint: "SY 实时统计：今日约 100%"
  }
];

const SY_MODEL_BY_ID = new Map(SY_MODELS.map((model) => [model.id, model]));

export function isSyModel(model: string) {
  return model.startsWith("sy:");
}

export function getSyModel(model: string) {
  return SY_MODEL_BY_ID.get(model);
}

export function syModelRequiresReference(model: string) {
  return Boolean(getSyModel(model));
}

export function syModelSupportsEndFrame(model: string) {
  return getSyModel(model)?.mode === "first-last";
}

export function getSyCredentials() {
  const username = process.env.SY_API_USERNAME || "";
  const userpwd = process.env.SY_API_PASSWORD || "";
  const cardNo = process.env.SY_API_CARD_NO || "";
  if (!username || !userpwd || !cardNo) {
    throw new Error("SY_API_USERNAME, SY_API_PASSWORD, and SY_API_CARD_NO must be configured");
  }
  return { username, userpwd, cardNo };
}

export async function parseSyResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: "empty_sy_response",
      message: "SY returned an empty response.",
      upstream_status: response.status
    };
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: "invalid_sy_json",
      message: text,
      upstream_status: response.status
    };
  }
}

function decodeMojibake(value: string) {
  const mojibakeMarkers = ["鑴", "欒", "剹", "皳", "鐚", "寘", "鐩", "昡", "閼", "闁"];
  if (!mojibakeMarkers.some((marker) => value.includes(marker))) return value;
  try {
    const decoded = Buffer.from(value, "latin1").toString("utf8");
    return decoded.includes("閿?") || decoded.includes("闁?") ? value : decoded;
  } catch {
    return value;
  }
}

export function getSyTaskId(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return String(record.task_id || record.id || record.data || "");
}

function normalizeSyStatus(status: unknown) {
  const value = String(status || "").toLowerCase();
  if (["success", "completed", "succeeded", "done"].includes(value)) return "completed";
  if (["failed", "fail", "error", "canceled", "cancelled"].includes(value)) return "failed";
  if (["running", "processing", "in_progress"].includes(value)) return "in_progress";
  return "queued";
}

function parseSyUpstreamRaw(payload: unknown) {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  const raw = record.upstream_raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function extractSyVideoUrl(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const upstream = parseSyUpstreamRaw(record);
  for (const key of ["videoUrl", "video_url", "url", "result_url", "output_url"]) {
    const value = upstream[key];
    if (typeof value === "string" && value) return value;
  }
  for (const key of ["videoUrl", "video_url", "url", "result_url", "output_url"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  const data = record.data;
  if (data && typeof data === "object") return extractSyVideoUrl(data);
  return "";
}

export function normalizeSyStatusPayload(taskId: string, payload: unknown, upstreamStatus = 200) {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const upstream = parseSyUpstreamRaw(record);
  const ok = String(record.ok || "").toLowerCase();
  const videoUrl = extractSyVideoUrl(record);
  const rawProgress = upstream.progress ?? record.progress;
  const parsedProgress = typeof rawProgress === "string" ? Number(rawProgress.replace("%", "").trim()) : rawProgress;
  const failureReason = decodeMojibake(String(upstream.sora_task_failure_reason || record.error || record.msg || "").trim());
  const status = videoUrl
    ? "completed"
    : ok === "failed" || failureReason || (typeof parsedProgress === "number" && parsedProgress < 0)
      ? "failed"
      : normalizeSyStatus(record.status || upstream.status);
  const progress = status === "completed" || status === "failed"
    ? 100
    : typeof parsedProgress === "number" && Number.isFinite(parsedProgress)
      ? Math.max(0, Math.min(100, Math.round(parsedProgress)))
      : status === "in_progress"
        ? 60
        : 0;

  return {
    id: taskId,
    task_id: taskId,
    status,
    progress,
    upstream_status: upstreamStatus,
    provider: "sy",
    video_url: videoUrl || undefined,
    url: videoUrl || undefined,
    image_url: videoUrl || undefined,
    error: failureReason || record.error || record.msg || upstream.sora_task_failure_reason || undefined,
    upstream: record
  };
}
