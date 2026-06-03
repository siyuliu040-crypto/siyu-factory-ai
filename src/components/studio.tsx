"use client";

import {
  Clapperboard,
  CreditCard,
  Download,
  Film,
  Image as ImageIcon,
  ImagePlus,
  Languages,
  Loader2,
  LogOut,
  Minus,
  Plus,
  Play,
  RefreshCw,
  Shield,
  Sparkles,
  User,
  Users,
  Wallet,
  Wand2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MODEL_CREDIT_COSTS, getVideoGenerationCost } from "@/lib/pricing";

type Mode = "image" | "video";
type Language = "zh" | "en";

type ModelItem = {
  id: string;
  supported_endpoint_types?: string[];
};

type ImageResult = {
  data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  [key: string]: unknown;
};

type ImageJobResult = {
  id?: string;
  status?: string;
  progress?: number;
  result?: ImageResult;
  error?: unknown;
};

type VideoResult = {
  id?: string;
  task_id?: string;
  video_id?: string;
  url?: string;
  video_url?: string;
  image_url?: string;
  status?: string;
  progress?: number;
  transient?: boolean;
  error?: unknown;
  [key: string]: unknown;
};

type QuotaResult = {
  connected?: boolean;
  message?: string;
  data?: unknown;
};

type ReferencePreview = {
  name: string;
  url: string;
};

type HistoryItem = {
  id: string;
  mode: Mode;
  model: string;
  prompt: string;
  createdAt: string;
  previewUrl?: string;
  taskId?: string;
  videoId?: string;
  status?: string;
};

type BatchJob = {
  id: string;
  prompt: string;
  model: string;
  status: string;
  progress: number;
  attempts?: number;
  taskId?: string;
  url?: string;
  error?: string;
};

type BatchPromptSlot = {
  id: string;
  value: string;
  referenceFiles: File[];
  referencePreviews: ReferencePreview[];
};

type AccountUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  credits: number;
};

type LedgerEntry = {
  id: string;
  userId: string;
  adminId?: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
};

type AuthSession = {
  authenticated: boolean;
  user?: AccountUser | null;
  users?: AccountUser[];
  ledger?: LedgerEntry[];
  storage?: { persistent?: boolean; label?: string };
};

type GenerationStatus = {
  label: string;
  detail?: string;
  progress?: number;
  tone?: "idle" | "running" | "done" | "error";
};

const TOPUP_URL = "https://api.hellobabygo.com/console/topup";
const MAX_REFERENCE_IMAGES = 6;
const MAX_REFERENCE_SIDE = 1280;
const REFERENCE_IMAGE_QUALITY = 0.82;
const HISTORY_LIMIT = 40;
const MAX_BATCH_VIDEOS = 10;
const DISPLAY_CREDIT_SCALE = 10000;
const MAX_VIDEO_ATTEMPTS = 1;
const VIDEO_RETRY_DELAY_MS = 30000;
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_POLL_ATTEMPTS = 180;
const VIDEO_MAX_TRANSIENT_ATTEMPTS = 36;

const stableImageModels = [
  "gpt-image-2",
  "nano_banana_2-1K-portrait",
  "nano_banana_2-2K-portrait",
  "nano_banana_2-4K-portrait",
  "nano_banana_pro-1K-portrait",
  "nano_banana_pro-2K-portrait",
  "nano_banana_pro-4K-portrait"
];

const stableVideoModels = [
  "vidu:viduq3-pro-fast",
  "vidu:viduq3-turbo",
  "vidu:viduq3-pro",
  "firefly-veo31-fast-8s-9x16-1080p",
  "firefly-veo31-ref-8s-9x16-1080p",
  "veo_3_1-fast-portrait"
];

const modelCreditCosts: Record<string, number> = MODEL_CREDIT_COSTS;

const copy = {
  zh: {
    mediaType: "媒体类型",
    image: "图片",
    video: "视频",
    stableModels: "稳定模型",
    note: "只展示当前验证过的稳定模型。API Key 保存在服务端，不会暴露给浏览器。",
    title: "思雨的工厂",
    subtitle: "图片、视频、批量视频统一生产台。",
    prompt: "提示词",
    batchPrompt: "批量视频作品",
    promptPlaceholder: "描述画面、产品、人物、动作、镜头和风格。",
    batchPlaceholder: "填写第 1 个作品的视频提示词。每张卡片可以生成一个不同作品。",
    imageSize: "图片尺寸",
    currentModel: "当前模型",
    generateImage: "生成图片",
    generateVideo: "生成视频",
    generateBatch: "批量生成视频",
    duration: "时长",
    seconds4: "4 秒",
    seconds8: "8 秒",
    seconds12: "12 秒",
    seconds15: "15 秒",
    aspect: "画幅",
    portrait: "9:16 竖屏",
    landscape: "9:16 竖屏",
    referenceImages: "参考图",
    uploadReferences: "上传参考图",
    addReferences: "添加更多",
    referenceLimit: `最多 ${MAX_REFERENCE_IMAGES} 张`,
    optionalReferenceUrl: "可选：粘贴一张参考图 URL",
    clearAll: "清空全部",
    removeReference: "删除参考图",
    refreshStatus: "刷新视频状态",
    result: "结果",
    history: "历史记录",
    historyEmpty: "还没有历史作品。",
    clearHistory: "清空历史",
    resultIdle: "生成结果会显示在这里。",
    resultError: "请求返回提示。",
    download: "下载",
    waiting: "等待生成",
    waitingHint: "提交任务后，进度和预览会自动出现在这里。",
    quota: "剩余额度",
    refreshQuota: "刷新额度",
    quotaConnected: "Key 已连接",
    quotaUnavailable: "余额接口未开放",
    quotaUnknown: "无法读取",
    topUp: "充值",
    topUpHint: "HellobabyGo 钱包",
    quotaErrorTitle: "上游账户余额不足",
    quotaErrorBody: "需要到 HellobabyGo 钱包充值后再生成。",
    memberQuotaErrorBody: "上游账户余额不足，请联系主账号处理充值后再生成。",
    adminOnly: "只有主账号可以操作积分。",
    imageFailed: "图片生成失败",
    videoFailed: "视频生成失败",
    videoStillProcessing: "视频任务还在处理中，系统会继续查询。",
    videoStatusFailed: "视频状态查询失败",
    syncing: "上游任务状态还在同步，请稍等，系统会继续查询。",
    batchLimit: `最多 ${MAX_BATCH_VIDEOS} 个作品，可以一次排队生成不同视频。`,
    noBatchPrompt: "请至少填写一个批量视频提示词。",
    estimatedCost: "预计消耗",
    batchEstimatedCost: "批量预计消耗",
    credits: "积分",
    costUnknown: "按上游实际扣费",
    batchCardPlaceholder: "填写这个作品的视频提示词",
    work: "作品",
    workReferences: "作品参考图",
    modelCanReference: "可用参考图",
    modelTextOnly: "纯提示词",
    noCreditsTitle: "站内积分不足",
    noCreditsBody: "当前账号积分不够生成，请联系主账号分配积分后再试。",
    grant: "分配",
    addCredits: "加积分",
    subtractCredits: "减积分",
    memberCredits: "成员积分管理",
    selectMember: "选择用户",
    creditAmount: "调整积分数量",
    creditAmountHint: "手动输入要增加或扣减的站内积分，例如 120。",
    selectedBalance: "当前余额",
    afterAdd: "加后余额",
    afterSubtract: "减后余额",
    insufficientAfterSubtract: "积分不足",
    refreshAccount: "刷新账号",
    invalidCreditAmount: "请输入大于 0 的积分",
    grantSuccess: "积分已增加",
    subtractSuccess: "积分已扣减",
    name: "昵称",
    email: "邮箱"
  },
  en: {
    mediaType: "Media type",
    image: "Image",
    video: "Video",
    stableModels: "Stable models",
    note: "Only verified models are shown. API keys stay on the server.",
    title: "Siyu Factory",
    subtitle: "Image, video, and batch video production desk.",
    prompt: "Prompt",
    batchPrompt: "Batch video works",
    promptPlaceholder: "Describe the scene, product, subject, movement, camera, and style.",
    batchPlaceholder: "Write the prompt for work 1. Each card can become a different video.",
    imageSize: "Image size",
    currentModel: "Current model",
    generateImage: "Generate image",
    generateVideo: "Generate video",
    generateBatch: "Batch generate videos",
    duration: "Duration",
    seconds4: "4 seconds",
    seconds8: "8 seconds",
    seconds12: "12 seconds",
    seconds15: "15 seconds",
    aspect: "Aspect",
    portrait: "9:16 portrait",
    landscape: "9:16 portrait",
    referenceImages: "Reference images",
    uploadReferences: "Upload references",
    addReferences: "Add more",
    referenceLimit: `Up to ${MAX_REFERENCE_IMAGES} images`,
    optionalReferenceUrl: "Optional: paste one reference image URL",
    clearAll: "Clear all",
    removeReference: "Remove reference",
    refreshStatus: "Refresh video status",
    result: "Result",
    history: "History",
    historyEmpty: "No saved generations yet.",
    clearHistory: "Clear history",
    resultIdle: "Generated output appears here.",
    resultError: "The request returned a notice.",
    download: "Download",
    waiting: "Waiting for generation",
    waitingHint: "Progress and preview will appear here after submission.",
    quota: "Remaining quota",
    refreshQuota: "Refresh quota",
    quotaConnected: "Key connected",
    quotaUnavailable: "Quota endpoint unavailable",
    quotaUnknown: "Unavailable",
    topUp: "Top up",
    topUpHint: "HellobabyGo wallet",
    quotaErrorTitle: "Upstream account balance is low",
    quotaErrorBody: "Top up the HellobabyGo wallet before generating again.",
    memberQuotaErrorBody: "The upstream balance is low. Contact the main account to top up before generating again.",
    adminOnly: "Only the main account can adjust credits.",
    imageFailed: "Image generation failed",
    videoFailed: "Video generation failed",
    videoStillProcessing: "The video task is still processing. The system will keep checking.",
    videoStatusFailed: "Video status query failed",
    syncing: "The upstream task status is still syncing. The system will keep checking.",
    batchLimit: `Up to ${MAX_BATCH_VIDEOS} works can be queued as different videos.`,
    noBatchPrompt: "Add at least one batch video prompt.",
    estimatedCost: "Estimated cost",
    batchEstimatedCost: "Batch estimated cost",
    credits: "credits",
    costUnknown: "Billed by upstream",
    batchCardPlaceholder: "Write this work's video prompt",
    work: "Work",
    workReferences: "Work references",
    modelCanReference: "Reference ready",
    modelTextOnly: "Prompt only",
    noCreditsTitle: "Not enough site credits",
    noCreditsBody: "This account needs more site credits from the main account before generating.",
    grant: "Grant",
    addCredits: "Add",
    subtractCredits: "Subtract",
    memberCredits: "Member credits",
    selectMember: "Select user",
    creditAmount: "Credit amount",
    creditAmountHint: "Type the site credits to add or subtract, for example 120.",
    selectedBalance: "Current balance",
    afterAdd: "After add",
    afterSubtract: "After subtract",
    insufficientAfterSubtract: "Not enough",
    refreshAccount: "Refresh account",
    invalidCreditAmount: "Enter credits greater than 0",
    grantSuccess: "Credits added",
    subtractSuccess: "Credits subtracted",
    name: "Name",
    email: "Email"
  }
} satisfies Record<Language, Record<string, string>>;

