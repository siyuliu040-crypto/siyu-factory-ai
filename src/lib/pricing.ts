export const MODEL_CREDIT_COSTS: Record<string, number> = {
  "gpt-image-2": 40000,
  "ali-sora-video-portrait-official-4s": 1200000,
  "ali-sora-video-portrait-official-8s": 1200000,
  "ali-sora-video-portrait-official-12s": 1200000,
  "ali-sora-video-landscape-official-4s": 1200000,
  "ali-sora-video-landscape-official-8s": 1200000,
  "ali-sora-video-landscape-official-12s": 1200000,
  "veo_3_1-fast-portrait": 1200000,
  "veo_3_1-fast-landscape": 1200000,
  "veo_3_1-fast-portrait-hd": 1200000,
  "veo_3_1-fast-landscape-hd": 1200000
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
  if (lower.includes("video") || lower.includes("veo") || lower.includes("sora")) return 1200000;
  return 40000;
}

export function getGenerationCost(model: string, count = 1) {
  return getModelCreditCost(model) * Math.max(1, Math.round(count));
}

export function getUpstreamPrechargeUsd(model: string) {
  if (MODEL_UPSTREAM_PRECHARGE_USD[model]) return MODEL_UPSTREAM_PRECHARGE_USD[model];
  const lower = model.toLowerCase();
  if (lower.includes("video") || lower.includes("veo") || lower.includes("sora")) return 1.152;
  return undefined;
}
