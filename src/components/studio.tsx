"use client";

import {
  Activity,
  CheckCircle2,
  Clapperboard,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  Film,
  FolderOpen,
  Home,
  Image as ImageIcon,
  ImagePlus,
  KeyRound,
  Languages,
  Layers3,
  Loader2,
  LogOut,
  Minus,
  Plus,
  Play,
  RefreshCw,
  Save,
  Shield,
  ShoppingBag,
  Sparkles,
  Table2,
  User,
  Users,
  Wallet,
  Wand2,
  X
} from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { MODEL_CREDIT_COSTS, getVideoGenerationCost } from "@/lib/pricing";
import { getHfsyImageModel, getHfsyModel } from "@/lib/hfsy";
import { getSyModel, syModelSupportsEndFrame } from "@/lib/sy";
import { getPromptLimit } from "@/lib/prompt-limits";

type Mode = "image" | "video";
type Language = "zh" | "en";
type WorkspaceTool = "home" | "image" | "video" | "deepseek" | "batch" | "library" | "tiktok";
type DeepSeekTask = "image_prompt" | "video_prompt" | "batch_shots" | "product_copy";
type TiktokCategory = "full-moon" | "custom-followers" | "showcase";

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
  label: string;
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
  error?: string;
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

type ImageTask = {
  id: string;
  prompt: string;
  model: string;
  status: string;
  progress: number;
  result?: ImageResult;
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
  adminId?: string;
  ledger?: LedgerEntry[];
  storage?: { persistent?: boolean; label?: string };
};

type UsageSummary = {
  date: string;
  totals: {
    spent: number;
    refunded: number;
    netSpent: number;
    tasks: number;
  };
  users: Array<{
    user: AccountUser;
    date: string;
    spent: number;
    refunded: number;
    netSpent: number;
    adminAdded: number;
    adminSubtracted: number;
    tasks: {
      total: number;
      completed: number;
      failed: number;
      running: number;
    };
  }>;
};

type GenerationStatus = {
  label: string;
  detail?: string;
  progress?: number;
  tone?: "idle" | "running" | "done" | "error";
};

type DeepSeekResult = {
  text?: string;
  model?: string;
  task?: DeepSeekTask;
  charged?: number;
  balance?: number;
  raw?: unknown;
};

type TiktokInventoryRow = {
  id: string;
  imageUrl?: string;
  account: string;
  price: string;
  followers: string;
  twoFa: string;
  email: string;
  status: string;
  notes: string;
  updatedAt?: string;
};

type TiktokInventory = Record<TiktokCategory, TiktokInventoryRow[]>;

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
const IMAGE_TASKS_STORAGE_KEY = "siyu-factory-image-tasks";

function getBaseImageModelId(model: string) {
  return getHfsyImageModel(model)?.id || model;
}

function readStoredImageTasks() {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(IMAGE_TASKS_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ImageTask => Boolean(item?.id && item?.prompt && item?.model))
      .slice(0, 20);
  } catch {
    window.localStorage.removeItem(IMAGE_TASKS_STORAGE_KEY);
    return [];
  }
}

const stableImageModels = [
  "hfsy:nano-banana-2",
  "hfsy:nano-banana-pro",
  "hfsy:gpt-image-2",
  "hfsy:gpt-image-2pro"
];

const stableVideoModels = [
  "veo_3_1-fast-portrait-fl-hd",
  "sy:grok-Yun",
  "hfsy:sora-2",
  "hfsy:sd-2-fast",
  "hfsy:sd-2",
  "hfsy:sd-2-vip",
  "hfsy:kling-o3",
  "sora-2-4s-9x16",
  "sora-2-8s-9x16",
  "vidu:viduq3-pro-fast",
  "vidu:viduq3-turbo",
  "vidu:viduq3-pro",
  "grok-imagine-1.0-video-ref-6s",
  "grok-imagine-1.0-video-ref-10s"
];

const stableDeepSeekModels = ["deepseek-v4-flash", "deepseek-v4-pro", "omni_flash"];
const deepSeekTaskOptions: DeepSeekTask[] = ["image_prompt", "video_prompt", "batch_shots", "product_copy"];

const modelCreditCosts: Record<string, number> = MODEL_CREDIT_COSTS;

const tiktokProducts: Array<{
  id: TiktokCategory;
  title: string;
  subtitle: string;
  priceLine: string;
  badge: string;
}> = [
  {
    id: "full-moon",
    title: "满月白号",
    subtitle: "6 元 · 2FA 验证 · 首次登录包售后",
    priceLine: "6 元固定价",
    badge: "2FA"
  },
  {
    id: "custom-followers",
    title: "自选号",
    subtitle: "1000-5000 粉丝 · 可按账号资料筛选",
    priceLine: "按账号定价",
    badge: "自选"
  },
  {
    id: "showcase",
    title: "橱窗号",
    subtitle: "适合 TikTok Shop / 橱窗带货账号池",
    priceLine: "按橱窗资质定价",
    badge: "橱窗"
  }
];

