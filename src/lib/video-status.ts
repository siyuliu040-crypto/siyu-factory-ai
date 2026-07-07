export type NormalizedVideoPayload = {
  id: string;
  task_id: string;
  status: string;
  progress: number;
  video_url?: string;
  url?: string;
  image_url?: string;
  error?: unknown;
  transient?: boolean;
  upstream_status?: number;
  message?: string;
  upstream?: unknown;
  [key: string]: unknown;
};

export type NormalizedVideoStatus = {
  payload: NormalizedVideoPayload;
  statusCode: number;
  transient: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export function isTransientVideoStatusPayload(payload: unknown) {
  const message = typeof payload === "string" ? payload : JSON.stringify(payload);
  return (
    message.includes("fail_to_fetch_task") ||
    message.includes("Internal Server Error") ||
    message.includes("Not Found") ||
    message.includes("\"detail\":\"Not Found\"")
  );
}

function normalizeStatus(status: unknown) {
  const value = String(status || "").toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "COMPLETED", "DONE"].includes(value)) return "completed";
  if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(value)) return "failed";
  if (["PROCESSING", "RUNNING", "IN_PROGRESS"].includes(value)) return "in_progress";
  if (["PENDING", "QUEUED", "CREATED"].includes(value)) return "queued";
  return String(status || "queued").toLowerCase();
}

function normalizeProgress(progress: unknown, status: string) {
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }
  if (typeof progress === "string") {
    const parsed = Number(progress.replace("%", "").trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
  }
  if (status === "completed") return 100;
  if (status === "failed") return 100;
  if (status === "in_progress") return 72;
  if (status === "queued") return 8;
  return 5;
}

export function extractVideoUrl(payload: unknown): string {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = typeof item === "string" ? item : extractVideoUrl(item);
      if (typeof found === "string" && /\.(mp4|mov|webm)(\?|$)/i.test(found)) return found;
    }
    return "";
  }
  if (!isRecord(payload)) return "";
  const direct = payload.video_url || payload.url || payload.result_url || payload.output_url;
  if (typeof direct === "string" && direct) return direct;

  const imageUrl = payload.image_url;
  if (typeof imageUrl === "string" && /\.(mp4|mov|webm)(\?|$)/i.test(imageUrl)) {
    return imageUrl;
  }

  const data = payload.data;
  if (isRecord(data)) return extractVideoUrl(data);

  const result = payload.result;
  if (isRecord(result)) return extractVideoUrl(result);
  if (Array.isArray(result)) return extractVideoUrl(result);

  for (const key of ["videos", "output", "outputs", "urls", "video_urls", "creations"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const found = extractVideoUrl(value);
      if (found) return found;
    }
  }

  return "";
}

export function normalizeVideoStatusPayload(
  taskId: string,
  payload: unknown,
  upstreamStatus = 200
): NormalizedVideoStatus {
  if (isTransientVideoStatusPayload(payload)) {
    return {
      transient: true,
      statusCode: 202,
      payload: {
        id: taskId,
        task_id: taskId,
        status: "queued",
        progress: 8,
        transient: true,
        upstream_status: upstreamStatus,
        message: "The upstream provider has not exposed this task status yet. Retrying is safe.",
        upstream: payload
      }
    };
  }

  const root = isRecord(payload) ? payload : {};
  const legacy = isRecord(root.data) ? root.data : null;
  const source = legacy && ("task_id" in legacy || "result_url" in legacy || "status" in legacy) ? legacy : root;
  const status = normalizeStatus(source.status);
  const progress = normalizeProgress(source.progress, status);
  const videoUrl = extractVideoUrl(source) || extractVideoUrl(root);
  const normalized: NormalizedVideoPayload = {
    ...root,
    id: String(source.id || source.task_id || root.id || taskId),
    task_id: String(source.task_id || source.id || root.task_id || root.id || taskId),
    status,
    progress,
    upstream_status: upstreamStatus
  };

  if (videoUrl) {
    normalized.video_url = videoUrl;
    normalized.url = videoUrl;
    normalized.image_url = videoUrl;
  }
  if (source.error || source.fail_reason || root.error) {
    normalized.error = source.error || source.fail_reason || root.error;
  }

  return {
    transient: false,
    statusCode: status === "queued" || status === "in_progress" ? 202 : upstreamStatus,
    payload: normalized
  };
}
