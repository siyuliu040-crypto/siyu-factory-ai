export const HELLOBABYGO_BASE_URL =
  process.env.HELLOBABYGO_API_BASE_URL?.replace(/\/$/, "") ||
  "https://api.hellobabygo.com";

export type ApiErrorPayload = {
  error: string;
  message?: string;
  status?: number;
  detail?: unknown;
};

export function getApiKey() {
  const apiKey = process.env.HELLOBABYGO_API_KEY;
  if (!apiKey) {
    throw new Error("HELLOBABYGO_API_KEY is not configured");
  }
  return apiKey;
}

export function authHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    ...extra
  };
}

export async function parseUpstreamResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export function jsonError(payload: ApiErrorPayload, status = 500) {
  return Response.json(payload, { status });
}

export async function forwardJson(path: string, init?: RequestInit) {
  const response = await fetch(`${HELLOBABYGO_BASE_URL}${path}`, {
    ...init,
    headers: authHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers
    }),
    cache: "no-store"
  });
  const data = await parseUpstreamResponse(response);
  return Response.json(data, { status: response.status });
}

export async function forwardMultipart(path: string, formData: FormData) {
  const response = await fetch(`${HELLOBABYGO_BASE_URL}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
    cache: "no-store"
  });
  const data = await parseUpstreamResponse(response);
  return Response.json(data, { status: response.status });
}