function createTiktokRow(category: TiktokCategory): TiktokInventoryRow {
  const defaults: Record<TiktokCategory, Partial<TiktokInventoryRow>> = {
    "full-moon": {
      account: "满月白号",
      price: "6",
      followers: "0",
      twoFa: "已开 2FA",
      email: "首次登录包售后",
      status: "现货",
      notes: "可上传截图或账号资料图"
    },
    "custom-followers": {
      account: "自选号",
      price: "按账号定价",
      followers: "1000-5000",
      twoFa: "按账号情况",
      email: "可备注邮箱",
      status: "可选",
      notes: "支持按粉丝、地区、内容方向筛选"
    },
    showcase: {
      account: "橱窗号",
      price: "按资质定价",
      followers: "按账号情况",
      twoFa: "按账号情况",
      email: "可备注邮箱",
      status: "可售",
      notes: "备注橱窗状态、国家和类目"
    }
  };
  return {
    id: `${category}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    imageUrl: "",
    account: defaults[category].account || "",
    price: defaults[category].price || "",
    followers: defaults[category].followers || "",
    twoFa: defaults[category].twoFa || "",
    email: defaults[category].email || "",
    status: defaults[category].status || "",
    notes: defaults[category].notes || "",
    updatedAt: new Date().toISOString()
  };
}

function createInitialTiktokInventory(): TiktokInventory {
  return {
    "full-moon": [createTiktokRow("full-moon")],
    "custom-followers": [createTiktokRow("custom-followers")],
    showcase: [createTiktokRow("showcase")]
  };
}

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
    resolution: "清晰度",
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
    referenceLimit: `最多 ${MAX_REFERENCE_IMAGES} 张，可按你的顺序标注 Image 1 / Image 2`,
    referenceLabel: "图片编号",
    referenceLabelHint: "提示词里写 Image 3 时，会对应标注为 Image 3 的图片。",
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
    viewResult: "查看",
    waiting: "等待生成",
    waitingHint: "提交任务后，进度和预览会自动出现在这里。",
    imageSubmitted: "图片任务提交成功",
    imageSubmittedHint: "系统正在后台生成，您可以继续提交下一张图片。",
    imageTasks: "图片任务",
    imageTaskEmpty: "当前还没有图片任务。",
    quota: "剩余额度",
    refreshQuota: "刷新额度",
    quotaConnected: "Key 已连接",
    quotaUnavailable: "余额接口未开放",
    quotaUnknown: "无法读取",
    topUp: "充值",
    topUpHint: "上游钱包",
    quotaErrorTitle: "上游账户余额不足",
    quotaErrorBody: "对应上游账户余额不足，请联系主账号充值后再生成。",
    memberQuotaErrorBody: "上游账户余额不足，请联系主账号处理充值后再生成。",
    adminOnly: "只有管理员可以操作积分。",
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
    promptLimit: "提示词上限",
    promptTooLong: "提示词太长，请先精简后再生成。",
    promptCounter: "当前 / 上限",
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
    userDeleted: "用户已删除",
    roleUpdated: "管理员权限已更新",
    makeAdmin: "设为管理员",
    removeAdmin: "取消管理员",
    deleteUser: "删除用户",
    primaryAdminOnly: "只有主账号可以管理用户。",
    primaryAccount: "主账号",
    adminRole: "管理员",
    memberRole: "成员",
    name: "昵称",
    email: "邮箱",
    editName: "修改昵称",
    saveName: "保存昵称",
    nameSaved: "昵称已更新",
    namePlaceholder: "输入新昵称",
    usageToday: "今日积分使用",
    spentToday: "今日消耗",
    refundedToday: "失败返还",
    netSpentToday: "实际消耗",
    tasksToday: "今日任务",
    usageEmpty: "今日暂无使用记录",
    completedTasks: "完成",
    failedTasks: "失败",
    runningTasks: "进行中",
    premiumTiktok: "优质 TikTok 账号",
    tiktokWorkspace: "优质 TikTok 账号",
    tiktokAvatar: "T",
    tiktokTitle: "TikTok 账号库存中心",
    tiktokHint: "普通成员可以查看库存，管理员可以编辑表格、上传截图并保存。",
    smartTable: "智能表格",
    editable: "可编辑",
    viewOnly: "仅查看",
    rows: "条",
    autoResize: "图片自动伸缩",
    selected: "已选择",
    select: "选择",
    inventoryRows: "库存数量",
    inventoryTable: "账号库存智能表格",
    inventoryTableHint: "上传图片后会自动压缩并按比例预览；文本内容会随行高伸缩。",
    addRow: "添加一行",
    saveTable: "保存表格",
    tiktokSaved: "TikTok 账号表格已保存。",
    tiktokSaveFailed: "TikTok 表格保存失败。",
    accountImage: "图片",
    accountInfo: "账号/编号",
    price: "价格",
    followers: "粉丝",
    twoFa: "2FA/验证",
    emailInfo: "邮箱/售后",
    status: "状态",
    notes: "备注",
    actions: "操作",
    uploadImage: "上传图片",
    delete: "删除",
    noAiCost: "无需积分"
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
    resolution: "Resolution",
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
    referenceLimit: `Up to ${MAX_REFERENCE_IMAGES} images. Label them as Image 1 / Image 2 in your own order.`,
    referenceLabel: "Image label",
    referenceLabelHint: "When the prompt says Image 3, it uses the image labeled Image 3.",
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
    viewResult: "View",
    waiting: "Waiting for generation",
    waitingHint: "Progress and preview will appear here after submission.",
    imageSubmitted: "Image task submitted",
    imageSubmittedHint: "The image is generating in the background. You can submit the next image now.",
    imageTasks: "Image tasks",
    imageTaskEmpty: "No image tasks in this session yet.",
    quota: "Remaining quota",
    refreshQuota: "Refresh quota",
    quotaConnected: "Key connected",
    quotaUnavailable: "Quota endpoint unavailable",
    quotaUnknown: "Unavailable",
    topUp: "Top up",
    topUpHint: "Upstream wallet",
    quotaErrorTitle: "Upstream account balance is low",
    quotaErrorBody: "The selected upstream account is low. Contact the main account to top up before generating again.",
    memberQuotaErrorBody: "The upstream balance is low. Contact the main account to top up before generating again.",
    adminOnly: "Only admins can adjust credits.",
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
    promptLimit: "Prompt limit",
    promptTooLong: "The prompt is too long. Shorten it before generating.",
    promptCounter: "Current / limit",
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
    userDeleted: "User deleted",
    roleUpdated: "Admin permission updated",
    makeAdmin: "Make admin",
    removeAdmin: "Remove admin",
    deleteUser: "Delete user",
    primaryAdminOnly: "Only the main account can manage users.",
    primaryAccount: "Main account",
    adminRole: "Admin",
    memberRole: "Member",
    name: "Name",
    email: "Email",
    editName: "Edit name",
    saveName: "Save name",
    nameSaved: "Name updated",
    namePlaceholder: "Enter a new name",
    usageToday: "Today's credit usage",
    spentToday: "Spent today",
    refundedToday: "Failed refunds",
    netSpentToday: "Net spent",
    tasksToday: "Tasks today",
    usageEmpty: "No usage today",
    completedTasks: "Completed",
    failedTasks: "Failed",
    runningTasks: "Running",
    premiumTiktok: "Premium TikTok Accounts",
    tiktokWorkspace: "Premium TikTok Accounts",
    tiktokAvatar: "T",
    tiktokTitle: "TikTok account inventory",
    tiktokHint: "Members can view inventory. Admins can edit tables, upload screenshots, and save.",
    smartTable: "Smart table",
    editable: "Editable",
    viewOnly: "View only",
    rows: "rows",
    autoResize: "Auto image resize",
    selected: "Selected",
    select: "Select",
    inventoryRows: "Inventory rows",
    inventoryTable: "Smart account inventory table",
    inventoryTableHint: "Uploaded images are compressed and previewed proportionally; text cells grow with the row.",
    addRow: "Add row",
    saveTable: "Save table",
    tiktokSaved: "TikTok inventory saved.",
    tiktokSaveFailed: "Failed to save TikTok inventory.",
    accountImage: "Image",
    accountInfo: "Account / ID",
    price: "Price",
    followers: "Followers",
    twoFa: "2FA / verify",
    emailInfo: "Email / after-sale",
    status: "Status",
    notes: "Notes",
    actions: "Actions",
    uploadImage: "Upload image",
    delete: "Delete",
    noAiCost: "No credits"
  }
} satisfies Record<Language, Record<string, string>>;

function extractImageUrl(result: ImageResult | null) {
  const item = result?.data?.[0];
  if (item?.url) return item.url;
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  const fallback = findImageUrl(result);
  if (fallback) return fallback;
  return "";
}

function getViewableImageUrl(url?: string) {
  if (!url) return "";
  if (url.startsWith("data:image/") || url.startsWith("/")) return url;
  return `/api/images/proxy?url=${encodeURIComponent(url)}`;
}

function findImageUrl(value: unknown, seen = new Set<unknown>()): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (/^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(value)) return value;
    if (/^data:image\//i.test(value)) return value;
    return "";
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of ["url", "image_url", "output_url", "result_url", "previewUrl"]) {
    const found = findImageUrl(record[key], seen);
    if (found) return found;
  }
  const b64 = record.b64_json || record.base64 || record.image_base64;
  if (typeof b64 === "string" && b64.length > 100) return `data:image/png;base64,${b64}`;
  for (const nested of Object.values(record)) {
    const found = findImageUrl(nested, seen);
    if (found) return found;
  }
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
  return Boolean(getHfsyModel(model)) || lower.includes("video") || lower.includes("veo") || lower.includes("sora") || lower.startsWith("vidu:") || lower.startsWith("sy:");
}

function isViduModelId(model: string) {
  return model.toLowerCase().startsWith("vidu:");
}

function isHellobabyGoVeoFrameModel(model: string) {
  return model.toLowerCase() === "veo_3_1-fast-portrait-fl-hd";
}

function modelRequiresReference(model: string) {
  const lower = model.toLowerCase();
  return Boolean(getSyModel(model)) || isViduModelId(model) || isHellobabyGoVeoFrameModel(model) || lower.includes("-ref-") || lower.includes("_ref_") || lower.includes("fl-hd");
}

function modelRequiresFirstFrame(model: string) {
  return syModelSupportsEndFrame(model) || isHellobabyGoVeoFrameModel(model) || model.toLowerCase().includes("fl-hd");
}

function modelSupportsEndFrame(model: string) {
  return syModelSupportsEndFrame(model) || isHellobabyGoVeoFrameModel(model) || model.toLowerCase().includes("fl-hd");
}

function getReferenceRoleLabel(index: number, model: string, language: Language) {
  if (!modelSupportsEndFrame(model)) return "";
  if (index === 0) return language === "zh" ? "首帧" : "Start";
  if (index === 1) return language === "zh" ? "尾帧" : "End";
  return language === "zh" ? `参考 ${index + 1}` : `Ref ${index + 1}`;
}

function getCreditCost(model: string, duration?: string, resolution?: string) {
  if (isVideoModel(model)) return getVideoGenerationCost(model, duration, resolution);
  return getModelCreditCost(model);
}

function formatCreditCost(model: string, language: Language, duration?: string, resolution?: string) {
  const cost = getCreditCost(model, duration, resolution);
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
    maximumFractionDigits: 0
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

function getModelPromptLimit(model: string, mode: Mode) {
  return getPromptLimit(model, mode === "image" ? "image" : "video");
}

function formatPromptLimit(model: string, mode: Mode, language: Language) {
  const limit = getModelPromptLimit(model, mode);
  return language === "zh" ? `提示词上限 ${limit} 字符` : `Prompt limit ${limit} chars`;
}

function getModelTitle(model: string, language: Language) {
  const lower = model.toLowerCase();
  const syModel = getSyModel(model);
  if (syModel) return syModel.label;
  const hfsyModel = getHfsyModel(model);
  if (hfsyModel) return hfsyModel.label;
  if (lower.startsWith("vidu:")) return language === "zh" ? "Vidu 图生视频" : "Vidu Image to Video";
  if (lower.includes("grok-imagine")) {
    const seconds = lower.includes("10s") ? "10" : lower.includes("6s") ? "6" : "";
    const prefix = lower.includes("ref") ? (language === "zh" ? "Grok 参考图视频" : "Grok Reference Video") : (language === "zh" ? "Grok 文字视频" : "Grok Text Video");
    return `${prefix}${seconds ? language === "zh" ? ` ${seconds}秒` : ` ${seconds}s` : ""}`;
  }
  if (lower.includes("sora")) {
    if (lower.includes("ali-sora")) return language === "zh" ? "阿里 Sora 竖屏" : "Ali Sora Portrait";
    if (lower.includes("sora2-pro")) return language === "zh" ? "Sora 2 Pro 竖屏" : "Sora 2 Pro Portrait";
    return language === "zh" ? "Sora 2 竖屏" : "Sora 2 Portrait";
  }
  if (lower.includes("firefly")) return language === "zh" ? "Firefly VEO" : "Firefly VEO";
  if (lower === "veo_3_1-fast") return language === "zh" ? "HBG VEO 3.1 Fast 竖屏（纯提示词）" : "HBG VEO 3.1 Fast Portrait Prompt";
  if (lower.includes("veo_3_1")) {
    if (lower.includes("fl-hd")) return language === "zh" ? "HBG VEO 3.1 Fast 首尾帧 HD" : "HBG VEO 3.1 Fast Start-End HD";
    if (lower.includes("-hd")) return language === "zh" ? "HBG VEO 3.1 Fast HD" : "HBG VEO 3.1 Fast HD";
    return language === "zh" ? "HBG VEO 3.1 Fast 竖屏" : "HBG VEO 3.1 Fast Portrait";
  }
  const hfsyImageModel = getHfsyImageModel(model);
  if (hfsyImageModel) return hfsyImageModel.label;
  return model;
}

function getModelDescription(model: string, language: Language) {
  const lower = model.toLowerCase();
  const aspect = language === "zh" ? "9:16 竖屏" : "9:16 portrait";
  const syModel = getSyModel(model);
  if (syModel) {
    const mode = syModel.mode === "first-last"
      ? language === "zh" ? "首帧必填，尾帧可选" : "start required, end optional"
      : language === "zh" ? "参考图必填，可传多张" : "reference required, multiple images accepted";
    return language === "zh"
      ? `${aspect} · ${syModel.duration} 秒固定 · ${syModel.resolution} · ${mode} · SY 上游${syModel.successHint ? ` · ${syModel.successHint}` : ""}`
      : `${aspect} · fixed ${syModel.duration}s · ${syModel.resolution} · ${mode} · SY upstream${syModel.successHint ? ` · ${syModel.successHint}` : ""}`;
  }
  const hfsyModel = getHfsyModel(model);
  if (hfsyModel) {
    const durationText = hfsyModel.durationOptions.length === 1
      ? language === "zh" ? `${hfsyModel.durationOptions[0]} 秒固定` : `fixed ${hfsyModel.durationOptions[0]}s`
      : language === "zh" ? `${hfsyModel.durationOptions.join("/")} 秒可选` : `${hfsyModel.durationOptions.join("/")}s selectable`;
    const mode = hfsyModel.referenceMode === "required"
      ? language === "zh" ? "参考图必填" : "reference required"
      : language === "zh" ? "文字或参考图均可" : "prompt or reference image";
    const audioHint = hfsyModel.upstreamModel === "sora-2"
      ? language === "zh" ? "含口播时启用音频" : "audio when speech is requested"
      : "";
    const siteCredits = Math.round(hfsyModel.upstreamPrice * 10);
    return language === "zh"
      ? `${aspect} · ${durationText} · ${hfsyModel.resolution} · ${mode}${audioHint ? ` · ${audioHint}` : ""} · HFSY 上游 · 上游价 ¥${hfsyModel.upstreamPrice} · ${siteCredits} 积分`
      : `${aspect} · ${durationText} · ${hfsyModel.resolution} · ${mode}${audioHint ? ` · ${audioHint}` : ""} · HFSY upstream · upstream ¥${hfsyModel.upstreamPrice} · ${siteCredits} credits`;
  }
  if (lower.startsWith("vidu:")) {
    const family = lower.includes("q2") ? "Q2" : "Q3";
    const speed = lower.includes("pro-fast")
      ? language === "zh" ? `${family} Pro Fast · 参考图必填 · 口播已开启` : `${family} Pro Fast · reference required · audio enabled`
      : lower.includes("turbo")
        ? language === "zh" ? `${family} Turbo · 参考图必填 · 口播已开启` : `${family} Turbo · reference required · audio enabled`
        : language === "zh" ? `${family} Pro · 参考图必填 · 口播已开启` : `${family} Pro · reference required · audio enabled`;
    return `${aspect} · 5/8/12/15 秒可选 · ${speed}`;
  }
  if (lower.includes("grok-imagine")) {
    const fixedDuration = lower.includes("10s") ? "10" : lower.includes("6s") ? "6" : "";
    const kind = lower.includes("ref")
      ? language === "zh" ? "参考图必填" : "reference required"
      : language === "zh" ? "纯提示词视频" : "prompt-only video";
    if (fixedDuration) {
      return language === "zh"
        ? `${aspect} · ${fixedDuration} 秒固定 · ${kind}`
        : `${aspect} · fixed ${fixedDuration}s · ${kind}`;
    }
    return language === "zh"
      ? `${aspect} · 6/10 秒可选 · ${kind}`
      : `${aspect} · 6/10s selectable · ${kind}`;
  }
  if (lower.includes("sora")) {
    const fixedDuration = lower.match(/(\d+)s/)?.[1] || "8";
    const family = lower.includes("ali-sora")
      ? language === "zh" ? "阿里官方 Sora" : "Ali official Sora"
      : lower.includes("sora2-pro")
        ? language === "zh" ? "Sora 2 Pro" : "Sora 2 Pro"
        : language === "zh" ? "Sora 2" : "Sora 2";
    return language === "zh"
      ? `${aspect} · ${fixedDuration} 秒固定 · ${family} 纯提示词视频`
      : `${aspect} · fixed ${fixedDuration}s · ${family} prompt-only video`;
  }
  if (lower === "veo_3_1-fast") {
    return language === "zh"
      ? `${aspect} · 4/8/12/15 秒可选 · 720P · HellobabyGo 上游 · 纯提示词视频`
      : `${aspect} · 4/8/12/15s selectable · 720P · HellobabyGo upstream · prompt-only video`;
  }
  if (lower.includes("veo_3_1") && lower.includes("fl-hd")) {
    return language === "zh"
      ? `${aspect} · 8 秒固定 · 1080P · 首帧必填，尾帧可选 · 已实测完成`
      : `${aspect} · fixed 8s · 1080P · start required, end optional · completion tested`;
  }
  if (lower.includes("veo_3_1-fast-portrait-hd")) {
    return language === "zh"
      ? `${aspect} · 4/8/12/15 秒可选 · 1080P · 纯提示词视频 · 已实测完成`
      : `${aspect} · 4/8/12/15s selectable · 1080P · prompt-only video · completion tested`;
  }
  if (lower.includes("veo_3_1-fast-portrait")) {
    return language === "zh"
      ? `${aspect} · 4/8/12/15 秒可选 · 720P · 纯提示词视频 · 已实测完成`
      : `${aspect} · 4/8/12/15s selectable · 720P · prompt-only video · completion tested`;
  }
  const hfsyImageModel = getHfsyImageModel(model);
  if (hfsyImageModel) {
    const mode = hfsyImageModel.referenceMode === "optional"
      ? language === "zh" ? "文字或参考图均可" : "prompt or reference image"
      : language === "zh" ? "纯提示词生图" : "prompt-only image";
    return language === "zh"
      ? `${mode} · HFSY 上游 · 上游价 ¥${hfsyImageModel.upstreamPrice} · ${hfsyImageModel.credits} 积分 · ${hfsyImageModel.description}`
      : `${mode} · HFSY upstream · upstream ¥${hfsyImageModel.upstreamPrice} · ${hfsyImageModel.credits} credits · ${hfsyImageModel.description}`;
  }
  const reference = lower.startsWith("vidu:") || lower.includes("ref")
    ? copy[language].modelCanReference
    : copy[language].modelTextOnly;
  const fixedDuration = lower.includes("firefly-veo31") ? "8" : lower.match(/(\d+)s/)?.[1];
  const durationText = fixedDuration
    ? language === "zh" ? `${fixedDuration} 秒视频` : `${fixedDuration}s video`
    : language === "zh" ? "4/8/12/15 秒可选" : "4/8/12/15s selectable";
  return `${aspect} · ${durationText} · ${reference}`;
}

function getModelGroupLabel(model: string, mode: Mode, language: Language) {
  const lower = model.toLowerCase();
  if (mode === "image") {
    if (lower.includes("nano-banana")) return language === "zh" ? "HFSY Nano Banana" : "HFSY Nano Banana";
    if (lower.includes("gpt-image")) return language === "zh" ? "HFSY GPT Image" : "HFSY GPT Image";
    return language === "zh" ? "图片模型" : "Image models";
  }
  if (lower.startsWith("vidu:")) return "Vidu";
  if (lower.startsWith("sy:")) return "SY";
  if (lower.startsWith("hfsy:")) return "HFSY";
  if (lower.includes("veo_3_1")) return "VEO";
  if (lower.includes("sora")) return "Sora";
  if (lower.includes("grok")) return "Grok";
  return language === "zh" ? "其他视频模型" : "Other video models";
}

function groupModelsForSelect(models: string[], mode: Mode, language: Language) {
  const groups = new Map<string, string[]>();
  for (const model of models) {
    const label = getModelGroupLabel(model, mode, language);
    groups.set(label, [...(groups.get(label) || []), model]);
  }
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function getDeepSeekTaskTitle(task: DeepSeekTask, language: Language) {
  const zh: Record<DeepSeekTask, string> = {
    image_prompt: "图片提示词",
    video_prompt: "视频提示词",
    batch_shots: "批量分镜",
    product_copy: "产品文案"
  };
  const en: Record<DeepSeekTask, string> = {
    image_prompt: "Image prompt",
    video_prompt: "Video prompt",
    batch_shots: "Batch shots",
    product_copy: "Product copy"
  };
  return (language === "zh" ? zh : en)[task];
}

function getDeepSeekTaskDescription(task: DeepSeekTask, language: Language) {
  const zh: Record<DeepSeekTask, string> = {
    image_prompt: "把想法改成可直接生图的英文提示词。",
    video_prompt: "把想法改成可直接生视频的镜头提示词。",
    batch_shots: "把一个主题拆成多条批量视频作品。",
    product_copy: "生成适合广告和电商的卖点文案。"
  };
  const en: Record<DeepSeekTask, string> = {
    image_prompt: "Turn an idea into an image-ready English prompt.",
    video_prompt: "Turn an idea into a video-ready shot prompt.",
    batch_shots: "Split one idea into multiple batch video prompts.",
    product_copy: "Write ad and ecommerce product copy."
  };
  return (language === "zh" ? zh : en)[task];
}

function getDeepSeekModelDescription(model: string, language: Language) {
  if (model === "omni_flash") {
    return language === "zh" ? "上游 Omni Flash，适合快速文案和提示词整理" : "Upstream Omni Flash for fast copy and prompt polishing";
  }
  if (model === "deepseek-v4-pro") {
    return language === "zh" ? "更强推理，适合复杂分镜和长文案" : "Stronger reasoning for complex shots and long copy";
  }
  return language === "zh" ? "速度快，适合日常提示词优化" : "Fast model for everyday prompt polishing";
}

function defaultReferenceLabel(index: number) {
  return `Image ${index + 1}`;
}

function getDurationOptions(model: string, language: Language) {
  const lower = model.toLowerCase();
  const syModel = getSyModel(model);
  if (syModel) {
    return [{ value: String(syModel.duration), label: language === "zh" ? `${syModel.duration} 秒（SY固定）` : `${syModel.duration} seconds fixed by SY` }];
  }
  const hfsyModel = getHfsyModel(model);
  if (hfsyModel) {
    return hfsyModel.durationOptions.map((duration) => ({
      value: String(duration),
      label: language === "zh" ? `${duration} 秒（HFSY固定）` : `${duration} seconds fixed by HFSY`
    }));
  }
  if (lower.startsWith("vidu:")) {
    return [
      { value: "5", label: language === "zh" ? "5 秒" : "5 seconds" },
      { value: "8", label: language === "zh" ? "8 秒" : "8 seconds" },
      { value: "12", label: language === "zh" ? "12 秒" : "12 seconds" },
      { value: "15", label: language === "zh" ? "15 秒" : "15 seconds" }
    ];
  }
  if (lower.includes("grok-imagine")) {
    if (lower.includes("10s")) return [{ value: "10", label: language === "zh" ? "10 秒（模型固定）" : "10 seconds fixed" }];
    if (lower.includes("6s")) return [{ value: "6", label: language === "zh" ? "6 秒（模型固定）" : "6 seconds fixed" }];
    return [
      { value: "6", label: language === "zh" ? "6 秒" : "6 seconds" },
      { value: "10", label: language === "zh" ? "10 秒" : "10 seconds" }
    ];
  }
  if (lower.includes("sora")) {
    const fixedDuration = lower.match(/(\d+)s/)?.[1] || "8";
    return [{ value: fixedDuration, label: language === "zh" ? `${fixedDuration} 秒（模型固定）` : `${fixedDuration} seconds fixed` }];
  }
  if (lower.includes("firefly-veo31")) {
    return [{ value: "8", label: language === "zh" ? "8 秒（模型固定）" : "8 seconds fixed" }];
  }
  if (lower === "veo_3_1-fast-portrait-fl-hd") {
    return [{ value: "8", label: language === "zh" ? "8 秒（已实测）" : "8 seconds tested" }];
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

function getResolutionOptions(model: string, language: Language) {
  const lower = model.toLowerCase();
  const syModel = getSyModel(model);
  if (syModel) {
    const value = syModel.resolution === "4K" ? "2160x3840" : syModel.resolution === "1080P" ? "1080x1920" : "720x1280";
    return [{ value, label: syModel.resolution }];
  }
  const hfsyModel = getHfsyModel(model);
  if (hfsyModel) {
    const value = hfsyModel.resolution === "1080P"
      ? "1080x1920"
      : hfsyModel.resolution === "720P"
        ? "720x1280"
        : "480x854";
    return [{ value, label: hfsyModel.resolution }];
  }
  if (lower === "vidu:viduq3-pro-fast") {
    return [
      { value: "720x1280", label: "720P" },
      { value: "1080x1920", label: "1080P" }
    ];
  }
  if (lower === "vidu:viduq3-turbo" || lower === "vidu:viduq3-pro") {
    return [
      { value: "540x960", label: language === "zh" ? "540P（上游支持）" : "540P supported" },
      { value: "720x1280", label: "720P" },
      { value: "1080x1920", label: "1080P" }
    ];
  }
  if (lower.includes("veo_3_1-fast-portrait")) {
    return lower.includes("hd")
      ? [{ value: "1080x1920", label: "1080P" }]
      : [{ value: "720x1280", label: "720P" }];
  }
  if (lower.includes("firefly-veo31") || lower.includes("sora")) {
    return [{ value: "1080x1920", label: "1080P" }];
  }
  return [{ value: "720x1280", label: "720P" }];
}

function normalizeResolutionForModel(model: string, currentSize: string, language: Language) {
  const options = getResolutionOptions(model, language);
  if (options.some((option) => option.value === currentSize)) return currentSize;
  return options[0]?.value || currentSize;
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

function getPendingVideoProgress(status?: string, progress?: number) {
  const numeric = Number(progress || 0);
  if (numeric > 0) return numeric;
  const normalized = String(status || "").toLowerCase();
  if (["in_progress", "processing", "running"].includes(normalized)) return 15;
  if (["queued", "created", "pending", "submitted"].includes(normalized)) return 8;
  return 5;
}

function getPendingImageProgress(status?: string, progress?: number) {
  const numeric = Number(progress || 0);
  if (numeric > 0) return numeric;
  const normalized = String(status || "").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(normalized)) return 100;
  if (["in_progress", "processing", "running"].includes(normalized)) return 15;
  if (["queued", "created", "pending", "submitted"].includes(normalized)) return 8;
  return 5;
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
    message.includes("PUBLIC_ERROR_USER_QUOTA_REACHED") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("额度不足") ||
    message.includes("余额不足") ||
    message.includes("预扣费额度失败")
  );
}

function isProviderInternalError(message: string) {
  return (
    message.includes("Internal error encountered") ||
    message.includes("\"status\":\"INTERNAL\"") ||
    message.includes("\"status\": \"INTERNAL\"") ||
    message.includes("\"code\":500") ||
    message.includes("\"code\": 500")
  );
}

function isUpstreamProxyError(message: string) {
  const lower = message.toLowerCase();
  return (
    message.includes("代理不可用") ||
    lower.includes("proxyerror") ||
    lower.includes("unable to connect to proxy") ||
    lower.includes("connecttimeouterror") ||
    lower.includes("upload/sign") ||
    lower.includes("httpsconnectionpool")
  );
}

function isUpstreamNodeConnectionError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("connection refused") ||
    lower.includes("connect: connection refused") ||
    lower.includes("dial tcp") ||
    lower.includes("econnrefused")
  );
}

function isUpstreamBusyError(message: string) {
  return (
    message.includes("upstream_generation_failed") ||
    message.includes("生成服务暂时繁忙") ||
    message.toLowerCase().includes("temporarily busy") ||
    isUpstreamProxyError(message)
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

function getPromptTooLongMessage(length: number, limit: number, language: Language) {
  return language === "zh"
    ? `提示词太长：当前 ${length} 字符，上限 ${limit} 字符。请精简镜头描述后再提交。`
    : `Prompt is too long: ${length} characters, limit ${limit}. Shorten the prompt before submitting.`;
}

function extractReadableError(raw: string): string {
  let message = String(raw || "").trim();
  for (let index = 0; index < 3; index += 1) {
    const trimmed = message.trim();
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") {
        message = parsed;
        continue;
      }
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const next =
          record.message ||
          record.errorMessage ||
          record.error ||
          record.detail ||
          record.fail_reason ||
          record.reason ||
          record.data;
        if (typeof next === "string" && next !== message) {
          message = next;
          continue;
        }
      }
    } catch {
      const jsonStart = trimmed.indexOf("{");
      const jsonEnd = trimmed.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const embedded = trimmed.slice(jsonStart, jsonEnd + 1);
        try {
          const parsed = JSON.parse(embedded) as Record<string, unknown>;
          const next = parsed.message || parsed.error || parsed.detail || parsed.fail_reason || parsed.reason;
          if (typeof next === "string" && next !== message) {
            message = next;
            continue;
          }
        } catch {
          // Fall through to return the original text.
        }
      }
    }
    break;
  }
  return message.replace(/^"+|"+$/g, "").trim();
}

function cleanErrorMessage(error: string, language: Language) {
  const readable = extractReadableError(error);
  if (!readable) return "";
  const lower = readable.toLowerCase();
  if (isTransientVideoStatusError(readable)) return getTransientVideoMessage(language);
  if (
    lower.includes("500044") ||
    lower.includes("concurrent generation") ||
    lower.includes("reached the limit for concurrent") ||
    lower.includes("hfsy_fusion_concurrency_limit") ||
    lower.includes("fusion")
  ) {
    return language === "zh"
      ? "HFSY SD/Fusion 上游同时生成名额已满。请等当前 SD2 Fast / SD2 任务完成后再提交；本次没有扣站内积分，已扣的失败任务会自动返还。"
      : "The HFSY SD/Fusion upstream concurrent generation limit is full. Wait for the current SD2 Fast / SD2 task to finish, then submit again. No site credits were deducted; failed charged attempts are refunded.";
  }
  if (
    readable.includes("video_unsafe") ||
    lower.includes("prompt_unsafe") ||
    lower.includes("http 451") ||
    lower.includes("considered unsafe") ||
    readable.includes("appears to be unsafe") ||
    readable.includes("不安全") ||
    readable.includes("安全")
  ) {
    return language === "zh"
      ? "上游安全审核未通过：生成内容被判定可能不安全。请换参考图，减少真人身体/暴露/危险/敏感描述，改成普通商品展示或日常场景后重试。站内积分已退回。"
      : "Upstream safety review failed. Change the reference image or prompt, avoid sensitive body/exposure/danger wording, then retry. Site credits have been refunded.";
  }
  if (readable.includes("至少需要1张参考图") || readable.includes("至少需要 1 张参考图") || lower.includes("requires one reference") || lower.includes("requires 1 reference")) {
    return language === "zh"
      ? "当前模型必须上传 1 张参考图。请上传参考图后重新生成，站内积分已退回。"
      : "This model requires one reference image. Upload a reference image and try again. Site credits have been refunded.";
  }
  if (readable.includes("最多只支持1张参考图") || readable.includes("最多只支持 1 张参考图") || lower.includes("only supports 1") || lower.includes("one reference")) {
    return language === "zh"
      ? "参考图数量过多：当前模型最多只支持 1 张参考图。请只上传 1 张参考图后重新生成。站内积分已退回。"
      : "Too many reference images. This model supports only 1 reference image. Upload one image and retry. Site credits have been refunded.";
  }
  if (readable.includes("prompt_too_long")) {
    return language === "zh" ? "提示词超过当前模型上限，请精简后再提交。" : "The prompt exceeds this model's limit. Shorten it and submit again.";
  }
  if (lower.includes("field 'prompt'") && lower.includes("at most 2500")) {
    return language === "zh"
      ? "上游限制：Kling O3 提示词最多 2500 字符。请精简分镜、口播和参考图说明后重新提交，站内积分已退回。"
      : "Upstream limit: Kling O3 supports at most 2500 prompt characters. Shorten the script and reference notes, then submit again. Site credits have been refunded.";
  }
  if (lower.includes("account access is restricted") || lower.includes("access is restricted")) {
    return language === "zh"
      ? "上游账号或模型权限受限，任务已失败且站内积分已退回。请联系主账号检查上游权限，或先切换其它稳定模型。"
      : "The upstream account or model access is restricted. The task failed and site credits have been refunded. Check upstream access or switch to another stable model.";
  }
  if (
    readable.includes("Error 524") ||
    readable.includes("origin_response_timeout") ||
    readable.includes("Proxy Read Timeout") ||
    readable.includes("120-second Proxy Read Timeout")
  ) {
    return language === "zh"
      ? "上游图片生成超时，任务已失败且站内积分已退回。请优先切换 HFSY Nano Banana 2 / Pro 重新生成，或稍后再试。"
      : "The upstream image service timed out. The task failed and site credits have been refunded. Try HFSY Nano Banana 2 / Pro or retry later.";
  }
  if (
    readable.includes("stayed in generation for too long") ||
    readable.includes("Site credits were refunded automatically") ||
    readable.includes("上游任务长时间停留")
  ) {
    return language === "zh"
      ? "上游任务卡在最终生成阶段，站内积分已自动退回。请换用更稳定模型，或减少参考图、缩短提示词后重新提交。"
      : "The upstream task got stuck near the final stage. Site credits were refunded automatically. Try a more stable model or simplify the prompt/reference images.";
  }
  if (isUpstreamProxyError(readable)) {
    return language === "zh"
      ? "上游图片上传代理不可用，任务没有成功创建。站内积分会退回；请稍后重试，或先切换 Vidu / Grok 参考图模型生成。"
      : "The upstream image upload proxy is unavailable, so the task was not created. Site credits will be refunded; retry later or use a Vidu/Grok reference-image model.";
  }
  if (isUpstreamNodeConnectionError(readable)) {
    return language === "zh"
      ? "上游生成节点连接失败，任务已失败且站内积分已退回。请稍后重试，或先切换其他稳定模型生成。"
      : "The upstream generation node refused the connection. The task failed and site credits have been refunded. Retry later or switch to another stable model.";
  }
  if (isInsufficientQuota(readable)) {
    return language === "zh"
      ? "上游 VEO 供应商资源或额度不足，任务已失败。站内积分会退回；请稍后重试，或先用 Vidu/Grok 模型生成。"
      : "The upstream VEO provider is out of quota or resources. Site credits will be refunded; retry later or use Vidu/Grok.";
  }
  if (isProviderInternalError(readable)) {
    return language === "zh"
      ? "上游 VEO 供应商内部错误，任务已失败。站内积分会退回；请换一张首帧图/简化提示词后重试，或先用 Vidu/Grok。"
      : "The upstream VEO provider returned an internal error. Site credits will be refunded; try another first frame, simplify the prompt, or use Vidu/Grok.";
  }
  return readable;
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
        status: typeof item.status === "string" ? item.status : undefined,
        error: typeof item.error === "string" ? item.error : undefined
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
  const [activeTool, setActiveTool] = useState<WorkspaceTool>("home");
  const [models, setModels] = useState<ModelItem[]>([]);
  const [imageModel, setImageModel] = useState(stableImageModels[0]);
  const [videoModel, setVideoModel] = useState(stableVideoModels[0]);
  const [deepSeekModel, setDeepSeekModel] = useState(stableDeepSeekModels[0]);
  const [deepSeekTask, setDeepSeekTask] = useState<DeepSeekTask>("image_prompt");
  const [deepSeekInput, setDeepSeekInput] = useState("帮我写一个适合假发产品图的高转化提示词，9:16 竖屏，真实质感，适合电商广告。");
  const [deepSeekResult, setDeepSeekResult] = useState<DeepSeekResult | null>(null);
  const [isDeepSeekLoading, setIsDeepSeekLoading] = useState(false);
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
  const [imageTasks, setImageTasks] = useState<ImageTask[]>(readStoredImageTasks);
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
  const [profileName, setProfileName] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [grantAmount, setGrantAmount] = useState("120");
  const [grantMessage, setGrantMessage] = useState("");
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [tiktokInventory, setTiktokInventory] = useState<TiktokInventory>(() => createInitialTiktokInventory());
  const [tiktokActiveCategory, setTiktokActiveCategory] = useState<TiktokCategory>("full-moon");
  const [tiktokMessage, setTiktokMessage] = useState("");
  const [isTiktokLoading, setIsTiktokLoading] = useState(false);
  const [dragTarget, setDragTarget] = useState("");
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
    return () => {
      for (const preview of referencePreviews) URL.revokeObjectURL(preview.url);
    };
  }, [referencePreviews]);

  useEffect(() => {
    for (const task of imageTasks) {
      if (task.status !== "completed" && task.status !== "failed") {
        setTimeout(() => void pollImageJob(task.id), 0);
      }
    }
    // Restore once on the client; pollImageJob reads current language/copy through closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshTiktokInventory();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(IMAGE_TASKS_STORAGE_KEY, JSON.stringify(imageTasks.slice(0, 20)));
    } catch {
      // Browser storage can be disabled; generation itself should keep working.
    }
  }, [imageTasks]);

  const imageModels = useMemo(() => {
    const liveIds = new Set(models.map((model) => model.id));
    const liveStable = stableImageModels.filter((id) => liveIds.has(id) || liveIds.has(getBaseImageModelId(id)));
    return liveStable.length ? liveStable : stableImageModels;
  }, [models]);

  const videoModels = useMemo(() => {
    const liveIds = new Set(models.map((model) => model.id));
    const liveStable = stableVideoModels.filter((id) => liveIds.has(id));
    return liveStable.length ? liveStable : stableVideoModels;
  }, [models]);

  const activeImageUrl = extractImageUrl(imageResult);
  const activeImageViewUrl = getViewableImageUrl(activeImageUrl);
  const videoId = getVideoTaskId(videoResult);
  const videoSrc = isVideoDone(videoResult?.status, videoResult) ? getVideoUrl(videoResult) || (videoId ? `/api/videos/${videoId}/content` : "") : "";
  const downloadUrl = activeImageViewUrl || videoSrc;
  const downloadKind = activeImageUrl ? "image" : "video";
  const currentUser = session?.user || null;
  const isAdmin = currentUser?.role === "admin";
  const isPrimaryAdmin = Boolean(currentUser?.id && session?.adminId === currentUser.id);
  const quotaValue = findQuotaValue(quota?.data, language);
  const quotaText = quotaValue ? formatQuotaText(quotaValue) : quota?.connected ? t.quotaUnavailable : t.quotaUnknown;
  const displayError = cleanErrorMessage(error, language);
  const needsTopUp = isInsufficientQuota(error);
  const referenceInputId = `reference-images-${mode}`;
  const referenceDropId = `reference-drop-${mode}`;
  const singleVideoHasReference = referenceFiles.length > 0 || imageUrl.trim().length > 0;
  const activeModel = mode === "image" ? imageModel : videoModel;
  const isBatchWorkspace = activeTool === "batch";
  const isDeepSeekWorkspace = activeTool === "deepseek";
  const isTiktokWorkspace = activeTool === "tiktok";
  const visibleModels = mode === "image" ? imageModels : videoModels;
  const groupedVisibleModels = groupModelsForSelect(visibleModels, mode, language);
  const durationOptions = mode === "video" ? getDurationOptions(videoModel, language) : [];
  const resolutionOptions = mode === "video" ? getResolutionOptions(videoModel, language) : [];
  const normalizedVideoSize = normalizeResolutionForModel(videoModel, videoSize, language);
  const activeModelCost = getCreditCost(activeModel, mode === "video" ? seconds : undefined, mode === "video" ? normalizedVideoSize : undefined);

  const deepSeekCost = getCreditCost(deepSeekModel);
  const activeWorkspaceModel = isTiktokWorkspace ? "TikTok Inventory" : isDeepSeekWorkspace ? deepSeekModel : activeModel;
  const activeWorkspaceCost = isTiktokWorkspace ? 0 : isDeepSeekWorkspace ? deepSeekCost : activeModelCost;
  const activeWorkspaceCostText = isTiktokWorkspace
    ? tx("noAiCost", "无需积分")
    : isDeepSeekWorkspace
    ? formatCreditTotal(deepSeekCost, language)
    : formatCreditCost(activeModel, language, mode === "video" ? seconds : undefined, mode === "video" ? normalizedVideoSize : undefined);
  const activeModelDescription = getModelDescription(activeModel, language);
  const promptLimit = isDeepSeekWorkspace ? getPromptLimit(deepSeekModel, "text") : getModelPromptLimit(activeModel, mode);
  const promptLength = isDeepSeekWorkspace ? deepSeekInput.trim().length : prompt.trim().length;
  const promptOverLimit = promptLength > promptLimit;
  const activeVideoNeedsReference = mode === "video" && modelRequiresReference(activeModel);
  const canAffordActiveModel = Boolean(currentUser && activeModelCost && currentUser.credits >= activeModelCost);
  const canAffordDeepSeek = Boolean(currentUser && deepSeekCost && currentUser.credits >= deepSeekCost);
  const canSubmitDeepSeek = Boolean(currentUser && deepSeekInput.trim() && !promptOverLimit && !isDeepSeekLoading && canAffordDeepSeek);
  const canSubmit =
    prompt.trim().length > 0 &&
    !promptOverLimit &&
    !isLoading &&
    Boolean(currentUser) &&
    canAffordActiveModel &&
    (!activeVideoNeedsReference || singleVideoHasReference);
  const filledBatchSlots = batchPrompts.filter((item) => item.value.trim()).slice(0, MAX_BATCH_VIDEOS);
  const batchPromptOverLimit = filledBatchSlots.some((slot) => slot.value.trim().length > getModelPromptLimit(getBatchSlotModel(slot), "video"));
  const batchCreditTotal = filledBatchSlots.length
    ? filledBatchSlots.reduce((total, slot) => total + getCreditCost(getBatchSlotModel(slot), seconds, normalizeResolutionForModel(getBatchSlotModel(slot), videoSize, language)), 0)
    : undefined;
  const batchMissingRequiredReference = modelRequiresReference(videoModel) && filledBatchSlots.some((slot) => slot.referenceFiles.length === 0);
  const canAffordBatch = Boolean(currentUser && batchCreditTotal && currentUser.credits >= batchCreditTotal && !batchMissingRequiredReference && !batchPromptOverLimit);
  const showCreditWarning = Boolean(currentUser && activeWorkspaceCost && currentUser.credits < activeWorkspaceCost);
  const imageHistory = history.filter((item) => item.mode === "image");
  const videoHistory = history.filter((item) => item.mode === "video");
  const selectedGrantUser = (session?.users || []).find((user) => user.id === grantUserId);
  const selectedGrantUserIsPrimary = Boolean(selectedGrantUser?.id && selectedGrantUser.id === session?.adminId);
  const grantInternalAmount = parseDisplayCredits(grantAmount);
  const addPreviewCredits = selectedGrantUser && grantInternalAmount ? selectedGrantUser.credits + grantInternalAmount : undefined;
  const subtractPreviewCredits = selectedGrantUser && grantInternalAmount ? selectedGrantUser.credits - grantInternalAmount : undefined;
  const usageRows = (usageSummary?.users || [])
    .filter((item) => item.spent || item.refunded || item.tasks.total)
    .sort((left, right) => right.spent - left.spent || right.refunded - left.refunded || right.tasks.total - left.tasks.total);
  const productionTotalCost = isTiktokWorkspace ? 0 : isDeepSeekWorkspace ? deepSeekCost : isBatchWorkspace ? batchCreditTotal || activeModelCost : activeModelCost;
  const productionTotalLabel = isTiktokWorkspace ? tx("inventoryRows", "库存数量") : isBatchWorkspace ? tx("batchTotal", "本批总计") : tx("currentTaskCost", "当前任务");
  const workspaceCapacity = isBatchWorkspace ? MAX_BATCH_VIDEOS : isTiktokWorkspace ? tiktokInventory[tiktokActiveCategory].length || 1 : 1;
  const workspaceAvatar =
    activeTool === "batch" ? tx("batchAvatar", "批")
    : activeTool === "deepseek" ? tx("deepSeekAvatar", "深")
    : activeTool === "tiktok" ? tx("tiktokAvatar", "T")
    : activeTool === "video" ? tx("videoAvatar", "视")
    : activeTool === "library" ? tx("libraryAvatar", "库")
    : tx("imageAvatar", "图");
  const workspaceTitle =
    activeTool === "batch" ? tx("batchWorkspace", "批量生成")
    : activeTool === "deepseek" ? tx("deepSeekWorkspace", "DeepSeek 助手")
    : activeTool === "tiktok" ? tx("tiktokWorkspace", "优质 TikTok 账号")
    : activeTool === "video" ? tx("videoWorkspace", "视频生产")
    : activeTool === "library" ? tx("libraryWorkspace", "资源库")
    : tx("imageWorkspace", "图片生产");
  const runningCount = [
    ...imageTasks,
    ...batchJobs
  ].filter((item) => ["queued", "submitting", "in_progress", "processing", "retrying"].includes(String(item.status).toLowerCase())).length + (isPolling || isLoading || isDeepSeekLoading ? 1 : 0);
  const completedCount = imageTasks.filter((item) => item.status === "completed").length + batchJobs.filter((item) => isVideoDone(item.status)).length;
  const failedCount = imageTasks.filter((item) => item.status === "failed").length + batchJobs.filter((item) => isVideoFailed(item.status)).length;
  const readyCount = isBatchWorkspace
    ? Math.min(MAX_BATCH_VIDEOS, filledBatchSlots.length)
    : isTiktokWorkspace
      ? tiktokInventory[tiktokActiveCategory].length
    : isDeepSeekWorkspace
      ? deepSeekInput.trim()
        ? 1
        : 0
    : prompt.trim()
      ? 1
      : 0;

  useEffect(() => {
    if (currentUser?.id) void refreshTiktokInventory();
  }, [currentUser?.id]);

  function switchWorkspace(tool: WorkspaceTool) {
    setActiveTool(tool);
    if (tool === "home" || tool === "image") {
      setMode("image");
    }
    if (tool === "video" || tool === "batch") {
      setMode("video");
    }
  }

  function switchMedia(nextMode: Mode) {
    setMode(nextMode);
    setActiveTool(nextMode);
  }

  async function refreshTiktokInventory() {
    try {
      const response = await fetch("/api/tiktok-accounts", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { inventory?: Partial<TiktokInventory> };
      const fallback = createInitialTiktokInventory();
      setTiktokInventory({
        "full-moon": payload.inventory?.["full-moon"]?.length ? payload.inventory["full-moon"] : fallback["full-moon"],
        "custom-followers": payload.inventory?.["custom-followers"]?.length ? payload.inventory["custom-followers"] : fallback["custom-followers"],
        showcase: payload.inventory?.showcase?.length ? payload.inventory.showcase : fallback.showcase
      });
    } catch {
      // Inventory is an auxiliary sales table; keep the default rows if loading fails.
    }
  }

  function updateTiktokRow(category: TiktokCategory, rowId: string, field: keyof TiktokInventoryRow, value: string) {
    setTiktokInventory((current) => ({
      ...current,
      [category]: current[category].map((row) => (row.id === rowId ? { ...row, [field]: value, updatedAt: new Date().toISOString() } : row))
    }));
  }

  function addTiktokRow(category: TiktokCategory) {
    setTiktokInventory((current) => ({
      ...current,
      [category]: [...current[category], createTiktokRow(category)]
    }));
  }

  function deleteTiktokRow(category: TiktokCategory, rowId: string) {
    setTiktokInventory((current) => ({
      ...current,
      [category]: current[category].filter((row) => row.id !== rowId)
    }));
  }

  async function uploadTiktokImage(category: TiktokCategory, rowId: string, files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const optimized = await compressImage(file);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(optimized);
    });
    updateTiktokRow(category, rowId, "imageUrl", dataUrl);
  }

  function handleImageDragOver(event: DragEvent<HTMLElement>, target: string) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setDragTarget(target);
  }

  function handleImageDragLeave(event: DragEvent<HTMLElement>, target: string) {
    event.preventDefault();
    event.stopPropagation();
    const relatedTarget = event.relatedTarget as Node | null;
    if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
      setDragTarget((current) => (current === target ? "" : current));
    }
  }

  function handleImageDrop(
    event: DragEvent<HTMLElement>,
    target: string,
    upload: (files: FileList) => void | Promise<void>
  ) {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget((current) => (current === target ? "" : current));
    if (event.dataTransfer.files?.length) {
      void upload(event.dataTransfer.files);
    }
  }

  async function saveTiktokCategory(category: TiktokCategory) {
    if (!isAdmin) {
      setTiktokMessage(tx("adminOnly", "只有管理员可以操作。"));
      return;
    }
    setIsTiktokLoading(true);
    setTiktokMessage("");
    try {
      const response = await fetch("/api/tiktok-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, rows: tiktokInventory[category] })
      });
      const payload = (await response.json()) as { inventory?: Partial<TiktokInventory>; error?: unknown; message?: unknown };
      if (!response.ok) throw new Error(String(payload.message || payload.error || "save_failed"));
      if (payload.inventory) {
        setTiktokInventory((current) => ({
          ...current,
          ...payload.inventory
        }));
      }
      setTiktokMessage(tx("tiktokSaved", "TikTok 账号表格已保存。"));
    } catch (caught) {
      setTiktokMessage(cleanErrorMessage(stringifyError(caught), language) || tx("tiktokSaveFailed", "TikTok 表格保存失败。"));
    } finally {
      setIsTiktokLoading(false);
    }
  }

  function chooseVideoResolution(size: string) {
    setVideoSize(size);
  }

  async function refreshSession() {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const payload = (await response.json()) as AuthSession;
      setSession(payload);
      setProfileName(payload.user?.name || "");
      if (payload.authenticated) {
        if (payload.user?.id && payload.adminId === payload.user.id) {
          void refreshQuota(false);
        } else {
          setQuota(null);
        }
        if (payload.user?.role === "admin") {
          void refreshUsageSummary();
        } else {
          setUsageSummary(null);
        }
        void refreshHistory();
      } else {
        setHistory([]);
        setUsageSummary(null);
      }
    } catch {
      setSession({ authenticated: false });
    } finally {
      setIsAuthLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function refreshUsageSummary() {
    try {
      const response = await fetch("/api/admin/usage", { cache: "no-store" });
      const payload = (await response.json()) as UsageSummary;
      if (!response.ok) throw new Error(JSON.stringify(payload));
      setUsageSummary(payload);
    } catch {
      setUsageSummary(null);
    }
  }

  async function saveProfileName() {
    const nextName = profileName.trim();
    if (!nextName) {
      setProfileMessage(tx("namePlaceholder", "输入新昵称"));
      return;
    }
    setIsSavingProfile(true);
    setProfileMessage("");
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "Profile update failed");
      await refreshSession();
      setProfileMessage(tx("nameSaved", "昵称已更新"));
    } catch (caught) {
      setProfileMessage(cleanErrorMessage(stringifyError(caught), language));
    } finally {
      setIsSavingProfile(false);
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
      void refreshUsageSummary();
      setGrantMessage(operation === "subtract" ? tx("subtractSuccess", "积分已扣减") : tx("grantSuccess", "积分已增加"));
    } catch (caught) {
      setGrantMessage(cleanErrorMessage(stringifyError(caught), language));
    }
  }

  async function updateUserRole(role: "admin" | "user") {
    if (!isPrimaryAdmin) {
      setGrantMessage(tx("primaryAdminOnly", "只有主账号可以管理用户。"));
      return;
    }
    if (!selectedGrantUser || selectedGrantUserIsPrimary) {
      setGrantMessage(tx("selectMember", "选择用户"));
      return;
    }
    setGrantMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedGrantUser.id, role })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "User role update failed");
      await refreshSession();
      setGrantMessage(tx("roleUpdated", "管理员权限已更新"));
    } catch (caught) {
      setGrantMessage(cleanErrorMessage(stringifyError(caught), language));
    }
  }

  async function deleteSelectedUser() {
    if (!isPrimaryAdmin) {
      setGrantMessage(tx("primaryAdminOnly", "只有主账号可以管理用户。"));
      return;
    }
    if (!selectedGrantUser || selectedGrantUserIsPrimary) {
      setGrantMessage(tx("selectMember", "选择用户"));
      return;
    }
    const confirmed = window.confirm(
      language === "zh"
        ? `确定删除 ${selectedGrantUser.email} 吗？该用户将无法登录，积分、任务和历史记录会一起删除。`
        : `Delete ${selectedGrantUser.email}? This removes their access, credits, tasks, and history.`
    );
    if (!confirmed) return;
    setGrantMessage("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedGrantUser.id })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "User deletion failed");
      setGrantUserId("");
      await refreshSession();
      setGrantMessage(tx("userDeleted", "用户已删除"));
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
        ...optimized.map((file, index) => ({
          name: file.name,
          url: URL.createObjectURL(file),
          label: defaultReferenceLabel(current.length + index)
        }))
      ]);
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
  }

  function updateReferenceLabel(index: number, label: string) {
    setReferencePreviews((current) =>
      current.map((preview, itemIndex) => (itemIndex === index ? { ...preview, label } : preview))
    );
  }

  function clearReferences() {
    for (const preview of referencePreviews) URL.revokeObjectURL(preview.url);
    setReferenceFiles([]);
    setReferencePreviews([]);
    setImageUrl("");
  }

  function updateBatchPrompt(id: string, value: string) {
    setBatchPrompts((current) => current.map((item) => (item.id === id ? { ...item, value } : item)));
  }

  function getBatchSlotModel(slot: BatchPromptSlot) {
    void slot;
    return videoModel;
  }

  function chooseVideoModel(model: string) {
    setVideoModel(model);
    setSeconds((current) => normalizeDurationForModel(model, current, language));
    setVideoSize((current) => normalizeResolutionForModel(model, current, language));
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
                ...optimized.map((file, index) => ({
                  name: file.name,
                  url: URL.createObjectURL(file),
                  label: defaultReferenceLabel(item.referencePreviews.length + index)
                }))
              ]
            }
          : item
      )
    );
  }

  function updateBatchReferenceLabel(id: string, index: number, label: string) {
    setBatchPrompts((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              referencePreviews: item.referencePreviews.map((preview, itemIndex) =>
                itemIndex === index ? { ...preview, label } : preview
              )
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

  function updateImageTask(id: string, patch: Partial<ImageTask>) {
    setImageTasks((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function previewImageTask(task: ImageTask) {
    if (!task.result && !task.url) return;
    setMode("image");
    setImageModel(task.model);
    setImageResult(task.result || { data: [{ url: task.url || "" }] });
    setVideoResult(null);
    setError("");
  }

  function previewBatchJob(job: BatchJob) {
    if (!job.url && !job.taskId) return;
    setMode("video");
    chooseVideoModel(job.model);
    setImageResult(null);
    setVideoResult({
      id: job.taskId || job.id,
      task_id: job.taskId || job.id,
      status: job.status || "completed",
      progress: job.progress || 100,
      video_url: job.url
    });
    setError("");
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
    setActiveTool(item.mode);
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

  async function pollImageJob(id: string) {
    try {
      for (let attempt = 0; attempt < 210; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const statusResponse = await fetch(`/api/images/status?id=${encodeURIComponent(id)}`);
        const status = (await statusResponse.json()) as ImageJobResult;
        if (!statusResponse.ok) throw new Error(JSON.stringify(status));
        updateImageTask(id, {
          status: status.status || "in_progress",
          progress: getPendingImageProgress(status.status, status.progress)
        });
        setGenerationStatus({
          label: status.status || tx("statusProcessing", "生成中"),
          detail: id,
          progress: getPendingImageProgress(status.status, status.progress),
          tone: "running"
        });
        if (status.status === "completed" && status.result) {
          const imageUrl = extractImageUrl(status.result);
          updateImageTask(id, {
            status: "completed",
            progress: 100,
            result: status.result,
            url: imageUrl || undefined,
            error: ""
          });
          setImageResult(status.result);
          setGenerationStatus({
            label: tx("statusCompleted", "生成完成"),
            detail: tx("statusImageReady", "图片已生成，可以预览和下载。"),
            progress: 100,
            tone: "done"
          });
          void refreshHistory();
          return;
        }
        if (status.status === "failed") throw new Error(JSON.stringify(status.error || status));
      }

      throw new Error(language === "zh" ? "图片任务还在处理中，请稍后刷新历史记录。" : "Image task is still processing. Check history later.");
    } catch (caught) {
      updateImageTask(id, {
        status: "failed",
        progress: 0,
        error: cleanErrorMessage(stringifyError(caught), language)
      });
      setError(stringifyError(caught) || t.imageFailed);
      setGenerationStatus({
        label: tx("statusFailed", "生成失败"),
        detail: cleanErrorMessage(stringifyError(caught), language),
        progress: 0,
        tone: "error"
      });
    } finally {
      void refreshSession();
    }
  }

  function openAsset(url?: string) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function generateImage() {
    if (!currentUser) return;
    if (promptOverLimit) {
      setError(getPromptTooLongMessage(promptLength, promptLimit, language));
      return;
    }
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
      const startResponse = referenceFiles.length > 0
        ? await submitImageStartForm()
        : await fetch("/api/images/start", {
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
      const nextTask: ImageTask = {
        id: started.id,
        prompt,
        model: imageModel,
        status: started.status || "queued",
        progress: getPendingImageProgress(started.status, started.progress)
      };
      setImageTasks((current) => [nextTask, ...current].slice(0, 20));
      setGenerationStatus({
        label: tx("imageSubmitted", "图片任务提交成功"),
        detail: tx("imageSubmittedHint", "系统正在后台生成，您可以继续提交下一张图片。"),
        progress: getPendingImageProgress(started.status, started.progress),
        tone: "running"
      });
      setIsLoading(false);
      void refreshSession();
      void pollImageJob(started.id);
    } catch (caught) {
      setError(stringifyError(caught) || t.imageFailed);
      setGenerationStatus({
        label: tx("statusFailed", "生成失败"),
        detail: cleanErrorMessage(stringifyError(caught), language),
        progress: 0,
        tone: "error"
      });
      setIsLoading(false);
      void refreshSession();
    }
  }

  function submitImageStartForm() {
    const formData = new FormData();
    formData.set("model", imageModel);
    formData.set("prompt", prompt);
    formData.set("size", imageSize);
    formData.set("aspect_ratio", "9:16");
    formData.set("n", "1");
    formData.set("response_format", "url");
    for (const reference of referenceFiles) formData.append("image", reference, reference.name);
    return fetch("/api/images/start", { method: "POST", body: formData });
  }

  async function submitVideo(videoPrompt: string, model: string, options?: { references?: File[]; referenceUrl?: string; referenceLabels?: string[] }) {
    const references = options?.references ?? referenceFiles;
    const referenceUrl = options?.referenceUrl ?? imageUrl;
    const referenceLabels = options?.referenceLabels ?? referencePreviews.map((preview, index) => preview.label.trim() || defaultReferenceLabel(index));
    const formData = new FormData();
    formData.set("model", model);
    formData.set("prompt", videoPrompt);
    formData.set("seconds", normalizeDurationForModel(model, seconds, language));
    formData.set("size", normalizeResolutionForModel(model, videoSize, language));
    if (referenceUrl) formData.set("image_url", referenceUrl);
    references.forEach((reference, index) => {
      formData.append("input_reference", reference, reference.name);
      formData.append("reference_label", referenceLabels[index] || defaultReferenceLabel(index));
    });

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
          const pending = { id, task_id: id, status: "queued", progress: 8, transient: true };
          onUpdate?.(pending);
          if (syncMainResult) setVideoResult((current) => current ?? pending);
          setGenerationStatus({
          label: tx("statusSyncing", "正在同步上游状态"),
            detail: id,
            progress: 8,
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
          progress: getPendingVideoProgress(payload.status, payload.progress),
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
          void refreshSession();
          void refreshHistory();
          return payload;
        }
        if (isVideoFailed(payload.status)) {
          void refreshSession();
          void refreshHistory();
          throw new Error(JSON.stringify(payload));
        }
        await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
      }
      throw new Error(t.videoStillProcessing);
    } finally {
      void refreshSession();
      setIsPolling(false);
    }
  }

  async function generateVideo() {
    if (!currentUser) return;
    if (promptOverLimit) {
      setError(getPromptTooLongMessage(promptLength, promptLimit, language));
      return;
    }
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
      const effectiveModel = videoModel;

      for (let attempt = 0; attempt < MAX_VIDEO_ATTEMPTS; attempt += 1) {
        try {
          const payload = await submitVideo(prompt, effectiveModel);
          setVideoResult(payload);
          const taskId = getVideoTaskId(payload);
          if (taskId) {
            setGenerationStatus({
              label: tx("statusQueued", "任务已排队"),
              detail: taskId,
              progress: getPendingVideoProgress(payload.status, payload.progress),
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
    if (batchPromptOverLimit) {
      setError(tx("promptTooLong", "提示词太长，请先精简后再生成。"));
      return;
    }
    if (!canAffordBatch) {
      setError(tx("insufficientSiteCredits", "站内积分不足，请联系主账号分配积分。"));
      return;
    }

    setMode("video");
    setActiveTool("batch");
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
      progress: 5,
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
            updateJob({ status: "submitting", progress: 5, attempts: attempt + 1, error: "" });
            const payload = await submitVideo(job.prompt, job.model, {
              references: slot.referenceFiles,
              referenceLabels: slot.referencePreviews.map((preview, previewIndex) => preview.label.trim() || defaultReferenceLabel(previewIndex)),
              referenceUrl: ""
            });
            const taskId = getVideoTaskId(payload);
            updateJob({ taskId, status: payload.status || "queued", progress: getPendingVideoProgress(payload.status, payload.progress) });
            if (!taskId) throw new Error(JSON.stringify(payload));
            saveHistory({ mode: "video", model: job.model, prompt: job.prompt, videoId: taskId, status: payload.status });
            finalPayload = await pollVideo(taskId, (next) => {
              updateJob({
                status: next.status || "queued",
                progress: getPendingVideoProgress(next.status, next.progress),
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

  async function generateDeepSeek() {
    if (!currentUser) return;
    if (!canSubmitDeepSeek) {
      setError(tx("insufficientSiteCredits", "站内积分不足，请联系主账号分配积分。"));
      return;
    }

    setError("");
    setDeepSeekResult(null);
    setIsDeepSeekLoading(true);
    setGenerationStatus({
      label: tx("deepSeekSubmitting", "DeepSeek 正在生成"),
      detail: tx("deepSeekSubmittingHint", "正在优化提示词和文案。"),
      progress: 20,
      tone: "running"
    });

    try {
      const response = await fetch("/api/deepseek/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: deepSeekModel,
          task: deepSeekTask,
          prompt: deepSeekInput,
          language
        })
      });
      const payload = (await response.json()) as DeepSeekResult & { error?: unknown; detail?: unknown };
      if (!response.ok || !payload.text) throw new Error(JSON.stringify(payload));
      setDeepSeekResult(payload);
      setGenerationStatus({
        label: tx("deepSeekDone", "DeepSeek 已完成"),
        detail: tx("deepSeekDoneHint", "结果可以复制或填入生成提示词。"),
        progress: 100,
        tone: "done"
      });
      await refreshSession();
    } catch (caught) {
      const message = cleanErrorMessage(stringifyError(caught), language) || tx("deepSeekFailed", "DeepSeek 生成失败");
      setError(message);
      setGenerationStatus({
        label: tx("statusFailed", "生成失败"),
        detail: message,
        progress: 0,
        tone: "error"
      });
    } finally {
      setIsDeepSeekLoading(false);
    }
  }

  function applyDeepSeekResult() {
    const text = deepSeekResult?.text?.trim();
    if (!text) return;
    if (deepSeekTask === "batch_shots") {
      const lines = text
        .split(/\n+/)
        .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)、])\s*/, "").trim())
        .filter(Boolean)
        .slice(0, MAX_BATCH_VIDEOS);
      if (lines.length) {
        setBatchPrompts((current) => current.map((item, index) => (lines[index] ? { ...item, value: lines[index] } : item)));
      }
      switchWorkspace("batch");
      return;
    }
    setPrompt(text);
    if (deepSeekTask === "video_prompt") {
      switchWorkspace("video");
      return;
    }
    switchWorkspace("image");
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

          <div className="workspace-switcher">
            <div className="workspace-avatar">{workspaceAvatar}</div>
            <div>
              <strong>{workspaceTitle}</strong>
              <small>{tx("teamSpace", "团队空间")}</small>
            </div>
          </div>

          <nav className="feature-nav" aria-label={tx("featureArea", "功能区")}>
            <button className={`feature-nav-item ${activeTool === "home" ? "active" : ""}`} onClick={() => switchWorkspace("home")} type="button">
              <Home size={17} />
              <span>{tx("home", "首页")}</span>
            </button>
            <button className={`feature-nav-item ${activeTool === "video" ? "active" : ""}`} type="button" onClick={() => switchWorkspace("video")}>
              <Film size={17} />
              <span>{tx("aiVideo", "AI 视频")}</span>
            </button>
            <button className={`feature-nav-item ${activeTool === "image" ? "active" : ""}`} type="button" onClick={() => switchWorkspace("image")}>
              <ImageIcon size={17} />
              <span>{tx("aiImage", "AI 图片")}</span>
            </button>
            <button className={`feature-nav-item ${activeTool === "deepseek" ? "active" : ""}`} type="button" onClick={() => switchWorkspace("deepseek")}>
              <Wand2 size={17} />
              <span>{tx("deepSeekAssistant", "DeepSeek 助手")}</span>
            </button>
            <button className={`feature-nav-item ${activeTool === "tiktok" ? "active" : ""}`} type="button" onClick={() => switchWorkspace("tiktok")}>
              <ShoppingBag size={17} />
              <span>{tx("premiumTiktok", "优质 TikTok 账号")}</span>
            </button>
            <button className={`feature-nav-item ${activeTool === "batch" ? "active" : ""}`} type="button" onClick={() => switchWorkspace("batch")}>
              <Layers3 size={17} />
              <span>{tx("batchGenerate", "批量生成")}</span>
              <small>{filledBatchSlots.length}/10</small>
            </button>
            <button className={`feature-nav-item ${activeTool === "library" ? "active" : ""}`} onClick={() => switchWorkspace("library")} type="button">
              <FolderOpen size={17} />
              <span>{tx("assetLibrary", "资源库")}</span>
            </button>
          </nav>

          <div className="account-card">
            <div className="account-info-block">
              <span className="section-label compact">
                {isAdmin ? <Shield size={14} /> : <User size={14} />}
                {isAdmin ? tx("adminAccount", "管理员") : tx("memberAccount", "成员账号")}
              </span>
              <div className="profile-name-row">
                <input
                  aria-label={tx("editName", "修改昵称")}
                  className="profile-name-input"
                  maxLength={32}
                  onChange={(event) => setProfileName(event.target.value)}
                  placeholder={tx("namePlaceholder", "输入新昵称")}
                  value={profileName}
                />
                <button
                  className="icon-button"
                  disabled={isSavingProfile || !profileName.trim() || profileName.trim() === currentUser.name}
                  onClick={() => void saveProfileName()}
                  title={tx("saveName", "保存昵称")}
                  type="button"
                >
                  {isSavingProfile ? <Loader2 size={15} /> : profileName.trim() === currentUser.name ? <Edit3 size={15} /> : <Save size={15} />}
                </button>
              </div>
              <small>{currentUser.email}</small>
              {profileMessage ? <small className="profile-message">{profileMessage}</small> : null}
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
              {isPrimaryAdmin ? (
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
                </>
              ) : null}

              <div className="admin-panel">
                <div className="admin-panel-head">
                  <p className="section-label compact"><Users size={14} />{tx("memberCredits", "成员积分管理")}</p>
                  <button className="text-button" onClick={() => void refreshSession()} type="button">{tx("refreshAccount", "刷新账号")}</button>
                </div>
                <select className="select" onChange={(event) => setGrantUserId(event.target.value)} value={grantUserId}>
                  <option value="">{tx("selectMember", "选择用户")}</option>
                  {(session?.users || []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {user.id === session?.adminId ? tx("primaryAccount", "主账号") : user.role === "admin" ? tx("adminRole", "管理员") : tx("memberRole", "成员")} · {formatDisplayCredits(user.credits)}
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

                <div className="usage-panel">
                  <div className="usage-panel-head">
                    <span className="section-label compact"><Activity size={14} />{tx("usageToday", "今日积分使用")}</span>
                    <button className="text-button" onClick={() => void refreshUsageSummary()} type="button">{tx("refreshAccount", "刷新账号")}</button>
                  </div>
                  {usageSummary ? (
                    <div className="usage-total-grid">
                      <div>
                        <span>{tx("spentToday", "今日消耗")}</span>
                        <strong>{formatDisplayCredits(usageSummary.totals.spent)}</strong>
                      </div>
                      <div>
                        <span>{tx("refundedToday", "失败返还")}</span>
                        <strong>{formatDisplayCredits(usageSummary.totals.refunded)}</strong>
                      </div>
                      <div>
                        <span>{tx("netSpentToday", "实际消耗")}</span>
                        <strong>{formatDisplayCredits(usageSummary.totals.netSpent)}</strong>
                      </div>
                    </div>
                  ) : null}
                  <div className="usage-list">
                    {usageRows.length ? usageRows.map((item) => (
                      <div className="usage-row" key={item.user.id}>
                        <div>
                          <strong>{item.user.name}</strong>
                          <small>{item.user.email}</small>
                        </div>
                        <span>{tx("spentToday", "今日消耗")} {formatDisplayCredits(item.spent)}</span>
                        <span>{tx("refundedToday", "失败返还")} {formatDisplayCredits(item.refunded)}</span>
                        <span>
                          {tx("tasksToday", "今日任务")} {item.tasks.total}
                          <small>{tx("completedTasks", "完成")} {item.tasks.completed} / {tx("failedTasks", "失败")} {item.tasks.failed} / {tx("runningTasks", "进行中")} {item.tasks.running}</small>
                        </span>
                      </div>
                    )) : (
                      <small className="usage-empty">{tx("usageEmpty", "今日暂无使用记录")}</small>
                    )}
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
                {isPrimaryAdmin && selectedGrantUser && !selectedGrantUserIsPrimary ? (
                  <div className="user-admin-actions">
                    <button
                      className="secondary-button"
                      onClick={() => void updateUserRole(selectedGrantUser.role === "admin" ? "user" : "admin")}
                      type="button"
                    >
                      <Shield size={16} />
                      {selectedGrantUser.role === "admin" ? tx("removeAdmin", "取消管理员") : tx("makeAdmin", "设为管理员")}
                    </button>
                    <button className="danger-button" onClick={() => void deleteSelectedUser()} type="button">
                      <X size={16} />{tx("deleteUser", "删除用户")}
                    </button>
                  </div>
                ) : null}
                {grantMessage ? <small className="admin-message">{grantMessage}</small> : null}
              </div>
            </>
          ) : null}

          <div className="rail-note">{t.note}</div>
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
              <div className="status-pill"><Clapperboard size={15} />{activeWorkspaceModel}</div>
              <div className="status-pill cost-pill">{t.estimatedCost}: {activeWorkspaceCostText}</div>
            </div>
          </header>

          <div className="production-strip">
            <div className="production-left">
              <span className="mini-pill"><Layers3 size={14} />{readyCount}/{workspaceCapacity}</span>
              <span className="mini-pill">{tx("singleTask", "单条任务")}: {activeWorkspaceCostText}</span>
              <span className="mini-pill">
                {productionTotalLabel}: {isTiktokWorkspace ? `${tiktokInventory[tiktokActiveCategory].length} ${tx("rows", "条")}` : formatCreditTotal(productionTotalCost, language)}
              </span>
            </div>
            <div className="production-stats">
              <div>
                <Activity size={15} />
                <span>{tx("ready", "就绪")}</span>
                <strong>{readyCount}</strong>
              </div>
              <div>
                <Loader2 className={runningCount ? "spin" : ""} size={15} />
                <span>{tx("running", "进行中")}</span>
                <strong>{runningCount}</strong>
              </div>
              <div>
                <CheckCircle2 size={15} />
                <span>{tx("done", "已完成")}</span>
                <strong>{completedCount}</strong>
              </div>
              <div>
                <X size={15} />
                <span>{tx("failed", "失败")}</span>
                <strong>{failedCount}</strong>
              </div>
            </div>
          </div>

          <div className="compose-body">
            {showCreditWarning ? (
              <div className="credit-warning">
                <Wallet size={18} />
                <div>
                  <strong>{tx("noCreditsTitle", "站内积分不足")}</strong>
                  <span>
                    {tx("noCreditsBody", "当前账号积分不够生成，请联系主账号分配积分后再试。")}
                    {" "}
                    {tx("estimatedCost", "预计消耗")}: {activeWorkspaceCostText}
                  </span>
                </div>
              </div>
            ) : null}

            {!isDeepSeekWorkspace && !isTiktokWorkspace ? (
            <div className="model-picker-panel">
              <div className="model-compact-row">
                <div className="segmented model-mode-tabs" aria-label="media type">
                  <button className={`segment ${mode === "image" ? "active" : ""}`} onClick={() => switchMedia("image")} type="button">
                    <ImageIcon size={16} />{t.image}
                  </button>
                  <button className={`segment ${mode === "video" ? "active" : ""}`} onClick={() => switchMedia("video")} type="button">
                    <Film size={16} />{t.video}
                  </button>
                </div>

                <div className="field model-select-field">
                  <label htmlFor="model-select">{tx("model", "模型")}</label>
                  <select
                    className="select"
                    id="model-select"
                    onChange={(event) => (mode === "image" ? setImageModel(event.target.value) : chooseVideoModel(event.target.value))}
                    value={activeModel}
                  >
                    {groupedVisibleModels.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map((model) => {
                          const modelDuration = mode === "video" ? normalizeDurationForModel(model, seconds, language) : undefined;
                          const modelResolution = mode === "video" ? normalizeResolutionForModel(model, videoSize, language) : undefined;
                          return (
                            <option key={model} value={model}>
                              {getModelTitle(model, language)} · {formatCreditCost(model, language, modelDuration, modelResolution)}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>

              <div className="selected-model-summary">
                <div>
                  <strong>{getModelTitle(activeModel, language)}</strong>
                  <span>{activeModelDescription}</span>
                </div>
                <div className="model-summary-badges">
                  <b>{formatPromptLimit(activeModel, mode, language)}</b>
                  {mode === "video" && modelRequiresFirstFrame(activeModel) ? (
                    <b>{tx("startEndFrameSupported", language === "zh" ? "首帧必填 · 尾帧可选" : "Start required · End optional")}</b>
                  ) : null}
                  <b>{activeWorkspaceCostText}</b>
                </div>
              </div>
            </div>
            ) : null}

            {!isBatchWorkspace && !isDeepSeekWorkspace && !isTiktokWorkspace ? (
              <div className="field prompt-field">
                <div className="field-head">
                  <label htmlFor="prompt">{t.prompt}</label>
                  <span className={promptOverLimit ? "limit-counter over" : "limit-counter"}>
                    {tx("promptCounter", "当前 / 上限")}: {promptLength}/{promptLimit}
                  </span>
                </div>
                <textarea className="textarea" id="prompt" onChange={(event) => setPrompt(event.target.value)} placeholder={t.promptPlaceholder} value={prompt} />
                {promptOverLimit ? <small className="field-note danger-text">{getPromptTooLongMessage(promptLength, promptLimit, language)}</small> : null}
              </div>
            ) : null}

            {isTiktokWorkspace ? (
              <div className="tiktok-workspace">
                <div className="tiktok-hero">
                  <div>
                    <p className="section-label compact"><ShoppingBag size={15} />{tx("premiumTiktok", "优质 TikTok 账号")}</p>
                    <h2>{tx("tiktokTitle", "TikTok 账号库存中心")}</h2>
                    <span>{tx("tiktokHint", "普通成员可以查看库存，管理员可以编辑表格、上传截图并保存。")}</span>
                  </div>
                  <div className="tiktok-hero-badges">
                    <b><KeyRound size={14} />2FA</b>
                    <b><Table2 size={14} />{tx("smartTable", "智能表格")}</b>
                    <b>{isAdmin ? tx("editable", "可编辑") : tx("viewOnly", "仅查看")}</b>
                  </div>
                </div>

                <div className="tiktok-product-list">
                  {tiktokProducts.map((product) => {
                    const rows = tiktokInventory[product.id] || [];
                    return (
                      <button
                        className={`tiktok-product-card ${tiktokActiveCategory === product.id ? "active" : ""}`}
                        key={product.id}
                        onClick={() => setTiktokActiveCategory(product.id)}
                        type="button"
                      >
                        <div className="tiktok-logo">♪</div>
                        <div>
                          <div className="tiktok-title-row">
                            <span className="choice-badge">{product.badge}</span>
                            <strong>{product.title}</strong>
                          </div>
                          <p>{product.subtitle}</p>
                          <div className="tiktok-meta-row">
                            <b>{product.priceLine}</b>
                            <span><Table2 size={13} />{rows.length} {tx("rows", "条")}</span>
                            <span>{tx("autoResize", "图片自动伸缩")}</span>
                          </div>
                        </div>
                        <span className="tiktok-card-action">{tiktokActiveCategory === product.id ? tx("selected", "已选择") : tx("select", "选择")}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="smart-table-panel">
                  <div className="smart-table-head">
                    <div>
                      <p className="section-label compact"><Table2 size={15} />{tiktokProducts.find((item) => item.id === tiktokActiveCategory)?.title}</p>
                      <h3>{tx("inventoryTable", "账号库存智能表格")}</h3>
                      <span>{tx("inventoryTableHint", "上传图片后会自动压缩并按比例预览；文本内容会随行高伸缩。")}</span>
                    </div>
                    <div className="smart-table-actions">
                      {isAdmin ? (
                        <>
                          <button className="secondary-button" onClick={() => addTiktokRow(tiktokActiveCategory)} type="button">
                            <Plus size={16} />{tx("addRow", "添加一行")}
                          </button>
                          <button className="primary-button" disabled={isTiktokLoading} onClick={() => void saveTiktokCategory(tiktokActiveCategory)} type="button">
                            {isTiktokLoading ? <Loader2 className="spin" size={16} /> : <Table2 size={16} />}
                            {tx("saveTable", "保存表格")}
                          </button>
                        </>
                      ) : (
                        <span className="view-only-pill">{tx("viewOnly", "仅查看")}</span>
                      )}
                    </div>
                  </div>

                  {tiktokMessage ? <div className="admin-message">{tiktokMessage}</div> : null}

                  <div className="smart-table-wrap">
                    <table className="smart-table">
                      <thead>
                        <tr>
                          <th>{tx("accountImage", "图片")}</th>
                          <th>{tx("accountInfo", "账号/编号")}</th>
                          <th>{tx("price", "价格")}</th>
                          <th>{tx("followers", "粉丝")}</th>
                          <th>{tx("twoFa", "2FA/验证")}</th>
                          <th>{tx("emailInfo", "邮箱/售后")}</th>
                          <th>{tx("status", "状态")}</th>
                          <th>{tx("notes", "备注")}</th>
                          {isAdmin ? <th>{tx("actions", "操作")}</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {(tiktokInventory[tiktokActiveCategory] || []).map((row) => {
                          const tiktokDropId = `tiktok-image-drop-${row.id}`;
                          return (
                          <tr key={row.id}>
                            <td className="smart-image-cell">
                              <label
                                className={`${isAdmin ? "smart-image-uploader editable" : "smart-image-uploader"} ${dragTarget === tiktokDropId ? "drag-active" : ""}`}
                                htmlFor={`tiktok-image-${row.id}`}
                                onDragLeave={isAdmin ? (event) => handleImageDragLeave(event, tiktokDropId) : undefined}
                                onDragOver={isAdmin ? (event) => handleImageDragOver(event, tiktokDropId) : undefined}
                                onDrop={isAdmin ? (event) => handleImageDrop(event, tiktokDropId, (files) => uploadTiktokImage(tiktokActiveCategory, row.id, files)) : undefined}
                              >
                                {row.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img alt={row.account || "TikTok account"} src={row.imageUrl} />
                                ) : (
                                  <span><ImagePlus size={18} />{tx("uploadImage", "上传图片")}</span>
                                )}
                              </label>
                              {isAdmin ? (
                                <input
                                  accept="image/*"
                                  id={`tiktok-image-${row.id}`}
                                  onChange={(event) => {
                                    void uploadTiktokImage(tiktokActiveCategory, row.id, event.target.files);
                                    event.target.value = "";
                                  }}
                                  type="file"
                                />
                              ) : null}
                            </td>
                            {(["account", "price", "followers", "twoFa", "email", "status", "notes"] as Array<keyof TiktokInventoryRow>).map((field) => (
                              <td key={field}>
                                <textarea
                                  className="smart-cell-input"
                                  onChange={(event) => updateTiktokRow(tiktokActiveCategory, row.id, field, event.target.value)}
                                  readOnly={!isAdmin}
                                  rows={1}
                                  value={String(row[field] || "")}
                                />
                              </td>
                            ))}
                            {isAdmin ? (
                              <td>
                                <button className="danger-button compact-danger" onClick={() => deleteTiktokRow(tiktokActiveCategory, row.id)} type="button">
                                  <X size={15} />{tx("delete", "删除")}
                                </button>
                              </td>
                            ) : null}
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : isDeepSeekWorkspace ? (
              <div className="deepseek-panel">
                <div className="field-head">
                  <label>{tx("deepSeekAssistant", "DeepSeek 助手")}</label>
                  <span>{tx("deepSeekPanelHint", "写提示词、拆分分镜、生成产品卖点。")}</span>
                </div>

                <div className="param-grid deepseek-controls">
                  <div className="field">
                    <label htmlFor="deepseek-model">{tx("deepSeekModel", "DeepSeek 模型")}</label>
                    <select className="select" id="deepseek-model" onChange={(event) => setDeepSeekModel(event.target.value)} value={deepSeekModel}>
                      {stableDeepSeekModels.map((model) => (
                        <option key={model} value={model}>
                          {model} · {formatCreditCost(model, language)}
                        </option>
                      ))}
                    </select>
                    <small className="field-note">{getDeepSeekModelDescription(deepSeekModel, language)}</small>
                  </div>
                  <div className="field">
                    <label htmlFor="deepseek-task">{tx("deepSeekTask", "输出用途")}</label>
                    <select className="select" id="deepseek-task" onChange={(event) => setDeepSeekTask(event.target.value as DeepSeekTask)} value={deepSeekTask}>
                      {deepSeekTaskOptions.map((task) => (
                        <option key={task} value={task}>{getDeepSeekTaskTitle(task, language)}</option>
                      ))}
                    </select>
                    <small className="field-note">{getDeepSeekTaskDescription(deepSeekTask, language)}</small>
                  </div>
                  <div className="field">
                    <label>{t.estimatedCost}</label>
                    <button className="primary-button" disabled={!canSubmitDeepSeek} onClick={() => void generateDeepSeek()} type="button">
                      {isDeepSeekLoading ? <Loader2 size={18} /> : <Wand2 size={18} />}
                      {tx("generateDeepSeek", "生成文案")}
                      <small>{formatCreditCost(deepSeekModel, language)}</small>
                    </button>
                  </div>
                </div>

                <div className="field">
                  <div className="field-head">
                    <label htmlFor="deepseek-input">{tx("deepSeekInput", "你的想法")}</label>
                    <span className={promptOverLimit ? "limit-counter over" : "limit-counter"}>
                      {tx("promptCounter", "当前 / 上限")}: {promptLength}/{promptLimit}
                    </span>
                  </div>
                  <textarea
                    className="textarea deepseek-input"
                    id="deepseek-input"
                    onChange={(event) => setDeepSeekInput(event.target.value)}
                    placeholder={tx("deepSeekInputPlaceholder", "例如：帮我写一个黑人短卷 pixie 假发的视频广告分镜，真实质感，适合 TikTok。")}
                    value={deepSeekInput}
                  />
                  {promptOverLimit ? <small className="field-note danger-text">{getPromptTooLongMessage(promptLength, promptLimit, language)}</small> : null}
                </div>

                {deepSeekResult?.text ? (
                  <div className="deepseek-output">
                    <div className="field-head">
                      <label>{tx("deepSeekOutput", "DeepSeek 结果")}</label>
                      <span>{formatCreditTotal(deepSeekResult.charged, language)}</span>
                    </div>
                    <pre>{deepSeekResult.text}</pre>
                    <div className="deepseek-actions">
                      <button className="secondary-button" onClick={applyDeepSeekResult} type="button">
                        <Wand2 size={16} />{tx("applyDeepSeek", "填入生成提示词")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : mode === "image" ? (
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
                    <label htmlFor="video-size">{t.resolution}</label>
                    <select
                      className="select"
                      id="video-size"
                      disabled={resolutionOptions.length <= 1}
                      onChange={(event) => chooseVideoResolution(event.target.value)}
                      value={normalizedVideoSize}
                    >
                      {resolutionOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
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
                  {isBatchWorkspace ? (
                    <div className="field">
                      <label>{tx("batchWorkspace", "批量生成")}</label>
                      <input
                        className="input"
                        readOnly
                        value={`${readyCount}/${MAX_BATCH_VIDEOS} · ${formatCreditTotal(batchCreditTotal, language)}`}
                      />
                    </div>
                  ) : (
                    <div className="field">
                      <label>{t.estimatedCost}</label>
                      <button className="primary-button" disabled={!canSubmit} onClick={generateVideo} type="button">
                        {isLoading ? <Loader2 size={18} /> : <Play size={18} />}{t.generateVideo}
                        <small>{formatCreditCost(videoModel, language, seconds, normalizedVideoSize)}</small>
                      </button>
                    </div>
                  )}
                </div>

                {isBatchWorkspace ? (
                  <div className="batch-panel">
                    <div className="field-head">
                      <label htmlFor="batch-prompt">{t.batchPrompt}</label>
                      <span>{t.batchLimit} · {t.batchEstimatedCost}: {formatCreditTotal(batchCreditTotal, language)}</span>
                    </div>
                    <div className="batch-grid">
                      {batchPrompts.map((slot, index) => {
                        const batchDropId = `batch-reference-drop-${slot.id}`;
                        return (
                        <div className="batch-card" key={slot.id}>
                          <div className="batch-card-head">
                            <strong>{tx("work", "作品")} {index + 1}</strong>
                            <small>{formatCreditCost(getBatchSlotModel(slot), language, seconds, normalizeResolutionForModel(getBatchSlotModel(slot), videoSize, language))}</small>
                          </div>
                          <div className="batch-limit-row">
                            <span>{formatPromptLimit(getBatchSlotModel(slot), "video", language)}</span>
                            <b className={slot.value.trim().length > getModelPromptLimit(getBatchSlotModel(slot), "video") ? "over" : ""}>
                              {slot.value.trim().length}/{getModelPromptLimit(getBatchSlotModel(slot), "video")}
                            </b>
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
                            <label
                              className={`batch-reference-drop ${dragTarget === batchDropId ? "drag-active" : ""}`}
                              htmlFor={`batch-reference-${slot.id}`}
                              onDragLeave={(event) => handleImageDragLeave(event, batchDropId)}
                              onDragOver={(event) => handleImageDragOver(event, batchDropId)}
                              onDrop={(event) => handleImageDrop(event, batchDropId, (files) => addBatchReferenceFiles(slot.id, files))}
                            >
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
                                    {getReferenceRoleLabel(previewIndex, videoModel, language) ? (
                                      <span className="frame-role-badge">{getReferenceRoleLabel(previewIndex, videoModel, language)}</span>
                                    ) : null}
                                    <input
                                      aria-label={`${t.referenceLabel} ${previewIndex + 1}`}
                                      className="reference-label-input"
                                      onChange={(event) => updateBatchReferenceLabel(slot.id, previewIndex, event.target.value)}
                                      title={t.referenceLabelHint}
                                      value={preview.label}
                                    />
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
                        );
                      })}
                    </div>
                    <button className="secondary-button" disabled={isLoading || isPolling || !canAffordBatch} onClick={generateBatchVideos} type="button">
                      {isLoading ? <Loader2 size={18} /> : <Clapperboard size={18} />}{t.generateBatch}
                      <small>{formatCreditTotal(batchCreditTotal, language)}</small>
                    </button>
                  </div>
                ) : null}
              </>
            )}

            {!isBatchWorkspace && !isDeepSeekWorkspace && !isTiktokWorkspace ? (
            <div className="field reference-field">
              <div className="field-head">
                <label htmlFor={referenceInputId}>{t.referenceImages}</label>
                <span>
                  {modelSupportsEndFrame(videoModel)
                    ? tx("startEndFrameHint", language === "zh" ? "第 1 张首帧，第 2 张尾帧" : "1st image start, 2nd image end")
                    : t.referenceLimit}
                </span>
              </div>
              <div className="reference-panel">
                <label
                  className={`reference-drop ${dragTarget === referenceDropId ? "drag-active" : ""}`}
                  htmlFor={referenceInputId}
                  onDragLeave={(event) => handleImageDragLeave(event, referenceDropId)}
                  onDragOver={(event) => handleImageDragOver(event, referenceDropId)}
                  onDrop={(event) => handleImageDrop(event, referenceDropId, addReferenceFiles)}
                >
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
                        {getReferenceRoleLabel(index, videoModel, language) ? (
                          <span className="frame-role-badge">{getReferenceRoleLabel(index, videoModel, language)}</span>
                        ) : null}
                        <input
                          aria-label={`${t.referenceLabel} ${index + 1}`}
                          className="reference-label-input"
                          onChange={(event) => updateReferenceLabel(index, event.target.value)}
                          title={t.referenceLabelHint}
                          value={preview.label}
                        />
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
            ) : null}

            {videoId && !isDeepSeekWorkspace && !isTiktokWorkspace ? (
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
              <div className="result-actions">
                <button className="secondary-button" onClick={() => openAsset(downloadUrl)} type="button">
                  <ExternalLink size={16} />{t.viewResult}
                </button>
                <button className="secondary-button" onClick={() => void downloadGeneratedAsset()} type="button">
                  <Download size={16} />{t.download}
                </button>
              </div>
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
            {isDeepSeekWorkspace && deepSeekResult?.text ? (
              <div className="deepseek-result-preview">
                <pre>{deepSeekResult.text}</pre>
              </div>
            ) : activeImageViewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Generated result" src={activeImageViewUrl} />
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
                {isDeepSeekWorkspace ? <Wand2 size={44} /> : mode === "image" ? <ImageIcon size={44} /> : <Film size={44} />}
                <strong>{t.waiting}</strong>
                <span>{isDeepSeekWorkspace ? tx("deepSeekWaitingHint", "输入想法后，DeepSeek 会帮你整理成可直接使用的提示词或文案。") : t.waitingHint}</span>
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

          {mode === "image" && !isDeepSeekWorkspace && !isTiktokWorkspace ? (
            <div className="image-task-panel">
              <div className="history-head">
                <h3>{tx("imageTasks", "图片任务")}</h3>
                <small>{imageTasks.length ? `${imageTasks.length}` : tx("imageTaskEmpty", "当前还没有图片任务。")}</small>
              </div>
              {imageTasks.length ? (
                <div className="image-task-list">
                  {imageTasks.map((task) => {
                    const taskViewUrl = getViewableImageUrl(task.url || extractImageUrl(task.result || null));
                    const isSelected = Boolean(taskViewUrl && activeImageViewUrl === taskViewUrl);
                    return (
                    <div
                      className={`image-task-card ${task.status === "completed" ? "done" : ""} ${task.status === "failed" ? "failed" : ""} ${isSelected ? "selected" : ""} ${task.result || task.url ? "clickable" : ""}`}
                      key={task.id}
                      onClick={() => previewImageTask(task)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          previewImageTask(task);
                        }
                      }}
                      role={task.result || task.url ? "button" : undefined}
                      tabIndex={task.result || task.url ? 0 : undefined}
                    >
                      <div className="image-task-thumb">
                        {taskViewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={task.prompt} src={taskViewUrl} />
                        ) : task.status === "failed" ? (
                          <X size={22} />
                        ) : (
                          <Loader2 className="spin" size={22} />
                        )}
                      </div>
                      <div className="image-task-main">
                        <div className="image-task-top">
                          <strong>{task.status}</strong>
                          <small>{Math.max(0, Math.min(100, task.progress || 0))}%</small>
                        </div>
                        <span>{task.model}</span>
                        <p>{task.prompt}</p>
                        {task.error ? <em>{cleanErrorMessage(task.error, language)}</em> : null}
                        <div className="status-track compact-track">
                          <span style={{ width: `${Math.max(0, Math.min(100, task.progress || 0))}%` }} />
                        </div>
                      </div>
                      <div className="image-task-actions">
                        {task.result || task.url ? (
                          <div className="task-actions">
                            <button className="text-button" onClick={(event) => { event.stopPropagation(); previewImageTask(task); }} type="button">
                              {tx("viewResult", "查看")}
                            </button>
                            {taskViewUrl ? (
                              <button className="text-button" onClick={(event) => { event.stopPropagation(); openAsset(taskViewUrl); }} type="button">
                                {tx("openResult", language === "zh" ? "打开" : "Open")}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {taskViewUrl ? (
                          <a className="text-button" download href={taskViewUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                            {t.download}
                          </a>
                        ) : null}
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {batchJobs.length ? (
            <div className="batch-results">
              {batchJobs.map((job, index) => {
                const isSelected = Boolean(job.url && videoSrc === job.url);
                return (
                <div
                  className={`batch-job ${job.url || job.taskId ? "clickable" : ""} ${isSelected ? "selected" : ""}`}
                  key={job.id}
                  onClick={() => previewBatchJob(job)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      previewBatchJob(job);
                    }
                  }}
                  role={job.url || job.taskId ? "button" : undefined}
                  tabIndex={job.url || job.taskId ? 0 : undefined}
                >
                  <div>
                    <strong>#{index + 1} {job.status}</strong>
                    <span>{job.progress}% · {job.model} · {formatCreditCost(job.model, language, seconds, normalizeResolutionForModel(job.model, videoSize, language))}</span>
                    <small>{job.prompt}</small>
                  </div>
                  {job.url ? (
                    <div className="batch-job-actions">
                      <button className="secondary-button" onClick={(event) => { event.stopPropagation(); previewBatchJob(job); }} type="button"><Play size={15} />{tx("previewResult", language === "zh" ? "预览" : "Preview")}</button>
                      <a className="secondary-button" href={job.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><ExternalLink size={15} />{t.viewResult}</a>
                      <a className="secondary-button" download href={job.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><Download size={15} />{t.download}</a>
                    </div>
                  ) : null}
                  {job.error ? <p>{cleanErrorMessage(job.error, language)}</p> : null}
                </div>
                );
              })}
            </div>
          ) : null}

          {imageResult ? (
            <details className="debug-box">
              <summary>API response</summary>
              <pre>{JSON.stringify(imageResult, null, 2)}</pre>
            </details>
          ) : null}
          {deepSeekResult?.raw ? (
            <details className="debug-box">
              <summary>DeepSeek response</summary>
              <pre>{JSON.stringify(deepSeekResult.raw, null, 2)}</pre>
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
                    <div
                      className="history-item"
                      key={item.id}
                      onClick={() => restoreHistory(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          restoreHistory(item);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="history-thumb">
                        {item.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img alt={item.prompt} src={getViewableImageUrl(item.previewUrl)} />
                        ) : <ImageIcon size={22} />}
                      </div>
                      <div>
                        <strong>{t.image}</strong>
                        <span>{item.prompt}</span>
                        {item.error ? <small className="history-error">{cleanErrorMessage(item.error, language)}</small> : null}
                        <small>{new Date(item.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small>
                        {item.previewUrl ? (
                          <span className="history-actions">
                            <span className="history-action-text">{tx("restoreResult", language === "zh" ? "恢复到结果区" : "Restore")}</span>
                            <span
                              className="history-action-link"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAsset(getViewableImageUrl(item.previewUrl));
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  openAsset(getViewableImageUrl(item.previewUrl));
                                }
                              }}
                            >
                              <ExternalLink size={13} />{tx("openResult", language === "zh" ? "打开查看" : "Open")}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!imageHistory.length ? <p className="history-empty">{t.historyEmpty}</p> : null}
                </div>
                <div className="history-section-title"><Film size={14} />{t.video}</div>
                <div className="history-list">
                  {videoHistory.map((item) => {
                    const previewUrl = getHistoryVideoPreviewUrl(item);
                    return (
                      <div
                        className="history-item"
                        key={item.id}
                        onClick={() => restoreHistory(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            restoreHistory(item);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="history-thumb video-thumb">
                          {previewUrl ? (
                            <video muted playsInline preload="metadata" src={previewUrl} />
                          ) : <Film size={22} />}
                        </div>
                        <div>
                          <strong>{t.video}</strong>
                          <span>{item.prompt}</span>
                          {item.error ? <small className="history-error">{cleanErrorMessage(item.error, language)}</small> : null}
                          <small>{new Date(item.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}</small>
                          {previewUrl ? (
                            <span className="history-actions">
                              <span className="history-action-text">{tx("restoreResult", language === "zh" ? "恢复到结果区" : "Restore")}</span>
                              <span
                                className="history-action-link"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openAsset(previewUrl);
                                }}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    openAsset(previewUrl);
                                  }
                                }}
                              >
                                <ExternalLink size={13} />{tx("openResult", language === "zh" ? "打开查看" : "Open")}
                              </span>
                            </span>
                          ) : null}
                        </div>
                      </div>
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
