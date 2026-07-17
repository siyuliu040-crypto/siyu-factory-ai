import { getHfsyImageModel, HFSY_BASE_URL, hfsyHeaders } from "@/lib/hfsy";
import {
  recordGenerationHistory,
  refundCreditsForUser,
  settleGenerationTask,
  updateHistoryByTaskId,
  withAccountState
} from "@/lib/accounts";
import { normalizeImageRequestForUpstream } from "@/lib/image-models";

export type ImageJobRequest = {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  response_format?: "url" | "b64_json";
  references?: Array<{
    name: string;
    type: string;
    data: string;
  }>;
};

export type ImageJobRecord = {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  progress: number;
  created_at: string;
  updated_at?: string;
  request: ImageJobRequest;
  result?: unknown;
  error?: unknown;
  upstream_id?: string;
  upstream_status?: number;
  billing?: {
    userId: string;
    amount: number;
    refunded?: boolean;
  };
};

type ImageJobStore = Map<string, ImageJobRecord>;

const globalForImageJobs = globalThis as typeof globalThis & {
  siyuImageJobs?: ImageJobStore;
};

const jobs = globalForImageJobs.siyuImageJobs ?? new Map<string, ImageJobRecord>();
globalForImageJobs.siyuImageJobs = jobs;
const IMAGE_JOB_MAX_ATTEMPTS = 3;
const IMAGE_JOB_RETRY_DELAY_MS = 120000;
const IMAGE_STATUS_POLL_INTERVAL_MS = 5000;
const IMAGE_STATUS_MAX_ATTEMPTS = 180;

