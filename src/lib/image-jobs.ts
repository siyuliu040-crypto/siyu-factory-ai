import { HELLOBABYGO_BASE_URL, authHeaders } from "@/lib/hellobabygo";
import { recordGenerationHistory, refundCreditsForUser, withAccountState } from "@/lib/accounts";

export type ImageJobRequest = {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  aspect_ratio?: string;
  response_format?: "url" | "b64_json";
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
      status: "completed"
    })
  );
}

function extractImageUrl(result: unknown) {
  if (!result || typeof result !== "object") return "";
  const data = (result as { data?: unknown }).data;
  if (!Array.isArray(data)) return "";
  const item = data[0] as { url?: unknown; b64_json?: unknown } | undefined;
  if (typeof item?.url === "string") return item.url;
  if (typeof item?.b64_json === "string") return `data:image/png;base64,${item.b64_json}`;
  return "";
}

async function runImageJob(id: string) {
  const record = jobs.get(id);
  if (!record) return;

  save({ ...record, status: "in_progress", progress: 5 });

  try {
    const response = await fetch(`${HELLOBABYGO_BASE_URL}/v1/images/generations`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({
        model: record.request.model,
        prompt: record.request.prompt.trim(),
        n: record.request.n ?? 1,
        size: record.request.size ?? "1024x1024",
        ...(record.request.aspect_ratio ? { aspect_ratio: record.request.aspect_ratio } : {}),
        response_format: record.request.response_format ?? "url"
      }),
      cache: "no-store"
    });

    const payload = parsePayload(await response.text());
    if (!response.ok) {
      await refundImageJob(record, "image generation failed refund");
      save({
        ...record,
        status: "failed",
        progress: 0,
        error: payload,
        upstream_status: response.status
      });
      return;
    }

    await saveImageHistory(record, payload);
    save({ ...record, status: "completed", progress: 100, result: payload });
  } catch (error) {
    await refundImageJob(record, "image generation failed refund");
    save({
      ...record,
      status: "failed",
      progress: 0,
      error: error instanceof Error ? error.message : error
    });
  }
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