function extractImageUrl(result: ImageResult | null) {
  const item = result?.data?.[0];
  if (!item) return "";
  if (item.url) return item.url;
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  return "";
}

function getVideoTaskId(result?: VideoResult | null) {
  return result?.task_id || result?.id || result?.video_id || "";
}

function getVideoUrl(result?: VideoResult | null) {
  return result?.video_url || result?.url || result?.image_url || "";
}

function getModelCreditCost(model: string) {
  return modelCreditCosts[model] || MODEL_CREDIT_COSTS[model];
}

function isVideoModel(model: string) {
  const lower = model.toLowerCase();
  return lower.includes("video") || lower.includes("veo") || lower.startsWith("vidu:");
}

function isViduModelId(model: string) {
  return model.toLowerCase().startsWith("vidu:");
}

function getCreditCost(model: string, duration?: string) {
  if (isVideoModel(model)) return getVideoGenerationCost(model, duration);
  return getModelCreditCost(model);
}

function formatCreditCost(model: string, language: Language, duration?: string) {
  const cost = getCreditCost(model, duration);
  if (!cost) return copy[language].costUnknown;
  return `${formatDisplayCredits(cost)} ${copy[language].credits}`;
}

function formatCreditTotal(cost: number | undefined, language: Language) {
  if (!cost) return copy[language].costUnknown;
  return `${formatDisplayCredits(cost)} ${copy[language].credits}`;
}

function formatDisplayCredits(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return "0";
  const scaled = value / DISPLAY_CREDIT_SCALE;
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: scaled < 10 ? 1 : 0
  }).format(scaled);
}

function parseDisplayCredits(value: string) {
  const numeric = Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * DISPLAY_CREDIT_SCALE);
}

function formatQuotaText(value: string) {
  return value.replace(/\$/g, "").replace(/\s*USD\s*/gi, "").trim();
}

function getModelTitle(model: string, language: Language) {
  const lower = model.toLowerCase();
  if (lower.startsWith("vidu:")) return language === "zh" ? "Vidu 图生视频" : "Vidu Image to Video";
  if (lower.includes("firefly")) return language === "zh" ? "Firefly VEO" : "Firefly VEO";
  if (lower.includes("veo_3_1")) return language === "zh" ? "VEO 3.1 Fast" : "VEO 3.1 Fast";
  if (lower.includes("nano_banana_pro")) return language === "zh" ? "Nano Banana Pro" : "Nano Banana Pro";
  if (lower.includes("nano_banana")) return language === "zh" ? "Nano Banana" : "Nano Banana";
  return model;
}

function getModelDescription(model: string, language: Language) {
  const lower = model.toLowerCase();
  const aspect = language === "zh" ? "9:16 竖屏" : "9:16 portrait";
  if (lower.startsWith("vidu:")) {
    const speed = lower.includes("pro-fast")
      ? language === "zh" ? "Q3 Pro Fast · 参考图必填" : "Q3 Pro Fast · reference required"
      : lower.includes("turbo")
        ? language === "zh" ? "Q3 Turbo · 参考图必填" : "Q3 Turbo · reference required"
        : language === "zh" ? "Q3 Pro · 参考图必填" : "Q3 Pro · reference required";
    return `${aspect} · 5/8/12/15 秒可选 · ${speed}`;
  }
  const reference = lower.includes("hd") || lower.includes("ref") || lower.includes("veo")
    ? copy[language].modelCanReference
    : copy[language].modelTextOnly;
  const fixedDuration = lower.includes("firefly-veo31") ? "8" : lower.match(/(\d+)s/)?.[1];
  const durationText = fixedDuration
    ? language === "zh" ? `${fixedDuration} 秒视频` : `${fixedDuration}s video`
    : language === "zh" ? "4/8/12/15 秒可选" : "4/8/12/15s selectable";
  return `${aspect} · ${durationText} · ${reference}`;
}

function getDurationOptions(model: string, language: Language) {
  const lower = model.toLowerCase();
  if (lower.startsWith("vidu:")) {
    return [
      { value: "5", label: language === "zh" ? "5 秒" : "5 seconds" },
      { value: "8", label: language === "zh" ? "8 秒" : "8 seconds" },
      { value: "12", label: language === "zh" ? "12 秒" : "12 seconds" },
      { value: "15", label: language === "zh" ? "15 秒" : "15 seconds" }
    ];
  }
  if (lower.includes("firefly-veo31")) {
    return [{ value: "8", label: language === "zh" ? "8 秒（模型固定）" : "8 seconds fixed" }];
  }
  if (lower.includes("veo_3_1")) {
    return [
      { value: "4", label: language === "zh" ? "4 秒" : "4 seconds" },
      { value: "8", label: language === "zh" ? "8 秒" : "8 seconds" },
      { value: "12", label: language === "zh" ? "12 秒" : "12 seconds" },
      { value: "15", label: language === "zh" ? "15 秒" : "15 seconds" }
    ];
  }
  return [{ value: "8", label: language === "zh" ? "8 秒" : "8 seconds" }];
}

function normalizeDurationForModel(model: string, currentDuration: string, language: Language) {
  const options = getDurationOptions(model, language);
  if (options.some((option) => option.value === currentDuration)) return currentDuration;
  return options[0]?.value || currentDuration;
}
function isVideoDone(status?: string, result?: VideoResult | null) {
  return (
    ["completed", "succeeded", "success", "done"].includes(String(status || "").toLowerCase()) ||
    Boolean(result && getVideoUrl(result) && (result.progress === undefined || result.progress >= 100))
  );
}

function isVideoFailed(status?: string) {
  return ["failed", "error", "cancelled", "canceled"].includes(String(status || "").toLowerCase());
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}

