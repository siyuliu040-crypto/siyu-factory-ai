export const MODEL_CREDIT_COSTS: Record<string, number> = {
  "gpt-image-2": 720,
  "nano_banana_2-1K-portrait": 3200,
  "nano_banana_2-2K-portrait": 3200,
  "nano_banana_2-4K-portrait": 5000,
  "nano_banana_pro-1K-portrait": 3200,
  "nano_banana_pro-2K-portrait": 3200,
  "nano_banana_pro-4K-portrait": 5000,
  "firefly-veo31-fast-8s-9x16-1080p": 8880,
  "firefly-veo31-ref-8s-9x16-1080p": 11520,
  "veo_3_1-fast-portrait": 1200,
  "veo_3_1-fast-portrait-hd": 1200,
  "veo_3_1-fast-portrait-fl-hd": 1200,
  "ali-sora-video-portrait-official-4s": 2880,
  "ali-sora-video-portrait-official-8s": 2880,
  "sora-2-4s-9x16": 3840,
  "sora-2-8s-9x16": 7680,
  "sora-2-12s-9x16": 11520,
  "sora2-pro-12s-9x16": 16880,
  "grok-imagine-1.0-video": 11520,
  "grok-imagine-1.0-video-6s": 11520,
  "grok-imagine-1.0-video-10s": 11520,
  "grok-imagine-1.0-video-ref-6s": 11520,
  "grok-imagine-1.0-video-ref-10s": 11520,
  "deepseek-v4-flash": 10000,
  "deepseek-v4-pro": 30000
};

const INTERNAL_CREDIT_SCALE = 10000;

export const MODEL_UPSTREAM_PRECHARGE_USD: Record<string, number> = {
  "firefly-veo31-fast-8s-9x16-1080p": 0.888,
  "firefly-veo31-ref-8s-9x16-1080p": 1.152,
  "veo_3_1-fast-portrait": 0.12,
  "veo_3_1-fast-portrait-hd": 0.12,
  "veo_3_1-fast-portrait-fl-hd": 0.12,
  "ali-sora-video-portrait-official-4s": 0.288,
  "ali-sora-video-portrait-official-8s": 0.288,
  "sora-2-4s-9x16": 0.384,
  "sora-2-8s-9x16": 0.768,
  "sora-2-12s-9x16": 1.152,
  "sora2-pro-12s-9x16": 1.688
};

const VIDU_CREDITS_PER_SECOND: Record<string, Record<string, number>> = {
  "vidu:viduq3-pro-fast": {
    "720p": 12,
    "1080p": 15
  },
  "vidu:viduq3-turbo": {
    "540p": 7,
    "720p": 12,
    "1080p": 13
  },
  "vidu:viduq3-pro": {
    "540p": 9,
    "720p": 20,
    "1080p": 24
  }
};

export function normalizeVideoResolution(resolution?: string | number) {
  const raw = String(resolution || "").toLowerCase();
  if (raw.includes("1080")) return "1080p";
  if (raw.includes("720")) return "720p";
  if (raw.includes("540")) return "540p";
  if (raw.includes("480")) return "480p";
  return "";
}

export function getViduDisplayCreditCost(model: string, duration?: string | number, resolution?: string | number) {
  const seconds = Math.max(1, Number(duration || 5));
  const rates = VIDU_CREDITS_PER_SECOND[model];
  if (!rates) return 0;
  const normalized = normalizeVideoResolution(resolution);
  const rate = rates[normalized] ?? rates["720p"] ?? Object.values(rates)[0] ?? 0;
  return rate * seconds;
}

export function getModelCreditCost(model: string) {
  if (MODEL_CREDIT_COSTS[model]) return MODEL_CREDIT_COSTS[model];
  const lower = model.toLowerCase();
  if (lower.includes("15s")) return 2000000;
  if (lower.includes("12s")) return 1600000;
  if (lower.includes("4s")) return 800000;
  if (lower.includes("video") || lower.includes("veo") || lower.includes("sora")) return 1200000;
  return 40000;
}

export function getGenerationCost(model: string, count = 1) {
  return getModelCreditCost(model) * Math.max(1, Math.round(count));
}

function durationCost(duration?: string | number) {
  const seconds = Number(duration || 0);
  if (seconds >= 15) return 2000000;
  if (seconds >= 12) return 1600000;
  if (seconds <= 4 && seconds > 0) return 800000;
  return 1200000;
}

export function getVideoGenerationCost(model: string, duration?: string | number, resolution?: string | number) {
  const lower = model.toLowerCase();
  if (lower.startsWith("vidu:")) {
    return Math.round(getViduDisplayCreditCost(model, duration, resolution) * INTERNAL_CREDIT_SCALE);
  }
  if (lower.includes("grok-imagine-1.0-video-ref-10s")) return 1700000;
  if (lower.includes("grok-imagine-1.0-video-ref-6s")) return 1300000;
  if (lower.includes("grok-imagine-1.0-video-10s")) return 1500000;
  if (lower.includes("grok-imagine-1.0-video-6s")) return 1100000;
  if (lower.includes("grok-imagine-1.0-video")) {
    const seconds = Math.max(6, Number(duration || 6));
    return seconds >= 10 ? 1500000 : 1100000;
  }
  if (MODEL_CREDIT_COSTS[model] && lower.includes("sora")) return MODEL_CREDIT_COSTS[model];
  if (MODEL_CREDIT_COSTS[model] && lower.includes("firefly-veo31")) return MODEL_CREDIT_COSTS[model];
  if (MODEL_CREDIT_COSTS[model] && lower.includes("veo_3_1")) return MODEL_CREDIT_COSTS[model];
  const base = durationCost(duration || lower.match(/(\d+)s/)?.[1]);
  if (lower.includes("hd") || lower.includes("ref")) return base + 400000;
  if (lower.includes("veo")) return base;
  return getModelCreditCost(model);
}

export function getUpstreamPrechargeUsd(model: string) {
  if (MODEL_UPSTREAM_PRECHARGE_USD[model]) return MODEL_UPSTREAM_PRECHARGE_USD[model];
  const lower = model.toLowerCase();
  if (lower.includes("video") || lower.includes("veo") || lower.includes("sora")) return 1.152;
  return undefined;
}