function createJobId() {
  return `img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parsePayload(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: "Image upstream request failed", detail: text };
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getImageTaskId(payload: unknown) {
  if (!isRecord(payload)) return "";
  const data = isRecord(payload.data) ? payload.data : {};
  return String(payload.task_id || payload.id || data.task_id || data.id || "");
}

function normalizeImageStatus(payload: unknown) {
  if (!isRecord(payload)) return "completed";
  const raw = String(payload.status || "").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(raw)) return "completed";
  if (["failed", "fail", "error", "cancelled", "canceled"].includes(raw)) return "failed";
  if (["queued", "pending", "processing", "running", "in_progress", "generating"].includes(raw)) return "in_progress";
  return extractImageUrl(payload) ? "completed" : "in_progress";
}

function isRetryableImageError(status: number, payload: unknown) {
  const message = typeof payload === "string" ? payload : JSON.stringify(payload);
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 524 ||
    message.includes("Proxy Read Timeout") ||
    message.includes("ProxyError") ||
    message.includes("代理不可用") ||
    message.includes("Unable to connect to proxy") ||
    message.includes("ConnectTimeoutError") ||
    message.includes("HTTPSConnectionPool") ||
    message.includes("upload/sign") ||
    message.includes("origin_response_timeout") ||
    message.includes("retryable")
  );
}

function shouldRetryImageJob(record: ImageJobRecord, status: number, payload: unknown) {
  void record;
  return isRetryableImageError(status, payload);
}

function save(record: ImageJobRecord) {
  jobs.set(record.id, { ...record, updated_at: new Date().toISOString() });
}

async function refundImageJob(record: ImageJobRecord, reason: string) {
  if (!record.billing || record.billing.refunded) return;
  await refundCreditsForUser(record.billing.userId, record.billing.amount, reason, { jobId: record.id });
  record.billing.refunded = true;
}

async function saveImageHistory(record: ImageJobRecord, result: unknown) {
  if (!record.billing) return;
  const imageUrl = extractImageUrl(result);
  await withAccountState((state) =>
    recordGenerationHistory(state, {
      userId: record.billing!.userId,
      type: "image",
      model: record.request.model,
      prompt: record.request.prompt,
      previewUrl: imageUrl || undefined,
      taskId: record.id,
      status: "completed"
    })
  );
}

async function markImageJobCompleted(record: ImageJobRecord, result: unknown) {
  const imageUrl = extractImageUrl(result);
  await withAccountState((state) => {
    settleGenerationTask(state, record.id, "completed");
    updateHistoryByTaskId(state, record.id, {
      status: "completed",
      previewUrl: imageUrl || undefined
    });
  });
  await saveImageHistory(record, result);
}

async function markImageJobFailed(record: ImageJobRecord, error: unknown) {
  const errorText = typeof error === "string" ? error : JSON.stringify(error);
  if (record.billing) {
    let foundPersistedTask = false;
    await withAccountState((state) => {
      const task = settleGenerationTask(state, record.id, "failed");
      foundPersistedTask = Boolean(task);
      if (!task) {
        updateHistoryByTaskId(state, record.id, { status: "failed", error: errorText });
      } else {
        updateHistoryByTaskId(state, record.id, { status: "failed", error: errorText });
      }
    });
    if (!foundPersistedTask) {
      await refundImageJob(record, "image generation failed refund");
    }
  } else {
    await refundImageJob(record, "image generation failed refund");
  }
}

function extractImageUrl(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const inlineImage = findGeminiInlineImage(result);
  if (inlineImage) return inlineImage;
  const data = (result as { data?: unknown }).data;
  const item = Array.isArray(data) ? data[0] as { url?: unknown; b64_json?: unknown } | undefined : undefined;
  if (typeof item?.url === "string") return item.url;
  if (typeof item?.b64_json === "string") return `data:image/png;base64,${item.b64_json}`;
  const fallback = findImageUrl(result);
  if (fallback) return fallback;
  return "";
}

function findGeminiInlineImage(value: unknown, seen = new Set<unknown>()): string {
  if (!value || typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const record = value as Record<string, unknown>;
  const inline = isRecord(record.inlineData)
    ? record.inlineData
    : isRecord(record.inline_data)
      ? record.inline_data
      : null;
  const data = inline ? inline.data : undefined;
  const mimeType = inline ? inline.mimeType || inline.mime_type : undefined;
  if (typeof data === "string" && data.length > 100) {
    return `data:${typeof mimeType === "string" ? mimeType : "image/png"};base64,${data}`;
  }

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = findGeminiInlineImage(item, seen);
        if (found) return found;
      }
      continue;
    }
    const found = findGeminiInlineImage(nested, seen);
    if (found) return found;
  }
  return "";
}

function findImageUrl(value: unknown, seen = new Set<unknown>()): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (/^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(value)) return value;
    if (/^data:image\//i.test(value)) return value;
    return "";
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ["url", "image_url", "output_url", "result_url", "previewUrl"]) {
    const found = findImageUrl(record[key], seen);
    if (found) return found;
  }
  const b64 = record.b64_json || record.base64 || record.image_base64;
  if (typeof b64 === "string" && b64.length > 100) return `data:image/png;base64,${b64}`;
  for (const nested of Object.values(record)) {
    const found = findImageUrl(nested, seen);
    if (found) return found;
  }
  return "";
}

async function runImageJob(id: string) {
  const record = jobs.get(id);
  if (!record) return;

  save({ ...record, status: "in_progress", progress: 5 });

  try {
    for (let attempt = 1; attempt <= IMAGE_JOB_MAX_ATTEMPTS; attempt += 1) {
      const references = record.request.references || [];
      const response = references.length
        ? await postImageEdit(record, references)
        : await postImageGeneration(record);

      const payload = parsePayload(await response.text());
      if (response.ok) {
        const finalPayload = await waitForImageCompletion(record, payload, response.status);
        if (normalizeImageStatus(finalPayload) === "failed") {
          await markImageJobFailed(record, finalPayload);
          save({
            ...record,
            status: "failed",
            progress: 0,
            error: finalPayload,
            upstream_id: getImageTaskId(finalPayload) || getImageTaskId(payload) || undefined,
            upstream_status: response.status
          });
          return;
        }

        await markImageJobCompleted(record, finalPayload);
        save({
          ...record,
          status: "completed",
          progress: 100,
          result: finalPayload,
          upstream_id: getImageTaskId(finalPayload) || getImageTaskId(payload) || undefined,
          upstream_status: response.status
        });
        return;
      }

      if (attempt < IMAGE_JOB_MAX_ATTEMPTS && shouldRetryImageJob(record, response.status, payload)) {
        save({
          ...record,
          status: "in_progress",
          progress: Math.min(90, 10 + attempt * 25),
          error: payload,
          upstream_status: response.status
        });
        await wait(IMAGE_JOB_RETRY_DELAY_MS);
        continue;
      }

      await markImageJobFailed(record, payload);
      save({
        ...record,
        status: "failed",
        progress: 0,
        error: payload,
        upstream_status: response.status
      });
      return;
    }
  } catch (error) {
    await markImageJobFailed(record, error);
    save({
      ...record,
      status: "failed",
      progress: 0,
      error: error instanceof Error ? error.message : error
    });
  }
}

async function waitForImageCompletion(record: ImageJobRecord, initialPayload: unknown, upstreamStatus: number) {
  const initialStatus = normalizeImageStatus(initialPayload);
  const taskId = getImageTaskId(initialPayload);
  if (initialStatus === "completed" || initialStatus === "failed" || !taskId) return initialPayload;

  save({
    ...record,
    status: "in_progress",
    progress: 20,
    result: initialPayload,
    upstream_id: taskId,
    upstream_status: upstreamStatus
  });

  let lastPayload = initialPayload;
  for (let attempt = 0; attempt < IMAGE_STATUS_MAX_ATTEMPTS; attempt += 1) {
    await wait(IMAGE_STATUS_POLL_INTERVAL_MS);
    const response = await fetch(`${HFSY_BASE_URL}/v1/images/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: hfsyHeaders({ Accept: "application/json" }),
      cache: "no-store"
    });
    const payload = parsePayload(await response.text());
    lastPayload = payload;

    if (!response.ok) {
      if (isRetryableImageError(response.status, payload)) {
        save({
          ...record,
          status: "in_progress",
          progress: Math.min(95, 20 + attempt),
          result: payload,
          upstream_id: taskId,
          upstream_status: response.status
        });
        continue;
      }
      return payload;
    }

    const status = normalizeImageStatus(payload);
    if (status === "completed" || status === "failed") return payload;
    save({
      ...record,
      status: "in_progress",
      progress: Math.min(95, Number((payload as { progress?: unknown }).progress || 20 + attempt) || 20),
      result: payload,
      upstream_id: taskId,
      upstream_status: response.status
    });
  }

  return {
    error: "Image task is still processing after the site polling window.",
    status: "failed",
    task_id: taskId,
    upstream: lastPayload
  };
}

