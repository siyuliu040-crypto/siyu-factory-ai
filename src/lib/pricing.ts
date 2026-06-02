export const MODEL_CREDIT_COSTS: Record<string, number> = {
  "gpt-image-2": 40000,
  "ali-sora-video-portrait-official-4s": 800000,
  "ali-sora-video-portrait-official-8s": 1200000,
  "ali-sora-video-portrait-official-12s": 1600000,
  "ali-sora-video-landscape-official-4s": 800000,
  "ali-sora-video-landscape-official-8s": 1200000,
  "ali-sora-video-landscape-official-12s": 1600000,
  "veo_3_1-fast-portrait": 1600000,
  "veo_3_1-fast-landscape": 1600000,
  "veo_3_1-fast-portrait-hd": 2000000,
  "veo_3_1-fast-landscape-hd": 2000000
};

export const MODEL_UPSTREAM_PRECHARGE_USD: Record<string, number> = {
  "ali-sora-video-portrait-official-4s": 1.152,
  "ali-sora-video-portrait-official-8s": 1.152,
  "ali-sora-video-portrait-official-12s": 1.152,
  "ali-sora-video-landscape-official-4s": 1.152,
  "ali-sora-video-landscape-official-8s": 1.152,
  "ali-sora-video-landscape-official-12s": 1.152,
  "veo_3_1-fast-portrait": 1.152,
  "veo_3_1-fast-landscape": 1.152,
  "veo_3_1-fast-portrait-hd": 1.152,
  "veo_3_1-fast-landscape-hd": 1.152
};

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

export function getVideoGenerationCost(model: string, duration?: string | number) {
  const lower = model.toLowerCase();
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
