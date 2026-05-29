import { HELLOBABYGO_BASE_URL, authHeaders } from "@/lib/hellobabygo";

export type ImageJobRequest = {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
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
        response_format: record.request.response_format ?? "url"
      }),
      cache: "no-store"
    });

    const payload = parsePayload(await response.text());
    if (!response.ok) {
      save({
        ...record,
        status: "failed",
        progress: 0,
        error: payload,
        upstream_status: response.status
      });
      return;
    }

    save({ ...record, status: "completed", progress: 100, result: payload });
  } catch (error) {
    save({
      ...record,
      status: "failed",
      progress: 0,
      error: error instanceof Error ? error.message : error
    });
  }
}

export function startImageJob(request: ImageJobRequest) {
  const id = createJobId();
  const record: ImageJobRecord = {
    id,
    status: "queued",
    progress: 0,
    created_at: new Date().toISOString(),
    request
  };
  jobs.set(id, record);
  void runImageJob(id);
  return record;
}

export function getImageJob(id: string) {
  return jobs.get(id);
}
