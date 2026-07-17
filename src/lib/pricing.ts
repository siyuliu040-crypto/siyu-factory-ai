import { getSyModel } from "@/lib/sy";
import { getHfsyImageModel, getHfsyModel } from "@/lib/hfsy";

const INTERNAL_CREDIT_SCALE = 10000;

function siteCredits(value: number) {
  return Math.round(value * INTERNAL_CREDIT_SCALE);
}

export const MODEL_CREDIT_COSTS: Record<string, number> = {
  "hfsy:nano-banana-2": siteCredits(1),
  "hfsy:nano-banana-pro": siteCredits(2),
  "hfsy:gpt-image-2": siteCredits(1),
  "hfsy:gpt-image-2pro": siteCredits(2),
  "firefly-veo31-fast-8s-9x16-1080p": siteCredits(12),
  "firefly-veo31-ref-8s-9x16-1080p": siteCredits(15),
  "veo_3_1-fast-portrait-fl-hd": siteCredits(3),
  "ali-sora-video-portrait-official-4s": siteCredits(5),
  "ali-sora-video-portrait-official-8s": siteCredits(8),
  "sora-2-4s-9x16": siteCredits(60),
  "sora-2-8s-9x16": siteCredits(110),
  "grok-imagine-1.0-video": siteCredits(15),
  "grok-imagine-1.0-video-6s": siteCredits(12),
  "grok-imagine-1.0-video-10s": siteCredits(18),
  "grok-imagine-1.0-video-ref-6s": siteCredits(80),
  "grok-imagine-1.0-video-ref-10s": siteCredits(120),
  "sy:grok-Yun": siteCredits(120),
  "hfsy:sora-2": siteCredits(8),
  "hfsy:sd-2-fast": siteCredits(30),
  "hfsy:sd-2": siteCredits(45),
  "hfsy:sd-2-vip": siteCredits(45),
  "hfsy:kling-o3": siteCredits(45),
  "deepseek-v4-flash": siteCredits(1),
  "deepseek-v4-pro": siteCredits(2),
  "omni_flash": siteCredits(2)
};

export const MODEL_UPSTREAM_PRECHARGE_USD: Record<string, number> = {
  "firefly-veo31-fast-8s-9x16-1080p": 0.888,
  "firefly-veo31-ref-8s-9x16-1080p": 0.888,
  "veo_3_1-fast-portrait-fl-hd": 0.12,
  "ali-sora-video-portrait-official-4s": 0.288,
  "ali-sora-video-portrait-official-8s": 0.288,
  "sora-2-4s-9x16": 0.384,
  "sora-2-8s-9x16": 0.768
};

const VIDU_CREDITS_PER_SECOND: Record<string, Record<string, number>> = {
  "vidu:viduq3-pro-fast": {
    "720p": 187.6,
    "1080p": 225
  },
  "vidu:viduq3-turbo": {
    "540p": 103.2,
    "720p": 103.2,
    "1080p": 121.8
  },
  "vidu:viduq3-pro": {
    "540p": 187.6,
    "720p": 187.6,
    "1080p": 225
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
  const hfsyImageModel = getHfsyImageModel(model);
  if (hfsyImageModel) return siteCredits(hfsyImageModel.credits);
  if (MODEL_CREDIT_COSTS[model]) return MODEL_CREDIT_COSTS[model];
  const lower = model.toLowerCase();
  if (lower.includes("15s")) return siteCredits(30);
  if (lower.includes("12s")) return siteCredits(24);
  if (lower.includes("4s")) return siteCredits(8);
  if (lower.includes("video") || lower.includes("veo") || lower.includes("sora")) return siteCredits(15);
  return siteCredits(2);
}

export function getGenerationCost(model: string, count = 1) {
  return getModelCreditCost(model) * Math.max(1, Math.round(count));
}

function durationCost(duration?: string | number) {
  const seconds = Number(duration || 0);
  if (seconds >= 15) return siteCredits(30);
  if (seconds >= 12) return siteCredits(24);
  if (seconds <= 4 && seconds > 0) return siteCredits(8);
  return siteCredits(15);
}

export function getVideoGenerationCost(model: string, duration?: string | number, resolution?: string | number) {
  const lower = model.toLowerCase();
  const syModel = getSyModel(model);
  if (syModel) return siteCredits(syModel.credits);
  const hfsyModel = getHfsyModel(model);
  if (hfsyModel) return siteCredits(hfsyModel.credits);
  if (lower.startsWith("vidu:")) {
    return Math.round(getViduDisplayCreditCost(model, duration, resolution) * INTERNAL_CREDIT_SCALE);
  }
  if (lower.includes("grok-imagine-1.0-video-ref-10s")) return siteCredits(120);
  if (lower.includes("grok-imagine-1.0-video-ref-6s")) return siteCredits(80);
  if (lower.includes("grok-imagine-1.0-video-10s")) return siteCredits(18);
  if (lower.includes("grok-imagine-1.0-video-6s")) return siteCredits(12);
  if (lower.includes("grok-imagine-1.0-video")) {
    const seconds = Math.max(6, Number(duration || 6));
    return seconds >= 10 ? siteCredits(18) : siteCredits(12);
  }
  if (MODEL_CREDIT_COSTS[model] && lower.includes("sora")) return MODEL_CREDIT_COSTS[model];
  if (MODEL_CREDIT_COSTS[model] && lower.includes("firefly-veo31")) return MODEL_CREDIT_COSTS[model];
  if (MODEL_CREDIT_COSTS[model] && lower.includes("veo_3_1")) return MODEL_CREDIT_COSTS[model];
  const base = durationCost(duration || lower.match(/(\d+)s/)?.[1]);
  if (lower.includes("hd") || lower.includes("ref")) return base + siteCredits(5);
  if (lower.includes("veo")) return base;
  return getModelCreditCost(model);
}

export function getUpstreamPrechargeUsd(model: string) {
  if (MODEL_UPSTREAM_PRECHARGE_USD[model]) return MODEL_UPSTREAM_PRECHARGE_USD[model];
  const lower = model.toLowerCase();
  if (lower.includes("video") || lower.includes("veo") || lower.includes("sora")) return 1.152;
  return undefined;
}