function isTransientVideoStatusError(payload: unknown) {
  const message = typeof payload === "string" ? payload : JSON.stringify(payload);
  return (
    message.includes("fail_to_fetch_task") ||
    message.includes("Internal Server Error") ||
    message.includes("Not Found") ||
    message.includes("\"detail\":\"Not Found\"")
  );
}

function isInsufficientQuota(message: string) {
  return (
    message.includes("insufficient_user_quota") ||
    message.includes("额度不足") ||
    message.includes("余额不足") ||
    message.includes("预扣费额度失败")
  );
}

function isUpstreamBusyError(message: string) {
  return (
    message.includes("upstream_generation_failed") ||
    message.includes("生成服务暂时繁忙") ||
    message.toLowerCase().includes("temporarily busy")
  );
}

function getRetryMessage(language: Language, attempt: number) {
  return language === "zh"
    ? `上游视频服务繁忙，${VIDEO_RETRY_DELAY_MS / 1000} 秒后自动重试（第 ${attempt + 1}/${MAX_VIDEO_ATTEMPTS} 次）。`
    : `The upstream video service is busy. Retrying in ${VIDEO_RETRY_DELAY_MS / 1000}s (${attempt + 1}/${MAX_VIDEO_ATTEMPTS}).`;
}
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      error: "empty_response",
      message: "The server returned an empty response."
    } as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: "invalid_json_response",
      message: text
    } as T;
  }
}

function getTransientVideoMessage(language: Language) {
  return copy[language].syncing;
}

function getStaleVideoMessage(id: string, language: Language) {
  return language === "zh"
    ? `这个视频任务长时间没有返回结果，可能已经在上游失效。请重新生成，或把任务 ID ${id} 发给我排查。`
    : `This video task has not returned a result for a long time and may have expired upstream. Please generate it again, or send task ID ${id} for troubleshooting.`;
}

function cleanErrorMessage(error: string, language: Language) {
  if (!error) return "";
  if (isTransientVideoStatusError(error)) return getTransientVideoMessage(language);
  if (isInsufficientQuota(error)) {
    return language === "zh"
      ? "上游账户余额不足，请先充值后再生成。"
      : "The upstream account balance is low. Please top up before generating again.";
  }
  try {
    const parsed = JSON.parse(error) as { message?: string; error?: string; detail?: unknown };
    return parsed.message || parsed.error || (typeof parsed.detail === "string" ? parsed.detail : error);
  } catch {
    return error;
  }
}

function getReferenceVideoModel(size: string) {
  void size;
  return "firefly-veo31-ref-8s-9x16-1080p";
}

function getFastVideoModel(size: string, duration: string) {
  void size;
  if (duration === "15") {
    return "veo_3_1-fast-portrait";
  }
  return "firefly-veo31-fast-8s-9x16-1080p";
}

function getEffectiveVideoModel(size: string, hasReference: boolean, duration: string) {
  return hasReference ? getReferenceVideoModel(size) : getFastVideoModel(size, duration);
}

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_REFERENCE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", REFERENCE_IMAGE_QUALITY);
    });
    if (!blob || blob.size >= file.size) return file;

    const safeName = file.name.replace(/\.[^.]+$/, "") || "reference";
    return new File([blob], `${safeName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function findQuotaValue(data: unknown, language: Language): string {
  const seen = new Set<unknown>();
  const keys = ["remaining_quota", "remainingQuota", "balance", "credit", "credits", "amount", "quota"];

  function walk(value: unknown): unknown {
    if (!value || typeof value !== "object" || seen.has(value)) return undefined;
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (record.unlimited_quota === true || record.unlimitedQuota === true) {
      return language === "zh" ? "无限额度" : "Unlimited quota";
    }
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "number" || typeof candidate === "string") return candidate;
    }
    for (const nested of Object.values(record)) {
      const found = walk(nested);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const found = walk(data);
  if (typeof found === "number") return found.toLocaleString();
  if (typeof found === "string" && found.trim()) return found;
  return "";
}

function normalizeHistoryItems(items: unknown): HistoryItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const mode: Mode = item.mode === "video" ? "video" : "image";
      return {
        id: String(item.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`),
        mode,
        model: String(item.model || ""),
        prompt: String(item.prompt || ""),
        createdAt: String(item.createdAt || new Date().toISOString()),
        previewUrl: typeof item.previewUrl === "string" ? item.previewUrl : undefined,
        taskId: typeof item.taskId === "string" ? item.taskId : undefined,
        videoId: typeof item.videoId === "string" ? item.videoId : typeof item.taskId === "string" ? item.taskId : undefined,
        status: typeof item.status === "string" ? item.status : undefined
      };
    })
    .filter((item) => item.model && item.prompt);
}

function getHistoryVideoPreviewUrl(item: HistoryItem) {
  if (item.previewUrl) return item.previewUrl;
  const taskId = item.videoId || item.taskId;
  if (!taskId || !isVideoDone(item.status, { status: item.status })) return "";
  return `/api/videos/${encodeURIComponent(taskId)}/content`;
}

