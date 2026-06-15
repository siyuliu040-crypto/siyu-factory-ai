const DEFAULT_IMAGE_PROMPT_LIMIT = 2000;
const DEFAULT_VIDEO_PROMPT_LIMIT = 2500;

export const MODEL_PROMPT_LIMITS: Record<string, number> = {
  "gpt-image-2": 2000,
  "nano_banana_2-1K-portrait": 2000,
  "nano_banana_2-2K-portrait": 2000,
  "nano_banana_2-4K-portrait": 2000,
  "nano_banana_pro-1K-portrait": 2000,
  "nano_banana_pro-2K-portrait": 2000,
  "nano_banana_pro-4K-portrait": 2000,
  "sora-2-4s-9x16": 1500,
  "sora2-pro-12s-9x16": 1800,
  "grok-imagine-1.0-video-ref-6s": 1200,
  "grok-imagine-1.0-video-ref-10s": 1200,
  "vidu:viduq3-pro-fast": 5000,
  "vidu:viduq3-turbo": 5000,
  "vidu:viduq3-pro": 5000,
  "sy:veo-X-veo_3_1-fast-fl": 1800,
  "sy:grok-Yun": 1600,
  "hfsy:sora-2": 2000,
  "hfsy:sd-2": 1600,
  "hfsy:sd-2-vip": 1600,
  "deepseek-v4-flash": 3000,
  "deepseek-v4-pro": 3000,
  "omni_flash": 3000
};

export function getPromptLimit(model: string, type: "image" | "video" | "text" = "video") {
  if (MODEL_PROMPT_LIMITS[model]) return MODEL_PROMPT_LIMITS[model];
  if (type === "image") return DEFAULT_IMAGE_PROMPT_LIMIT;
  if (type === "text") return 3000;
  return DEFAULT_VIDEO_PROMPT_LIMIT;
}

export function isPromptTooLong(model: string, prompt: string, type: "image" | "video" | "text" = "video") {
  return prompt.trim().length > getPromptLimit(model, type);
}
