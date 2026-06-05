export const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_API_BASE_URL?.replace(/\/$/, "") ||
  "https://api.deepseek.com";

export const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro", "omni_flash"] as const;

export type DeepSeekModel = (typeof DEEPSEEK_MODELS)[number];

export function getDeepSeekApiKey() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured");
  }
  return apiKey;
}

export function isDeepSeekModel(model: string): model is DeepSeekModel {
  return DEEPSEEK_MODELS.includes(model as DeepSeekModel);
}

export function deepSeekHeaders(extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${getDeepSeekApiKey()}`,
    ...extra
  };
}

export async function parseDeepSeekResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

export function extractDeepSeekText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
  return String(first?.message?.content || first?.text || "").trim();
}
