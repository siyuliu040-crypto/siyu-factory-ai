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
  Play,
  RefreshCw,
  Sparkles,
  Wallet,
  Wand2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

const TOPUP_URL = "https://api.hellobabygo.com/console/topup";
const MAX_REFERENCE_IMAGES = 6;
const MAX_REFERENCE_SIDE = 1280;
const REFERENCE_IMAGE_QUALITY = 0.82;
const HISTORY_KEY = "siyu-factory-generation-history";
const HISTORY_LIMIT = 40;
const MAX_BATCH_VIDEOS = 4;
const MAX_VIDEO_ATTEMPTS = 3;
const VIDEO_RETRY_DELAY_MS = 30000;
const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_POLL_ATTEMPTS = 180;
const VIDEO_MAX_TRANSIENT_ATTEMPTS = 36;

const stableImageModels = ["gpt-image-2"];

const stableVideoModels = [
  "veo_3_1-fast-portrait",
  "veo_3_1-fast-landscape",
  "veo_3_1-fast-portrait-hd",
  "veo_3_1-fast-landscape-hd"
];

const modelCreditCosts: Record<string, number> = {
  "gpt-image-2": 40000,
  "veo_3_1-fast-portrait": 1200000,
  "veo_3_1-fast-landscape": 1200000,
  "veo_3_1-fast-portrait-hd": 1200000,
  "veo_3_1-fast-landscape-hd": 1200000
};