function postImageGeneration(record: ImageJobRecord) {
  const upstream = normalizeImageRequestForUpstream(record.request);
  const hfsyImageModel = getHfsyImageModel(record.request.model);
  if (hfsyImageModel?.endpoint === "gemini") {
    return postGeminiImageGeneration(record);
  }
  return fetch(`${HFSY_BASE_URL}/v1/images/generations`, {
    method: "POST",
    headers: hfsyHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({
      model: upstream.model,
      prompt: record.request.prompt.trim(),
      n: record.request.n ?? 1,
      size: upstream.size ?? "1024x1024",
      ...(upstream.aspect_ratio ? { aspect_ratio: upstream.aspect_ratio } : {}),
      response_format: record.request.response_format ?? "url"
    }),
    cache: "no-store"
  });
}

async function postImageEdit(
  record: ImageJobRecord,
  references: NonNullable<ImageJobRequest["references"]>
) {
  const upstream = normalizeImageRequestForUpstream(record.request);
  const hfsyImageModel = getHfsyImageModel(record.request.model);
  if (hfsyImageModel?.endpoint === "gemini") {
    return postGeminiImageGeneration(record, references);
  }
  const formData = new FormData();
  formData.set("model", upstream.model);
  formData.set("prompt", record.request.prompt.trim());
  formData.set("n", String(record.request.n ?? 1));
  formData.set("size", upstream.size ?? "1024x1024");
  if (upstream.aspect_ratio) formData.set("aspect_ratio", upstream.aspect_ratio);
  formData.set("response_format", record.request.response_format ?? "url");

  for (const [index, reference] of references.entries()) {
    const bytes = Buffer.from(reference.data, "base64");
    formData.append("image", new Blob([bytes], { type: reference.type || "image/png" }), reference.name || `reference-${index + 1}.png`);
  }

  return fetch(`${HFSY_BASE_URL}/v1/images/edits`, {
    method: "POST",
    headers: hfsyHeaders({ Accept: "application/json" }),
    body: formData,
    cache: "no-store"
  });
}

function postGeminiImageGeneration(
  record: ImageJobRecord,
  references: NonNullable<ImageJobRequest["references"]> = []
) {
  const upstream = normalizeImageRequestForUpstream(record.request);
  const parts: Array<Record<string, unknown>> = [{ text: record.request.prompt.trim() }];
  for (const reference of references.slice(0, 6)) {
    parts.push({
      inline_data: {
        mime_type: reference.type || "image/png",
        data: reference.data
      }
    });
  }

  return fetch(`${HFSY_BASE_URL}/v1beta/models/${encodeURIComponent(upstream.model)}:generateContent`, {
    method: "POST",
    headers: hfsyHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts
        }
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"]
      }
    }),
    cache: "no-store"
  });
}

export function startImageJob(
  request: ImageJobRequest,
  billing?: { userId: string; amount: number }
) {
  const id = createJobId();
  const record: ImageJobRecord = {
    id,
    status: "queued",
    progress: 0,
    created_at: new Date().toISOString(),
    request,
    billing
  };
  jobs.set(id, record);
  void runImageJob(id);
  return record;
}

export function getImageJob(id: string) {
  return jobs.get(id);
}