export default function Studio() {
  const [language, setLanguage] = useState<Language>("zh");
  const [mode, setMode] = useState<Mode>("image");
  const [models, setModels] = useState<ModelItem[]>([]);
  const [imageModel, setImageModel] = useState(stableImageModels[0]);
  const [videoModel, setVideoModel] = useState(stableVideoModels[0]);
  const [prompt, setPrompt] = useState(
    "9:16 vertical, ultra-realistic beauty commercial, young Black woman wearing a short curly pixie wig, soft warm studio light, clean luxury background, natural hair movement, no logo, no text"
  );
  const [batchPrompts, setBatchPrompts] = useState<BatchPromptSlot[]>(() =>
    Array.from({ length: MAX_BATCH_VIDEOS }, (_, index) => ({
      id: `batch-${index + 1}`,
      value:
        index === 0
          ? "9:16 vertical, ultra-realistic beauty commercial, woman slowly turns to show short curly pixie wig, warm studio light, no text"
          : index === 1
            ? "9:16 vertical, macro close-up of short curly pixie wig texture, fingers lift and release curls, soft highlights, no text"
            : "",
      referenceFiles: [],
      referencePreviews: []
    }))
  );
  const [imageSize, setImageSize] = useState("1024x1792");
  const [seconds, setSeconds] = useState("5");
  const [videoSize, setVideoSize] = useState("720x1280");
  const [imageUrl, setImageUrl] = useState("");
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [referencePreviews, setReferencePreviews] = useState<ReferencePreview[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [imageResult, setImageResult] = useState<ImageResult | null>(null);
  const [videoResult, setVideoResult] = useState<VideoResult | null>(null);
  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [quota, setQuota] = useState<QuotaResult | null>(null);
  const [isQuotaLoading, setIsQuotaLoading] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isOptimizingReferences, setIsOptimizingReferences] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authForm, setAuthForm] = useState({ email: "", name: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantAmount, setGrantAmount] = useState("120");
  const [grantMessage, setGrantMessage] = useState("");
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>({
    label: "等待生成",
    detail: "提交任务后会显示上传、排队、处理和完成状态。",
    progress: 0,
    tone: "idle"
  });
  const [showWelcome, setShowWelcome] = useState(true);
  const t = copy[language];
  const tx = (key: string, fallback: string) => (t as Record<string, string>)[key] || fallback;

  useEffect(() => {
    fetch("/api/models")
      .then((response) => response.json())
      .then((payload) => setModels(Array.isArray(payload.data) ? payload.data : []))
      .catch(() => setModels([]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowWelcome(false), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    void refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      for (const preview of referencePreviews) URL.revokeObjectURL(preview.url);
    };
  }, [referencePreviews]);

  const imageModels = useMemo(() => {
    const liveIds = new Set(models.map((model) => model.id));
    const liveStable = stableImageModels.filter((id) => liveIds.has(id));
    return liveStable.length ? liveStable : stableImageModels;
  }, [models]);

  const videoModels = useMemo(() => {
    const liveIds = new Set(models.map((model) => model.id));
    const liveStable = stableVideoModels.filter((id) => liveIds.has(id));
    return liveStable.length ? liveStable : stableVideoModels;
  }, [models]);

  const activeImageUrl = extractImageUrl(imageResult);
  const videoId = getVideoTaskId(videoResult);
  const videoSrc = isVideoDone(videoResult?.status, videoResult) ? getVideoUrl(videoResult) || (videoId ? `/api/videos/${videoId}/content` : "") : "";
  const downloadUrl = activeImageUrl || videoSrc;
  const downloadKind = activeImageUrl ? "image" : "video";
  const currentUser = session?.user || null;
  const isAdmin = currentUser?.role === "admin";
  const quotaValue = findQuotaValue(quota?.data, language);
  const quotaText = quotaValue ? formatQuotaText(quotaValue) : quota?.connected ? t.quotaUnavailable : t.quotaUnknown;
  const displayError = cleanErrorMessage(error, language);
  const needsTopUp = isInsufficientQuota(error);
  const referenceInputId = `reference-images-${mode}`;
  const singleVideoHasReference = referenceFiles.length > 0 || imageUrl.trim().length > 0;
  const activeModel = mode === "image" ? imageModel : videoModel;
  const durationOptions = mode === "video" ? getDurationOptions(videoModel, language) : [];
  const activeModelCost = getCreditCost(activeModel, mode === "video" ? seconds : undefined);
  const activeVideoNeedsReference = mode === "video" && isViduModelId(activeModel);
  const canAffordActiveModel = Boolean(currentUser && activeModelCost && currentUser.credits >= activeModelCost);
  const canSubmit =
    prompt.trim().length > 0 &&
    !isLoading &&
    Boolean(currentUser) &&
    canAffordActiveModel &&
    (!activeVideoNeedsReference || singleVideoHasReference);
  const filledBatchSlots = batchPrompts.filter((item) => item.value.trim()).slice(0, MAX_BATCH_VIDEOS);
  const batchCreditTotal = filledBatchSlots.length
    ? filledBatchSlots.reduce((total, slot) => total + getCreditCost(getBatchSlotModel(slot), seconds), 0)
    : undefined;
  const batchMissingRequiredReference = isViduModelId(videoModel) && filledBatchSlots.some((slot) => slot.referenceFiles.length === 0);
  const canAffordBatch = Boolean(currentUser && batchCreditTotal && currentUser.credits >= batchCreditTotal && !batchMissingRequiredReference);
  const showCreditWarning = Boolean(currentUser && activeModelCost && currentUser.credits < activeModelCost);
  const imageHistory = history.filter((item) => item.mode === "image");
  const videoHistory = history.filter((item) => item.mode === "video");
  const selectedGrantUser = (session?.users || []).find((user) => user.id === grantUserId);
  const grantInternalAmount = parseDisplayCredits(grantAmount);
  const addPreviewCredits = selectedGrantUser && grantInternalAmount ? selectedGrantUser.credits + grantInternalAmount : undefined;
  const subtractPreviewCredits = selectedGrantUser && grantInternalAmount ? selectedGrantUser.credits - grantInternalAmount : undefined;

  async function refreshSession() {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const payload = (await response.json()) as AuthSession;
      setSession(payload);
      if (payload.authenticated) {
        if (payload.user?.role === "admin") {
          void refreshQuota(false);
        } else {
          setQuota(null);
        }
        void refreshHistory();
      } else {
        setHistory([]);
      }
    } catch {
      setSession({ authenticated: false });
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function submitAuth() {
    setAuthError("");
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authForm)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Auth failed");
      await refreshSession();
      setAuthForm((current) => ({ ...current, password: "" }));
    } catch (caught) {
      setAuthError(cleanErrorMessage(stringifyError(caught), language) || "登录失败，请检查账号信息。");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession({ authenticated: false });
    setQuota(null);
    setHistory([]);
  }

  async function refreshHistory() {
    try {
      const response = await fetch("/api/history", { cache: "no-store" });
      const payload = (await response.json()) as { history?: unknown };
      if (!response.ok) return;
      const next = normalizeHistoryItems(payload.history).slice(0, HISTORY_LIMIT);
      setHistory(next);
    } catch {
      setHistory([]);
    }
  }

  async function adjustUserCredits(operation: "add" | "subtract") {
    if (!isAdmin) {
      setGrantMessage(tx("adminOnly", "只有主账号可以操作积分。"));
      return;
    }
    if (!grantUserId) {
      setGrantMessage(tx("selectMember", "选择用户"));
      return;
    }
    if (!parseDisplayCredits(grantAmount)) {
      setGrantMessage(tx("invalidCreditAmount", "请输入大于 0 的积分"));
      return;
    }
    setGrantMessage("");
    try {
      const response = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: grantUserId,
          amount: parseDisplayCredits(grantAmount),
          operation,
          reason: operation === "subtract" ? "main account deduction" : "main account allocation"
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Credit allocation failed");
      await refreshSession();
      setGrantMessage(operation === "subtract" ? tx("subtractSuccess", "积分已扣减") : tx("grantSuccess", "积分已增加"));
    } catch (caught) {
      setGrantMessage(cleanErrorMessage(stringifyError(caught), language));
    }
  }

  async function refreshQuota(markLoading = true) {
    if (markLoading) setIsQuotaLoading(true);
    try {
      const response = await fetch("/api/quota");
      setQuota((await response.json()) as QuotaResult);
    } catch {
      setQuota({ connected: false, message: t.quotaUnknown });
    } finally {
      setIsQuotaLoading(false);
    }
  }

  async function addReferenceFiles(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const selected = incoming.slice(0, Math.max(MAX_REFERENCE_IMAGES - referenceFiles.length, 0));
    if (!selected.length) return;

    setIsOptimizingReferences(true);
    try {
      const optimized = await Promise.all(selected.map((file) => compressImage(file)));
      setReferenceFiles((current) => [...current, ...optimized]);
      setReferencePreviews((current) => [
        ...current,
        ...optimized.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
      ]);
      if (!isViduModelId(videoModel)) chooseVideoModel(getEffectiveVideoModel(videoSize, true, seconds));
    } finally {
      setIsOptimizingReferences(false);
    }
  }

  function removeReference(index: number) {
    const preview = referencePreviews[index];
    if (preview) URL.revokeObjectURL(preview.url);
    const nextFiles = referenceFiles.filter((_, itemIndex) => itemIndex !== index);
    setReferenceFiles(nextFiles);
    setReferencePreviews((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (!isViduModelId(videoModel)) {
      chooseVideoModel(getEffectiveVideoModel(videoSize, nextFiles.length > 0 || imageUrl.trim().length > 0, seconds));
    }
  }

  function clearReferences() {
    for (const preview of referencePreviews) URL.revokeObjectURL(preview.url);
    setReferenceFiles([]);
    setReferencePreviews([]);
    setImageUrl("");
    if (!isViduModelId(videoModel)) chooseVideoModel(getEffectiveVideoModel(videoSize, false, seconds));
  }

  function updateBatchPrompt(id: string, value: string) {
    setBatchPrompts((current) => current.map((item) => (item.id === id ? { ...item, value } : item)));
  }

  function getBatchSlotModel(slot: BatchPromptSlot) {
    return isViduModelId(videoModel) ? videoModel : getEffectiveVideoModel(videoSize, slot.referenceFiles.length > 0, seconds);
  }

  function chooseVideoModel(model: string) {
    setVideoModel(model);
    setSeconds((current) => normalizeDurationForModel(model, current, language));
  }

  async function addBatchReferenceFiles(id: string, files: FileList | null) {
    if (!files?.length) return;
    const slot = batchPrompts.find((item) => item.id === id);
    if (!slot) return;
    const incoming = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const selected = incoming.slice(0, Math.max(MAX_REFERENCE_IMAGES - slot.referenceFiles.length, 0));
    if (!selected.length) return;

    const optimized = await Promise.all(selected.map((file) => compressImage(file)));
    setBatchPrompts((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              referenceFiles: [...item.referenceFiles, ...optimized],
              referencePreviews: [
                ...item.referencePreviews,
                ...optimized.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }))
              ]
            }
          : item
      )
    );
  }

  function removeBatchReference(id: string, index: number) {
    setBatchPrompts((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const preview = item.referencePreviews[index];
        if (preview) URL.revokeObjectURL(preview.url);
        return {
          ...item,
          referenceFiles: item.referenceFiles.filter((_, itemIndex) => itemIndex !== index),
          referencePreviews: item.referencePreviews.filter((_, itemIndex) => itemIndex !== index)
        };
      })
    );
  }

  function clearBatchReferences(id: string) {
    setBatchPrompts((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        for (const preview of item.referencePreviews) URL.revokeObjectURL(preview.url);
        return { ...item, referenceFiles: [], referencePreviews: [] };
      })
    );
  }

  function saveHistory(item: Omit<HistoryItem, "id" | "createdAt">) {
    // History is created from user actions, so it needs a fresh client id.
    const nextItem = { ...item, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString() };
    const next = [nextItem, ...history].slice(0, HISTORY_LIMIT);
    setHistory(next);
    void fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextItem)
    })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const saved = normalizeHistoryItems(payload?.history ? [payload.history] : [])[0];
        if (saved) {
          setHistory((current) => current.map((entry) => entry.id === nextItem.id ? saved : entry));
        }
      })
      .catch(() => undefined);
  }

  function updateVideoHistory(taskId: string, result: VideoResult) {
    const previewUrl = getVideoUrl(result);
    setHistory((current) => {
      const next = current.map((item) =>
        item.videoId === taskId ? { ...item, previewUrl: previewUrl || item.previewUrl, status: result.status || item.status } : item
      );
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    void fetch("/api/history", { method: "DELETE" }).catch(() => undefined);
  }

  async function downloadGeneratedAsset() {
    if (!downloadUrl) return;
    const extension = downloadKind === "image" ? "png" : "mp4";
    const filename = `siyu-factory-${downloadKind}-${Date.now()}.${extension}`;

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
  }

  function restoreHistory(item: HistoryItem) {
    setMode(item.mode);
    setPrompt(item.prompt);
    setError("");
    if (item.mode === "image") {
      setImageModel(item.model);
      setImageResult(item.previewUrl ? { data: [{ url: item.previewUrl }] } : null);
      setVideoResult(null);
      return;
    }
    chooseVideoModel(item.model);
    setImageResult(null);
    const restored = { id: item.videoId, task_id: item.videoId, status: item.status || "queued", video_url: item.previewUrl };
    setVideoResult(restored);
    if (item.videoId && !isVideoDone(restored.status, restored) && !isVideoFailed(restored.status)) {
      setTimeout(() => void pollVideo(item.videoId || ""), 0);
    }
  }

  async function generateImage() {
    if (!currentUser) return;
    if (!canAffordActiveModel) {
      setError(tx("insufficientSiteCredits", "站内积分不足，请联系主账号分配积分。"));
      return;
    }
    setError("");
    setImageResult(null);
    setVideoResult(null);
    setIsLoading(true);
    setGenerationStatus({
      label: tx("statusSubmitting", "正在提交任务"),
      detail: tx("statusUploadingImage", "正在上传提示词和参考图。"),
      progress: 5,
      tone: "running"
    });
    try {
      if (referenceFiles.length > 0) {
        const formData = new FormData();
        formData.set("model", imageModel);
        formData.set("prompt", prompt);
        formData.set("size", imageSize);
        formData.set("aspect_ratio", "9:16");
        formData.set("n", "1");
        formData.set("response_format", "url");
        for (const reference of referenceFiles) formData.append("image", reference, reference.name);

        const response = await fetch("/api/images/generate", { method: "POST", body: formData });
        const payload = (await response.json()) as ImageResult;
        if (!response.ok || !extractImageUrl(payload)) throw new Error(JSON.stringify(payload));
        setImageResult(payload);
        setGenerationStatus({
          label: tx("statusCompleted", "生成完成"),
          detail: tx("statusImageReady", "图片已生成，可以预览和下载。"),
          progress: 100,
          tone: "done"
        });
        saveHistory({ mode: "image", model: imageModel, prompt, previewUrl: extractImageUrl(payload) });
        return;
      }

      const startResponse = await fetch("/api/images/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: imageModel,
          prompt,
          size: imageSize,
          aspect_ratio: "9:16",
          n: 1,
          response_format: "url"
        })
      });
      const started = (await startResponse.json()) as ImageJobResult;
      if (!startResponse.ok || !started.id) throw new Error(JSON.stringify(started));
      setGenerationStatus({
              label: tx("statusQueued", "任务已排队"),
        detail: started.id,
        progress: started.progress || 0,
        tone: "running"
      });

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const statusResponse = await fetch(`/api/images/status?id=${encodeURIComponent(started.id)}`);
        const status = (await statusResponse.json()) as ImageJobResult;
        if (!statusResponse.ok) throw new Error(JSON.stringify(status));
        setGenerationStatus({
          label: status.status || tx("statusProcessing", "生成中"),
          detail: started.id,
          progress: status.progress || 0,
          tone: "running"
        });
        if (status.status === "completed" && status.result) {
          setImageResult(status.result);
          setGenerationStatus({
          label: tx("statusCompleted", "生成完成"),
          detail: tx("statusImageReady", "图片已生成，可以预览和下载。"),
            progress: 100,
            tone: "done"
          });
          saveHistory({ mode: "image", model: imageModel, prompt, previewUrl: extractImageUrl(status.result) });
          return;
        }
        if (status.status === "failed") throw new Error(JSON.stringify(status.error || status));
      }

      throw new Error(language === "zh" ? "图片任务还在处理中，请稍后再试。" : "Image task is still processing. Try again later.");
    } catch (caught) {
      setError(stringifyError(caught) || t.imageFailed);
      setGenerationStatus({
        label: tx("statusFailed", "生成失败"),
        detail: cleanErrorMessage(stringifyError(caught), language),
        progress: 0,
        tone: "error"
      });
    } finally {
      await refreshSession();
      setIsLoading(false);
    }
  }

  async function submitVideo(videoPrompt: string, model: string, options?: { references?: File[]; referenceUrl?: string }) {
    const references = options?.references ?? referenceFiles;
    const referenceUrl = options?.referenceUrl ?? imageUrl;
    const formData = new FormData();
    formData.set("model", model);
    formData.set("prompt", videoPrompt);
    formData.set("seconds", normalizeDurationForModel(model, seconds, language));
    formData.set("size", videoSize);
    if (referenceUrl) formData.set("image_url", referenceUrl);
    for (const reference of references) formData.append("input_reference", reference, reference.name);

    const response = await fetch("/api/videos/generate", { method: "POST", body: formData });
    const payload = await readJsonResponse<VideoResult>(response);
    if (!response.ok) throw new Error(JSON.stringify(payload));
    return payload;
  }

  async function pollVideo(id: string, onUpdate?: (payload: VideoResult) => void, syncMainResult = true) {
    setIsPolling(true);
    try {
      let transientAttempts = 0;
      for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
        const response = await fetch(`/api/videos/${encodeURIComponent(id)}`);
        const payload = await readJsonResponse<VideoResult>(response);
        if (!response.ok && !isTransientVideoStatusError(payload)) throw new Error(JSON.stringify(payload));

        if (payload.transient || isTransientVideoStatusError(payload)) {
          transientAttempts += 1;
          if (transientAttempts >= VIDEO_MAX_TRANSIENT_ATTEMPTS) {
            throw new Error(getStaleVideoMessage(id, language));
          }
          const pending = { id, task_id: id, status: "queued", progress: 0, transient: true };
          onUpdate?.(pending);
          if (syncMainResult) setVideoResult((current) => current ?? pending);
          setGenerationStatus({
          label: tx("statusSyncing", "正在同步上游状态"),
            detail: id,
            progress: 0,
            tone: "running"
          });
          await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
          continue;
        }

        transientAttempts = 0;
        onUpdate?.(payload);
        if (syncMainResult) setVideoResult(payload);
        setGenerationStatus({
          label: payload.status || tx("statusProcessing", "生成中"),
          detail: id,
          progress: payload.progress || 0,
          tone: "running"
        });
        if (isVideoDone(payload.status, payload)) {
          setGenerationStatus({
          label: tx("statusCompleted", "生成完成"),
            detail: tx("statusVideoReady", "视频已生成，可以播放和下载。"),
            progress: 100,
            tone: "done"
          });
          updateVideoHistory(id, payload);
          return payload;
        }
        if (isVideoFailed(payload.status)) throw new Error(JSON.stringify(payload));
        await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
      }
      throw new Error(t.videoStillProcessing);
    } finally {
      setIsPolling(false);
    }
  }

  async function generateVideo() {
    if (!currentUser) return;
    if (!canAffordActiveModel) {
      setError(tx("insufficientSiteCredits", "站内积分不足，请联系主账号分配积分。"));
      return;
    }
    setError("");
    setImageResult(null);
    setVideoResult(null);
    setIsLoading(true);
    setGenerationStatus({
      label: tx("statusSubmitting", "正在提交任务"),
      detail: tx("statusUploadingVideo", "正在上传提示词和参考图。"),
      progress: 5,
      tone: "running"
    });
    try {
      const effectiveModel = videoModel || getEffectiveVideoModel(videoSize, singleVideoHasReference, seconds);
      chooseVideoModel(effectiveModel);

      for (let attempt = 0; attempt < MAX_VIDEO_ATTEMPTS; attempt += 1) {
        try {
          const payload = await submitVideo(prompt, effectiveModel);
          setVideoResult(payload);
          const taskId = getVideoTaskId(payload);
          if (taskId) {
            setGenerationStatus({
              label: tx("statusQueued", "任务已排队"),
              detail: taskId,
              progress: payload.progress || 0,
              tone: "running"
            });
            saveHistory({ mode: "video", model: effectiveModel, prompt, videoId: taskId, status: payload.status });
            void pollVideo(taskId);
          }
          return;
        } catch (caught) {
          const message = stringifyError(caught);
          if (attempt < MAX_VIDEO_ATTEMPTS - 1 && isUpstreamBusyError(message)) {
            setError(getRetryMessage(language, attempt));
            await wait(VIDEO_RETRY_DELAY_MS);
            continue;
          }
          throw caught;
        }
      }
    } catch (caught) {
      setError(cleanErrorMessage(stringifyError(caught), language) || t.videoFailed);
      setGenerationStatus({
        label: tx("statusFailed", "生成失败"),
        detail: cleanErrorMessage(stringifyError(caught), language),
        progress: 0,
        tone: "error"
      });
    } finally {
      await refreshSession();
      setIsLoading(false);
    }
  }

  async function generateBatchVideos() {
    if (!currentUser) return;
    const slots = filledBatchSlots;
    if (!slots.length) {
      setError(t.noBatchPrompt);
      return;
    }
    if (!canAffordBatch) {
      setError(tx("insufficientSiteCredits", "站内积分不足，请联系主账号分配积分。"));
      return;
    }

    setMode("video");
    setError("");
    setImageResult(null);
    setVideoResult(null);
    setIsLoading(true);
    setGenerationStatus({
      label: tx("statusSubmitting", "正在提交任务"),
      detail: tx("statusBatchStart", "批量视频会逐个提交并显示状态。"),
      progress: 5,
      tone: "running"
    });

    const initialJobs: BatchJob[] = slots.map((slot, index) => ({
      id: `${Date.now()}-${index}`,
      prompt: slot.value.trim(),
      model: getBatchSlotModel(slot),
      status: "queued",
      progress: 0,
      attempts: 0
    }));
    setBatchJobs(initialJobs);

    for (const [index, job] of initialJobs.entries()) {
      const slot = slots[index];
      const updateJob = (patch: Partial<BatchJob>) => {
        setBatchJobs((current) => current.map((item) => (item.id === job.id ? { ...item, ...patch } : item)));
      };

      try {
        let finalPayload: VideoResult | undefined;
        for (let attempt = 0; attempt < MAX_VIDEO_ATTEMPTS; attempt += 1) {
          try {
            updateJob({ status: "submitting", progress: 0, attempts: attempt + 1, error: "" });
            const payload = await submitVideo(job.prompt, job.model, { references: slot.referenceFiles, referenceUrl: "" });
            const taskId = getVideoTaskId(payload);
            updateJob({ taskId, status: payload.status || "queued", progress: payload.progress || 0 });
            if (!taskId) throw new Error(JSON.stringify(payload));
            saveHistory({ mode: "video", model: job.model, prompt: job.prompt, videoId: taskId, status: payload.status });
            finalPayload = await pollVideo(taskId, (next) => {
              updateJob({
                status: next.status || "queued",
                progress: next.progress || 0,
                url: getVideoUrl(next) || undefined
              });
            }, false);
            break;
          } catch (caught) {
            const message = stringifyError(caught);
            if (attempt < MAX_VIDEO_ATTEMPTS - 1 && isUpstreamBusyError(message)) {
              updateJob({ status: "retrying", error: getRetryMessage(language, attempt) });
              await wait(VIDEO_RETRY_DELAY_MS);
              continue;
            }
            throw caught;
          }
        }

        if (!finalPayload) throw new Error(t.videoFailed);
        updateJob({
          status: finalPayload.status || "completed",
          progress: finalPayload.progress ?? 100,
          url: getVideoUrl(finalPayload) || undefined
        });
      } catch (caught) {
        updateJob({ status: "failed", error: cleanErrorMessage(stringifyError(caught), language) });
      }
    }

    await refreshSession();
    setGenerationStatus({
      label: tx("statusBatchDone", "批量任务已处理完"),
      detail: tx("statusBatchDoneHint", "请在批量结果里查看每个视频的完成或失败状态。"),
      progress: 100,
      tone: "done"
    });
    setIsLoading(false);
  }

  if (isAuthLoading) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <div className="brand-mark"><Sparkles size={24} /></div>
          <h1>{tx("authLoading", "正在进入思雨的工厂")}</h1>
          <p>{tx("authLoadingHint", "正在检查登录状态和账户积分。")}</p>
          <Loader2 className="spin" size={28} />
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <div className="brand-mark"><Sparkles size={24} /></div>
          <h1>{tx("welcomeFactory", "欢迎来到思雨的工厂")}</h1>
          <p>{tx("authIntro", "注册或登录后进入工作台。账号会长期保留，不需要重复注册。")}</p>

          <div className="segmented auth-tabs">
            <button className={`segment ${authMode === "login" ? "active" : ""}`} onClick={() => setAuthMode("login")} type="button">
              <User size={16} />{tx("login", "登录")}
            </button>
            <button className={`segment ${authMode === "register" ? "active" : ""}`} onClick={() => setAuthMode("register")} type="button">
              <Plus size={16} />{tx("register", "注册")}
            </button>
          </div>

          <div className="auth-form">
            {authMode === "register" ? (
              <input
                className="input"
                onChange={(event) => setAuthForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={tx("name", "昵称")}
                value={authForm.name}
              />
            ) : null}
            <input
              className="input"
              onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
              placeholder={tx("email", "邮箱")}
              type="email"
              value={authForm.email}
            />
            <input
              className="input"
              onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
              placeholder={tx("password", "密码，至少 6 位")}
              type="password"
              value={authForm.password}
            />
            <button className="primary-button" onClick={() => void submitAuth()} type="button">
              {authMode === "login" ? <User size={18} /> : <Plus size={18} />}
              {authMode === "login" ? tx("login", "登录") : tx("register", "注册")}
            </button>
          </div>

          {authError ? <div className="status-alert">{authError}</div> : null}
          <p className="auth-footnote">{tx("authFootnote", "提示：注册过的账号会保存在服务端，下次可以直接登录。")}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {showWelcome ? (
        <div className="welcome-screen" role="status">
          <div className="welcome-mark"><Sparkles size={30} /></div>
          <h1>欢迎来到思雨的工厂！</h1>
        </div>
      ) : null}

      <div className="workspace">
        <aside className="rail">
          <div className="brand">
            <div className="brand-mark"><Sparkles size={22} /></div>
            <div>
              <h1 className="brand-title">{t.title}</h1>
              <p className="brand-subtitle">HellobabyGo AI gateway</p>
            </div>
          </div>

          <div className="account-card">
            <div>
              <span className="section-label compact">
                {isAdmin ? <Shield size={14} /> : <User size={14} />}
                {isAdmin ? tx("adminAccount", "管理员") : tx("memberAccount", "成员账号")}
              </span>
              <strong>{currentUser.name}</strong>
              <small>{currentUser.email}</small>
            </div>
            <button className="icon-button" onClick={() => void logout()} title={tx("logout", "退出登录")} type="button">
              <LogOut size={16} />
            </button>
          </div>

          <div className="quota-card">
            <div>
              <span className="section-label compact"><Wallet size={14} />{tx("siteCredits", "站内剩余积分")}</span>
              <strong>{formatDisplayCredits(currentUser.credits)}</strong>
              <small>{tx("siteCreditsHint", "生成会先扣这里的积分，不足时请联系主账号分配。")}</small>
            </div>
            <button className="icon-button" onClick={() => void refreshSession()} title={tx("refreshAccount", "刷新账号")} type="button">
              <RefreshCw size={16} />
            </button>
          </div>

          {isAdmin ? (
            <>
              <div className="quota-card upstream-card">
                <div>
                  <span className="section-label compact"><CreditCard size={14} />{tx("upstreamQuota", "主账号上游额度")}</span>
                  <strong>{quotaText}</strong>
                  <small>{quota?.connected ? t.quotaConnected : quota?.message || t.quotaUnknown}</small>
                </div>
                <button className="icon-button" onClick={() => refreshQuota()} title={t.refreshQuota} type="button">
                  {isQuotaLoading ? <Loader2 size={16} /> : <RefreshCw size={16} />}
                </button>
              </div>

              <a className="topup-button" href={TOPUP_URL} rel="noreferrer" target="_blank">
                <CreditCard size={17} />
                <span>{t.topUp}</span>
                <small>{t.topUpHint}</small>
              </a>

              <div className="admin-panel">
                <div className="admin-panel-head">
                  <p className="section-label compact"><Users size={14} />{tx("memberCredits", "成员积分管理")}</p>
                  <button className="text-button" onClick={() => void refreshSession()} type="button">{tx("refreshAccount", "刷新账号")}</button>
                </div>
                <select className="select" onChange={(event) => setGrantUserId(event.target.value)} value={grantUserId}>
                  <option value="">{tx("selectMember", "选择用户")}</option>
                  {(session?.users || []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {formatDisplayCredits(user.credits)}
                    </option>
                  ))}
                </select>

                <div className="credit-adjust-field">
                  <label htmlFor="credit-adjust-amount">{tx("creditAmount", "调整积分数量")}</label>
                  <input
                    className="input"
                    id="credit-adjust-amount"
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => setGrantAmount(event.target.value)}
                    placeholder="120"
                    step="1"
                    type="number"
                    value={grantAmount}
                  />
                  <small>{tx("creditAmountHint", "手动输入要增加或扣减的站内积分，例如 120。")}</small>
                </div>

                <div className="credit-preview-grid">
                  <div>
                    <span>{tx("selectedBalance", "当前余额")}</span>
                    <strong>{selectedGrantUser ? formatDisplayCredits(selectedGrantUser.credits) : "-"}</strong>
                  </div>
                  <div>
                    <span>{tx("afterAdd", "加后余额")}</span>
                    <strong>{addPreviewCredits !== undefined ? formatDisplayCredits(addPreviewCredits) : "-"}</strong>
                  </div>
                  <div>
                    <span>{tx("afterSubtract", "减后余额")}</span>
                    <strong className={subtractPreviewCredits !== undefined && subtractPreviewCredits < 0 ? "danger-text" : ""}>
                      {subtractPreviewCredits === undefined
                        ? "-"
                        : subtractPreviewCredits < 0
                          ? tx("insufficientAfterSubtract", "积分不足")
                          : formatDisplayCredits(subtractPreviewCredits)}
                    </strong>
                  </div>
                </div>

                <div className="grant-actions">
                  <button className="secondary-button" onClick={() => void adjustUserCredits("add")} type="button">
                    <Plus size={16} />{tx("addCredits", "加积分")}
                  </button>
                  <button className="danger-button" onClick={() => void adjustUserCredits("subtract")} type="button">
                    <Minus size={16} />{tx("subtractCredits", "减积分")}
                  </button>
                </div>
                {grantMessage ? <small className="admin-message">{grantMessage}</small> : null}
              </div>
            </>
          ) : null}

          <p className="section-label">{t.mediaType}</p>
          <div className="segmented" aria-label="media type">
            <button className={`segment ${mode === "image" ? "active" : ""}`} onClick={() => setMode("image")} type="button">
              <ImageIcon size={16} />{t.image}
            </button>
            <button className={`segment ${mode === "video" ? "active" : ""}`} onClick={() => setMode("video")} type="button">
              <Film size={16} />{t.video}
            </button>
          </div>

          <p className="section-label">{t.stableModels}</p>
          <div className="model-list">
            {(mode === "image" ? imageModels : videoModels).map((model) => {
              const active = mode === "image" ? imageModel === model : activeModel === model || videoModel === model;
              return (
                <button
                  className={`model-chip ${active ? "active" : ""}`}
                  key={model}
                  onClick={() => (mode === "image" ? setImageModel(model) : chooseVideoModel(model))}
                  title={model}
                  type="button"
                >
                  <div className="model-copy">
                    <span>{getModelTitle(model, language)}</span>
                    <em>{mode === "video" ? getModelDescription(model, language) : model}</em>
                  </div>
                  <small>{formatCreditCost(model, language, normalizeDurationForModel(model, seconds, language))}</small>
                  {active ? <Wand2 size={15} /> : null}
                </button>
              );
            })}
          </div>
          <div className="note">{t.note}</div>
        </aside>

        <section className="composer">
          <header className="topbar">
            <div>
              <h1>{t.title}</h1>
              <p>{t.subtitle}</p>
            </div>
            <div className="topbar-actions">
              <button className="status-pill" onClick={() => setLanguage(language === "zh" ? "en" : "zh")} type="button">
                <Languages size={15} />{language === "zh" ? "简体中文" : "English"}
              </button>
              <div className="status-pill"><Clapperboard size={15} />{activeModel}</div>
              <div className="status-pill cost-pill">{t.estimatedCost}: {formatCreditCost(activeModel, language, mode === "video" ? seconds : undefined)}</div>
            </div>
          </header>

          <div className="compose-body">
            {showCreditWarning ? (
              <div className="credit-warning">
                <Wallet size={18} />
                <div>
                  <strong>{tx("noCreditsTitle", "站内积分不足")}</strong>
                  <span>
                    {tx("noCreditsBody", "当前账号积分不够生成，请联系主账号分配积分后再试。")}
                    {" "}
                    {tx("estimatedCost", "预计消耗")}: {formatCreditCost(activeModel, language, mode === "video" ? seconds : undefined)}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="prompt">{t.prompt}</label>
              <textarea className="textarea" id="prompt" onChange={(event) => setPrompt(event.target.value)} placeholder={t.promptPlaceholder} value={prompt} />
            </div>

            {mode === "image" ? (
              <div className="param-grid">
                <div className="field">
                  <label htmlFor="image-size">{t.imageSize}</label>
                  <select className="select" id="image-size" onChange={(event) => setImageSize(event.target.value)} value={imageSize}>
                    <option value="1024x1792">9:16 - 1024x1792</option>
                    <option value="1024x1536">2:3 - 1024x1536</option>
                    <option value="1024x1024">1:1 - 1024x1024</option>
                    <option value="1536x1024">3:2 - 1536x1024</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="image-model">{t.currentModel}</label>
                  <input className="input" id="image-model" readOnly value={`${imageModel} · ${formatCreditCost(imageModel, language)}`} />
                </div>
                <div className="field">
                  <label>{t.estimatedCost}</label>
                  <button className="primary-button" disabled={!canSubmit} onClick={generateImage} type="button">
                    {isLoading ? <Loader2 size={18} /> : <Sparkles size={18} />}{t.generateImage}
                    <small>{formatCreditCost(imageModel, language)}</small>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="param-grid">
                  <div className="field">
                    <label htmlFor="video-size">{t.aspect}</label>
                    <select
                      className="select"
                      id="video-size"
                      onChange={(event) => {
                        const nextSize = event.target.value;
                        setVideoSize(nextSize);
                        if (!isViduModelId(videoModel)) {
                          chooseVideoModel(getEffectiveVideoModel(nextSize, referenceFiles.length > 0 || imageUrl.trim().length > 0, seconds));
                        }
                      }}
                      value={videoSize}
                    >
                      <option value="720x1280">{t.portrait}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="video-duration">{t.duration}</label>
                    <select
                      className="select"
                      disabled={durationOptions.length <= 1}
                      id="video-duration"
                      onChange={(event) => setSeconds(event.target.value)}
                      value={normalizeDurationForModel(videoModel, seconds, language)}
                    >
                      {durationOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>{t.estimatedCost}</label>
                    <button className="primary-button" disabled={!canSubmit} onClick={generateVideo} type="button">
                      {isLoading ? <Loader2 size={18} /> : <Play size={18} />}{t.generateVideo}
                      <small>{formatCreditCost(videoModel, language, seconds)}</small>
                    </button>
                  </div>
                </div>

                <div className="batch-panel">
                  <div className="field-head">
                    <label htmlFor="batch-prompt">{t.batchPrompt}</label>
                    <span>{t.batchLimit} · {t.batchEstimatedCost}: {formatCreditTotal(batchCreditTotal, language)}</span>
                  </div>
                  <div className="batch-grid">
                    {batchPrompts.map((slot, index) => (
                      <div className="batch-card" key={slot.id}>
                        <div className="batch-card-head">
                          <strong>{tx("work", "作品")} {index + 1}</strong>
                          <small>{formatCreditCost(getBatchSlotModel(slot), language, seconds)}</small>
                        </div>
                        <textarea
                          className="textarea batch-textarea"
                          id={index === 0 ? "batch-prompt" : undefined}
                          onChange={(event) => updateBatchPrompt(slot.id, event.target.value)}
                          placeholder={index === 0 ? t.batchPlaceholder : tx("batchCardPlaceholder", "填写这个作品的视频提示词")}
                          value={slot.value}
                        />
                        <div className="batch-reference-panel">
                          <div className="field-head compact-head">
                            <span>{tx("workReferences", "作品参考图")}</span>
                            <small>{slot.referenceFiles.length}/{MAX_REFERENCE_IMAGES}</small>
                          </div>
                          <label className="batch-reference-drop" htmlFor={`batch-reference-${slot.id}`}>
                            <ImagePlus size={16} />
                            <span>{slot.referenceFiles.length ? t.addReferences : t.uploadReferences}</span>
                          </label>
                          <input
                            accept="image/*"
                            id={`batch-reference-${slot.id}`}
                            multiple
                            onChange={(event) => {
                              void addBatchReferenceFiles(slot.id, event.target.files);
                              event.target.value = "";
                            }}
                            type="file"
                          />
                          {slot.referencePreviews.length ? (
                            <div className="batch-reference-grid">
                              {slot.referencePreviews.map((preview, previewIndex) => (
                                <div className="reference-thumb" key={`${slot.id}-${preview.name}-${preview.url}`}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img alt={preview.name} src={preview.url} />
                                  <button
                                    aria-label={t.removeReference}
                                    className="thumb-remove"
                                    onClick={() => removeBatchReference(slot.id, previewIndex)}
                                    title={t.removeReference}
                                    type="button"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {slot.referenceFiles.length ? (
                            <button className="text-button batch-clear" onClick={() => clearBatchReferences(slot.id)} type="button">
                              {t.clearAll}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button className="secondary-button" disabled={isLoading || isPolling || !canAffordBatch} onClick={generateBatchVideos} type="button">
                    {isLoading ? <Loader2 size={18} /> : <Clapperboard size={18} />}{t.generateBatch}
                    <small>{formatCreditTotal(batchCreditTotal, language)}</small>
                  </button>
                </div>
              </>
            )}

            <div className="field reference-field">
              <div className="field-head">
                <label htmlFor={referenceInputId}>{t.referenceImages}</label>
                <span>{t.referenceLimit}</span>
              </div>
              <div className="reference-panel">
                <label className="reference-drop" htmlFor={referenceInputId}>
                  <ImagePlus size={22} />
                  <strong>{referencePreviews.length ? t.addReferences : t.uploadReferences}</strong>
                  <span>{isOptimizingReferences ? "Optimizing..." : mode === "image" ? t.image : t.video}</span>
                </label>
                <input
                  accept="image/*"
                  id={referenceInputId}
                  multiple
                  onChange={(event) => {
                    void addReferenceFiles(event.target.files);
                    event.target.value = "";
                  }}
                  type="file"
                />

                {referencePreviews.length ? (
                  <div className="reference-grid">
                    {referencePreviews.map((preview, index) => (
                      <div className="reference-thumb" key={`${preview.name}-${preview.url}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={preview.name} src={preview.url} />
                        <button aria-label={t.removeReference} className="thumb-remove" onClick={() => removeReference(index)} title={t.removeReference} type="button">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {mode === "video" ? (
                  <div className="upload-actions reference-actions">
                    <input
                      className="input"
                      onChange={(event) => {
                        setImageUrl(event.target.value);
                        if (!isViduModelId(videoModel)) {
                          chooseVideoModel(getEffectiveVideoModel(videoSize, referenceFiles.length > 0 || event.target.value.trim().length > 0, seconds));
                        }
                      }}
                      placeholder={t.optionalReferenceUrl}
                      value={imageUrl}
                    />
                    <button className="secondary-button" disabled={!referenceFiles.length && !imageUrl} onClick={clearReferences} type="button">
                      <X size={16} />{t.clearAll}
                    </button>
                  </div>
                ) : (
                  <div className="reference-actions">
                    <button className="secondary-button" disabled={!referenceFiles.length} onClick={clearReferences} type="button">
                      <X size={16} />{t.clearAll}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {videoId ? (
              <button className="secondary-button" onClick={() => void pollVideo(videoId)} type="button">
                <RefreshCw size={17} />{t.refreshStatus}
              </button>
            ) : null}
          </div>
        </section>

        <aside className="result-panel">
          <div className="result-head">
            <div>
              <h2>{t.result}</h2>
              <p>{displayError ? t.resultError : t.resultIdle}</p>
            </div>
            {downloadUrl ? (
              <button className="secondary-button" onClick={() => void downloadGeneratedAsset()} type="button"><Download size={16} />{t.download}</button>
            ) : null}
          </div>

          <div className={`generation-status ${generationStatus.tone || "idle"}`}>
            <div>
              <strong>{generationStatus.label}</strong>
              <span>{generationStatus.detail}</span>
            </div>
            <small>{Math.max(0, Math.min(100, generationStatus.progress || 0))}%</small>
            <div className="status-track">
              <span style={{ width: `${Math.max(0, Math.min(100, generationStatus.progress || 0))}%` }} />
            </div>
          </div>

          <div className="preview">
            {activeImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Generated result" src={activeImageUrl} />
            ) : videoSrc ? (
              <video controls src={videoSrc} />
            ) : videoResult && !isVideoDone(videoResult.status, videoResult) ? (
              <div className="empty-state">
                <Loader2 className="spin" size={44} />
                <strong>{videoResult.status || "queued"}</strong>
                <span>{t.videoStillProcessing}</span>
              </div>
            ) : (
              <div className="empty-state">
                {mode === "image" ? <ImageIcon size={44} /> : <Film size={44} />}
                <strong>{t.waiting}</strong>
                <span>{t.waitingHint}</span>
              </div>
            )}
          </div>

          {needsTopUp ? (
          <div className="quota-alert">
              <strong>{t.quotaErrorTitle}</strong>
              <span>{isAdmin ? t.quotaErrorBody : tx("memberQuotaErrorBody", "上游账户余额不足，请联系主账号处理充值后再生成。")}</span>
              {isAdmin ? (
                <a className="secondary-button" href={TOPUP_URL} rel="noreferrer" target="_blank"><CreditCard size={16} />{t.topUp}</a>
              ) : null}
            </div>
          ) : null}
          {displayError ? <div className="status-alert">{displayError}</div> : null}

          {batchJobs.length ? (
            <div className="batch-results">
              {batchJobs.map((job, index) => (
                <div className="batch-job" key={job.id}>
                  <div>
                    <strong>#{index + 1} {job.status}</strong>
                    <span>{job.progress}% · {job.model} · {formatCreditCost(job.model, language, seconds)}</span>
                    <small>{job.prompt}</small>
                  </div>
                  {job.url ? <a className="secondary-button" download href={job.url} target="_blank" rel="noreferrer"><Download size={15} />{t.download}</a> : null}
                  {job.error ? <p>{job.error}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {imageResult ? (
            <details className="debug-box">
              <summary>API response</summary>
              <pre>{JSON.stringify(imageResult, null, 2)}</pre>
            </details>
          ) : null}
          {videoResult && !videoResult.transient ? (
            <details className="debug-box">
              <summary>API response</summary>
              <pre>{JSON.stringify(videoResult, null, 2)}</pre>
            </details>
          ) : null}

          <div className="history-panel">
            <div className="history-head">
              <h3>{t.history}</h3>
              <button className="text-button" disabled={!history.length} onClick={clearHistory} type="button">{t.clearHistory}</button>
            </div>
            {history.length ? (
              <>
                <div className="history-section-title"><ImageIcon size={14} />{t.image}</div>
                <div className="history-list">
                  {imageHistory.map((item) => (
                    <button className="history-item" key={item.id} onClick={() => restoreHistory(item)} type="button">
                      <div className="history-thumb">
                        {item.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={item.prompt} src={item.previewUrl} />
                        ) : <ImageIcon size={22} />}
                      </div>
                      <div>
                        <strong>{t.image}</strong>
                        <span>{item.prompt}</span>
                        <small>{new Date(item.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small>
                      </div>
                    </button>
                  ))}
                  {!imageHistory.length ? <p className="history-empty">{t.historyEmpty}</p> : null}
                </div>
                <div className="history-section-title"><Film size={14} />{t.video}</div>
                <div className="history-list">
                  {videoHistory.map((item) => {
                    const previewUrl = getHistoryVideoPreviewUrl(item);
                    return (
                      <button className="history-item" key={item.id} onClick={() => restoreHistory(item)} type="button">
                        <div className="history-thumb video-thumb">
                          {previewUrl ? (
                            <video muted playsInline preload="metadata" src={previewUrl} />
                          ) : <Film size={22} />}
                        </div>
                        <div>
                          <strong>{t.video}</strong>
                          <span>{item.prompt}</span>
                          <small>{new Date(item.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small>
                        </div>
                      </button>
                    );
                  })}
                  {!videoHistory.length ? <p className="history-empty">{t.historyEmpty}</p> : null}
                </div>
              </>
            ) : <p className="history-empty">{t.historyEmpty}</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}