const copy = {
  zh: {
    mediaType: "媒体类型",
    image: "图片",
    video: "视频",
    stableModels: "稳定模型",
    note: "只展示当前入口验证过的稳定模型。图片会在后台生成，通常约 2 分钟。API Key 保存在服务端，不会暴露给浏览器。",
    title: "思雨的工厂",
    subtitle: "图片、视频、批量视频统一生产台。",
    prompt: "提示词",
    batchPrompt: "批量视频提示词",
    promptPlaceholder: "描述画面、产品、人物、动作、镜头和风格。",
    batchPlaceholder: "每个视频一段提示词。用空行分隔；如果没有空行，则按每一行分隔。",
    imageSize: "图片尺寸",
    currentModel: "当前模型",
    generateImage: "生成图片",
    generateVideo: "生成视频",
    generateBatch: "批量生成视频",
    duration: "时长",
    seconds4: "4 秒",
    seconds8: "8 秒",
    seconds12: "12 秒",
    aspect: "画幅",
    portrait: "9:16 竖屏",
    landscape: "16:9 横屏",
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
    imageFailed: "图片生成失败",
    videoFailed: "视频生成失败",
    videoStillProcessing: "视频任务还在处理中，系统会继续查询。",
    videoStatusFailed: "视频状态查询失败",
    syncing: "上游任务状态还在同步，请稍等，系统会继续查询。",
    batchLimit: `一次最多 ${MAX_BATCH_VIDEOS} 个视频，系统会逐个排队生成，避免上游拥堵。`,
    noBatchPrompt: "请至少填写一个批量视频提示词。",
    estimatedCost: "预计消耗",
    batchEstimatedCost: "批量预计消耗",
    credits: "积分",
    costUnknown: "按上游实际扣费",
    pricingNote: "积分为当前平台扣费口径的预估显示，最终以 HellobabyGo 账单为准。"
  },
  en: {
    mediaType: "Media type",
    image: "Image",
    video: "Video",
    stableModels: "Stable models",
    note: "Only verified models are shown. Images run as background jobs and usually take about 2 minutes. API keys stay on the server.",
    title: "Siyu Factory",
    subtitle: "Image, video, and batch video production desk.",
    prompt: "Prompt",
    batchPrompt: "Batch video prompts",
    promptPlaceholder: "Describe the scene, product, subject, movement, camera, and style.",
    batchPlaceholder: "One prompt per video. Separate with blank lines, or use one prompt per line.",
    imageSize: "Image size",
    currentModel: "Current model",
    generateImage: "Generate image",
    generateVideo: "Generate video",
    generateBatch: "Batch generate videos",
    duration: "Duration",
    seconds4: "4 seconds",
    seconds8: "8 seconds",
    seconds12: "12 seconds",
    aspect: "Aspect",
    portrait: "9:16 portrait",
    landscape: "16:9 landscape",
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
    imageFailed: "Image generation failed",
    videoFailed: "Video generation failed",
    videoStillProcessing: "The video task is still processing. The system will keep checking.",
    videoStatusFailed: "Video status query failed",
    syncing: "The upstream task status is still syncing. The system will keep checking.",
    batchLimit: `Up to ${MAX_BATCH_VIDEOS} videos per batch. They run one by one to avoid upstream congestion.`,
    noBatchPrompt: "Add at least one batch video prompt.",
    estimatedCost: "Estimated cost",
    batchEstimatedCost: "Batch estimated cost",
    credits: "credits",
    costUnknown: "Billed by upstream",
    pricingNote: "Credit costs are shown as current platform estimates. Final billing follows the HellobabyGo statement."
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
  return modelCreditCosts[model];
}

function formatCreditCost(model: string, language: Language) {
  const cost = getModelCreditCost(model);
  if (!cost) return copy[language].costUnknown;
  return `${cost.toLocaleString()} ${copy[language].credits}`;
}

function formatCreditTotal(cost: number | undefined, language: Language) {
  if (!cost) return copy[language].costUnknown;
  return `${cost.toLocaleString()} ${copy[language].credits}`;
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
  return size.includes("1280x720")
    ? "veo_3_1-fast-landscape-hd"
    : "veo_3_1-fast-portrait-hd";
}

function getFastVideoModel(size: string) {
  return size.includes("1280x720")
    ? "veo_3_1-fast-landscape"
    : "veo_3_1-fast-portrait";
}

function getEffectiveVideoModel(size: string, hasReference: boolean) {
  return hasReference ? getReferenceVideoModel(size) : getFastVideoModel(size);
}

function parseBatchPrompts(value: string) {
  const byBlocks = value
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
  const prompts = byBlocks.length > 1 ? byBlocks : value.split("\n").map((item) => item.trim()).filter(Boolean);
  return prompts.slice(0, MAX_BATCH_VIDEOS);
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

function readHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(HISTORY_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(items: HistoryItem[]) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
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
  const [batchPrompt, setBatchPrompt] = useState(
    "9:16 vertical, ultra-realistic beauty commercial, woman slowly turns to show short curly pixie wig, warm studio light, no text\n\n9:16 vertical, macro close-up of short curly pixie wig texture, fingers lift and release curls, soft highlights, no text"
  );
  const [imageSize, setImageSize] = useState("1024x1792");
  const [seconds, setSeconds] = useState("8");
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
  const [history, setHistory] = useState<HistoryItem[]>(() => readHistory());
  const [isOptimizingReferences, setIsOptimizingReferences] = useState(false);
  const [error, setError] = useState("");
  const [showWelcome, setShowWelcome] = useState(true);
  const t = copy[language];

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
    void refreshQuota();
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
  const canSubmit = prompt.trim().length > 0 && !isLoading && !isPolling;
  const quotaValue = findQuotaValue(quota?.data, language);
  const quotaText = quotaValue || (quota?.connected ? t.quotaUnavailable : t.quotaUnknown);
  const displayError = cleanErrorMessage(error, language);
  const needsTopUp = isInsufficientQuota(error);
  const referenceInputId = `reference-images-${mode}`;
  const activeModel = mode === "image" ? imageModel : videoModel;
  const activeModelCost = getModelCreditCost(activeModel);
  const batchPromptCount = parseBatchPrompts(batchPrompt).length;
  const batchCreditTotal = activeModelCost && batchPromptCount ? activeModelCost * batchPromptCount : undefined;

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
      setVideoModel(getEffectiveVideoModel(videoSize, true));
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
    setVideoModel(getEffectiveVideoModel(videoSize, nextFiles.length > 0 || imageUrl.trim().length > 0));
  }

  function clearReferences() {
    for (const preview of referencePreviews) URL.revokeObjectURL(preview.url);
    setReferenceFiles([]);
    setReferencePreviews([]);
    setImageUrl("");
    setVideoModel(getEffectiveVideoModel(videoSize, false));
  }

  function saveHistory(item: Omit<HistoryItem, "id" | "createdAt">) {
    // History is created from user actions, so it needs a fresh client id.
    const nextItem = { ...item, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString() };
    const next = [nextItem, ...history].slice(0, HISTORY_LIMIT);
    setHistory(next);
    writeHistory(next);
  }

  function updateVideoHistory(taskId: string, result: VideoResult) {
    const previewUrl = getVideoUrl(result);
    setHistory((current) => {
      const next = current.map((item) =>
        item.videoId === taskId ? { ...item, previewUrl: previewUrl || item.previewUrl, status: result.status || item.status } : item
      );
      writeHistory(next);
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    window.localStorage.removeItem(HISTORY_KEY);
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
    setVideoModel(item.model);
    setImageResult(null);
    const restored = { id: item.videoId, task_id: item.videoId, status: item.status || "queued", video_url: item.previewUrl };
    setVideoResult(restored);
    if (item.videoId && !isVideoDone(restored.status, restored) && !isVideoFailed(restored.status)) {
      setTimeout(() => void pollVideo(item.videoId || ""), 0);
    }
  }

  async function generateImage() {
    setError("");
    setImageResult(null);
    setVideoResult(null);
    setIsLoading(true);
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

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const statusResponse = await fetch(`/api/images/status?id=${encodeURIComponent(started.id)}`);
        const status = (await statusResponse.json()) as ImageJobResult;
        if (!statusResponse.ok) throw new Error(JSON.stringify(status));
        if (status.status === "completed" && status.result) {
          setImageResult(status.result);
          saveHistory({ mode: "image", model: imageModel, prompt, previewUrl: extractImageUrl(status.result) });
          return;
        }
        if (status.status === "failed") throw new Error(JSON.stringify(status.error || status));
      }

      throw new Error(language === "zh" ? "图片任务还在处理中，请稍后再试。" : "Image task is still processing. Try again later.");
    } catch (caught) {
      setError(stringifyError(caught) || t.imageFailed);
    } finally {
      setIsLoading(false);
    }
  }

  async function submitVideo(videoPrompt: string, model: string) {
    const formData = new FormData();
    formData.set("model", model);
    formData.set("prompt", videoPrompt);
    formData.set("seconds", seconds);
    formData.set("size", videoSize);
    if (imageUrl) formData.set("image_url", imageUrl);
    for (const reference of referenceFiles) formData.append("input_reference", reference, reference.name);

    const response = await fetch("/api/videos/generate", { method: "POST", body: formData });
    const payload = (await response.json()) as VideoResult;
    if (!response.ok) throw new Error(JSON.stringify(payload));
    return payload;
  }

  async function pollVideo(id: string, onUpdate?: (payload: VideoResult) => void, syncMainResult = true) {
    setIsPolling(true);
    try {
      let transientAttempts = 0;
      for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
        const response = await fetch(`/api/videos/${encodeURIComponent(id)}`);
        const payload = (await response.json()) as VideoResult;
        if (!response.ok && !isTransientVideoStatusError(payload)) throw new Error(JSON.stringify(payload));

        if (payload.transient || isTransientVideoStatusError(payload)) {
          transientAttempts += 1;
          if (transientAttempts >= VIDEO_MAX_TRANSIENT_ATTEMPTS) {
            throw new Error(getStaleVideoMessage(id, language));
          }
          const pending = { id, task_id: id, status: "queued", progress: 0, transient: true };
          onUpdate?.(pending);
          if (syncMainResult) setVideoResult((current) => current ?? pending);
          await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
          continue;
        }

        transientAttempts = 0;
        onUpdate?.(payload);
        if (syncMainResult) setVideoResult(payload);
        if (isVideoDone(payload.status, payload)) {
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
    setError("");
    setImageResult(null);
    setVideoResult(null);
    setIsLoading(true);
    try {
      const hasReference = referenceFiles.length > 0 || imageUrl.trim().length > 0;
      const effectiveModel = getEffectiveVideoModel(videoSize, hasReference);
      setVideoModel(effectiveModel);

      for (let attempt = 0; attempt < MAX_VIDEO_ATTEMPTS; attempt += 1) {
        try {
          const payload = await submitVideo(prompt, effectiveModel);
          setVideoResult(payload);
          const taskId = getVideoTaskId(payload);
          if (taskId) {
            saveHistory({ mode: "video", model: effectiveModel, prompt, videoId: taskId, status: payload.status });
            await pollVideo(taskId);
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
    } finally {
      setIsLoading(false);
    }
  }

  async function generateBatchVideos() {
    const prompts = parseBatchPrompts(batchPrompt);
    if (!prompts.length) {
      setError(t.noBatchPrompt);
      return;
    }

    setMode("video");
    setError("");
    setImageResult(null);
    setVideoResult(null);
    setIsLoading(true);

    const hasReference = referenceFiles.length > 0 || imageUrl.trim().length > 0;
    const effectiveModel = getEffectiveVideoModel(videoSize, hasReference);
    setVideoModel(effectiveModel);

    const initialJobs: BatchJob[] = prompts.map((item, index) => ({
      id: `${Date.now()}-${index}`,
      prompt: item,
      model: effectiveModel,
      status: "queued",
      progress: 0,
      attempts: 0
    }));
    setBatchJobs(initialJobs);

    for (const job of initialJobs) {
      const updateJob = (patch: Partial<BatchJob>) => {
        setBatchJobs((current) => current.map((item) => (item.id === job.id ? { ...item, ...patch } : item)));
      };

      try {
        let finalPayload: VideoResult | undefined;
        for (let attempt = 0; attempt < MAX_VIDEO_ATTEMPTS; attempt += 1) {
          try {
            updateJob({ status: "submitting", progress: 0, attempts: attempt + 1, error: "" });
            const payload = await submitVideo(job.prompt, effectiveModel);
            const taskId = getVideoTaskId(payload);
            updateJob({ taskId, status: payload.status || "queued", progress: payload.progress || 0 });
            if (!taskId) throw new Error(JSON.stringify(payload));
            saveHistory({ mode: "video", model: effectiveModel, prompt: job.prompt, videoId: taskId, status: payload.status });
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

    setIsLoading(false);
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

          <div className="quota-card">
            <div>
              <span className="section-label compact"><Wallet size={14} />{t.quota}</span>
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
              const active = mode === "image" ? imageModel === model : videoModel === model;
              return (
                <button
                  className={`model-chip ${active ? "active" : ""}`}
                  key={model}
                  onClick={() => (mode === "image" ? setImageModel(model) : setVideoModel(model))}
                  title={model}
                  type="button"
                >
                  <span>{model}</span>
                  <small>{formatCreditCost(model, language)}</small>
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
                <Languages size={15} />{language === "zh" ? "中文" : "English"}
              </button>
              <div className="status-pill"><Clapperboard size={15} />{activeModel}</div>
              <div className="status-pill cost-pill">{t.estimatedCost}: {formatCreditCost(activeModel, language)}</div>
            </div>
          </header>

          <div className="compose-body">
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
                    <label htmlFor="seconds">{t.duration}</label>
                    <select className="select" id="seconds" onChange={(event) => setSeconds(event.target.value)} value={seconds}>
                      <option value="4">{t.seconds4}</option>
                      <option value="8">{t.seconds8}</option>
                      <option value="12">{t.seconds12}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="video-size">{t.aspect}</label>
                    <select
                      className="select"
                      id="video-size"
                      onChange={(event) => {
                        const nextSize = event.target.value;
                        setVideoSize(nextSize);
                        setVideoModel(getEffectiveVideoModel(nextSize, referenceFiles.length > 0 || imageUrl.trim().length > 0));
                      }}
                      value={videoSize}
                    >
                      <option value="720x1280">{t.portrait}</option>
                      <option value="1280x720">{t.landscape}</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>{t.estimatedCost}</label>
                    <button className="primary-button" disabled={!canSubmit} onClick={generateVideo} type="button">
                      {isLoading || isPolling ? <Loader2 size={18} /> : <Play size={18} />}{t.generateVideo}
                      <small>{formatCreditCost(videoModel, language)}</small>
                    </button>
                  </div>
                </div>

                <div className="batch-panel">
                  <div className="field-head">
                    <label htmlFor="batch-prompt">{t.batchPrompt}</label>
                    <span>{t.batchLimit} · {t.batchEstimatedCost}: {formatCreditTotal(batchCreditTotal, language)}</span>
                  </div>
                  <textarea className="textarea batch-textarea" id="batch-prompt" onChange={(event) => setBatchPrompt(event.target.value)} placeholder={t.batchPlaceholder} value={batchPrompt} />
                  <button className="secondary-button" disabled={isLoading || isPolling} onClick={generateBatchVideos} type="button">
                    {isLoading ? <Loader2 size={18} /> : <Clapperboard size={18} />}{t.generateBatch}
                    <small>{formatCreditTotal(batchCreditTotal, language)}</small>
                  </button>
                </div>
              </>
            )}

            <div className="field">
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
                        setVideoModel(getEffectiveVideoModel(videoSize, referenceFiles.length > 0 || event.target.value.trim().length > 0));
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
          <div className="pricing-note">{t.pricingNote}</div>
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
              <span>{t.quotaErrorBody}</span>
              <a className="secondary-button" href={TOPUP_URL} rel="noreferrer" target="_blank"><CreditCard size={16} />{t.topUp}</a>
            </div>
          ) : null}
          {displayError ? <div className="status-alert">{displayError}</div> : null}

          {batchJobs.length ? (
            <div className="batch-results">
              {batchJobs.map((job, index) => (
                <div className="batch-job" key={job.id}>
                  <div>
                    <strong>#{index + 1} {job.status}</strong>
                    <span>{job.progress}% · {job.model} · {formatCreditCost(job.model, language)}</span>
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
              <div className="history-list">
                {history.map((item) => (
                  <button className="history-item" key={item.id} onClick={() => restoreHistory(item)} type="button">
                    <div className="history-thumb">
                      {item.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={item.prompt} src={item.previewUrl} />
                      ) : item.mode === "video" ? <Film size={22} /> : <ImageIcon size={22} />}
                    </div>
                    <div>
                      <strong>{item.mode === "image" ? t.image : t.video}</strong>
                      <span>{item.prompt}</span>
                      <small>{new Date(item.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small>
                    </div>
                  </button>
                ))}
              </div>
            ) : <p className="history-empty">{t.historyEmpty}</p>}
          </div>
        </aside>
      </div>
    </main>
  );
}
