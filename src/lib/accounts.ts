import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export const SESSION_COOKIE = "siyu_session";

export type UserRole = "admin" | "user";
export type GenerationType = "image" | "video";

export type AccountUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  credits: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicAccountUser = Omit<AccountUser, "passwordHash">;

export type AccountSession = {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

export type CreditLedgerEntry = {
  id: string;
  userId: string;
  adminId?: string;
  amount: number;
  balanceAfter: number;
  reason: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type GenerationTaskRecord = {
  id: string;
  userId: string;
  type: GenerationType;
  model: string;
  amount: number;
  status: "queued" | "in_progress" | "completed" | "failed";
  refunded: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GenerationHistoryRecord = {
  id: string;
  userId: string;
  mode: GenerationType;
  model: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  previewUrl?: string;
  taskId?: string;
  status?: string;
  error?: string;
};

export type TiktokInventoryRow = {
  id: string;
  imageUrl?: string;
  account: string;
  price: string;
  followers: string;
  twoFa: string;
  email: string;
  status: string;
  notes: string;
  updatedAt: string;
};

export type AccountState = {
  users: AccountUser[];
  sessions: AccountSession[];
  ledger: CreditLedgerEntry[];
  generationTasks: GenerationTaskRecord[];
  history: GenerationHistoryRecord[];
  tiktokInventory: Record<string, TiktokInventoryRow[]>;
};

type RegisterInput = {
  email: string;
  name?: string;
  password: string;
};

type CreditInput = {
  userId: string;
  amount: number;
  reason: string;
  adminId?: string;
  metadata?: Record<string, unknown>;
};

type RecordGenerationInput = {
  id: string;
  userId: string;
  type: GenerationType;
  model: string;
  amount: number;
};

type RecordHistoryInput = {
  userId: string;
  type: GenerationType;
  model: string;
  prompt: string;
  previewUrl?: string;
  taskId?: string;
  status?: string;
  error?: string;
};

type HistoryPatch = {
  previewUrl?: string;
  status?: string;
  error?: string;
};

const SESSION_DAYS = 7;
const LOCAL_DATA_FILE = path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "siyu-factory-accounts.json");
const RENDER_DISK_DATA_FILE = "/var/data/siyu-factory-accounts.json";
const INITIAL_ADMIN_CREDITS = Number(process.env.SIYU_INITIAL_ADMIN_CREDITS || 20000000);
const GITHUB_STORAGE_REPO = process.env.SIYU_GITHUB_STORAGE_REPO || "siyuliu040-crypto/siyu-factory-ai";
const GITHUB_STORAGE_PATH = process.env.SIYU_GITHUB_STORAGE_PATH || ".data/siyu-factory-accounts.json";
const GITHUB_STORAGE_BRANCH = process.env.SIYU_GITHUB_STORAGE_BRANCH || "main";

const globalForAccounts = globalThis as typeof globalThis & {
  siyuAccountState?: AccountState;
  siyuAccountWrite?: Promise<unknown>;
};

export class AccountError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function assertPositiveAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AccountError("invalid_credit_amount", "Credit amount must be greater than 0.");
  }
}

function createSessionToken() {
  return randomBytes(32).toString("hex");
}

function sessionExpiry() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function dataFilePath() {
  if (process.env.SIYU_DATA_FILE) return process.env.SIYU_DATA_FILE;
  if (process.platform !== "win32" && existsSync("/var/data")) return RENDER_DISK_DATA_FILE;
  return LOCAL_DATA_FILE;
}

function githubStorageToken() {
  return process.env.SIYU_GITHUB_STORAGE_TOKEN || process.env.GITHUB_TOKEN || "";
}

function hasGithubStorage() {
  return Boolean(githubStorageToken() && GITHUB_STORAGE_REPO && GITHUB_STORAGE_PATH);
}

export function getAccountStorageInfo() {
  if (hasGithubStorage()) return { persistent: true, label: "github" };
  if (process.env.SIYU_DATA_FILE || (process.platform !== "win32" && existsSync("/var/data"))) {
    return { persistent: true, label: "disk" };
  }
  return { persistent: false, label: "local" };
}

async function readGithubAccountState() {
  if (!hasGithubStorage()) return null;
  const token = githubStorageToken();
  const url = `https://api.github.com/repos/${GITHUB_STORAGE_REPO}/contents/${encodeURIComponent(GITHUB_STORAGE_PATH).replace(/%2F/g, "/")}?ref=${encodeURIComponent(GITHUB_STORAGE_BRANCH)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    cache: "no-store"
  });
  if (response.status === 404) return createEmptyAccountState();
  if (!response.ok) throw new Error(`GitHub account storage read failed: ${response.status}`);
  const payload = (await response.json()) as { content?: string };
  const text = Buffer.from(String(payload.content || "").replace(/\s/g, ""), "base64")
    .toString("utf8")
    .replace(/^\uFEFF/, "");
  return ensureShape(JSON.parse(text) as Partial<AccountState>);
}

async function writeGithubAccountState(state: AccountState) {
  if (!hasGithubStorage()) return;
  const token = githubStorageToken();
  const apiPath = encodeURIComponent(GITHUB_STORAGE_PATH).replace(/%2F/g, "/");
  const url = `https://api.github.com/repos/${GITHUB_STORAGE_REPO}/contents/${apiPath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
  const current = await fetch(`${url}?ref=${encodeURIComponent(GITHUB_STORAGE_BRANCH)}`, { headers, cache: "no-store" });
  const existing = current.ok ? ((await current.json()) as { sha?: string }) : null;
  if (!current.ok && current.status !== 404) throw new Error(`GitHub account storage sha failed: ${current.status}`);

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      message: "Persist Siyu Factory account state",
      content: Buffer.from(JSON.stringify(state, null, 2), "utf8").toString("base64"),
      sha: existing?.sha,
      branch: GITHUB_STORAGE_BRANCH
    })
  });
  if (!response.ok) throw new Error(`GitHub account storage write failed: ${response.status}`);
}

function isRetryableAccountWriteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    message.includes("GitHub account storage write failed: 409") ||
    message.includes("GitHub account storage write failed: 500") ||
    message.includes("GitHub account storage write failed: 502") ||
    message.includes("GitHub account storage write failed: 503")
  );
}

function ensureShape(value: Partial<AccountState> | null | undefined): AccountState {
  return {
    users: Array.isArray(value?.users) ? value.users : [],
    sessions: Array.isArray(value?.sessions) ? value.sessions : [],
    ledger: Array.isArray(value?.ledger) ? value.ledger : [],
    generationTasks: Array.isArray(value?.generationTasks) ? value.generationTasks : [],
    history: Array.isArray(value?.history) ? value.history : [],
    tiktokInventory: value?.tiktokInventory && typeof value.tiktokInventory === "object" ? value.tiktokInventory : {}
  };
}

export function createEmptyAccountState(): AccountState {
  return {
    users: [],
    sessions: [],
    ledger: [],
    generationTasks: [],
    history: [],
    tiktokInventory: {}
  };
}

export function toPublicUser(user: AccountUser): PublicAccountUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    credits: user.credits,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export function getPrimaryAdminId(state: AccountState) {
  return state.users[0]?.id || "";
}

export function setUserRole(state: AccountState, input: { actorId: string; userId: string; role: UserRole }) {
  const primaryAdminId = getPrimaryAdminId(state);
  if (!primaryAdminId || input.actorId !== primaryAdminId) {
    throw new AccountError("primary_admin_required", "Only the main account can manage administrators.", 403);
  }
  if (input.userId === primaryAdminId) {
    throw new AccountError("cannot_change_main_account", "The main account role cannot be changed.", 400);
  }
  const user = state.users.find((item) => item.id === input.userId);
  if (!user) throw new AccountError("user_not_found", "User not found.", 404);
  user.role = input.role;
  user.updatedAt = nowIso();
  return { user: toPublicUser(user), users: state.users.map(toPublicUser) };
}

export function deleteAccountUser(state: AccountState, input: { actorId: string; userId: string }) {
  const primaryAdminId = getPrimaryAdminId(state);
  if (!primaryAdminId || input.actorId !== primaryAdminId) {
    throw new AccountError("primary_admin_required", "Only the main account can delete users.", 403);
  }
  if (input.userId === primaryAdminId || input.userId === input.actorId) {
    throw new AccountError("cannot_delete_main_account", "The main account cannot be deleted.", 400);
  }
  const user = state.users.find((item) => item.id === input.userId);
  if (!user) throw new AccountError("user_not_found", "User not found.", 404);

  state.users = state.users.filter((item) => item.id !== input.userId);
  state.sessions = state.sessions.filter((session) => session.userId !== input.userId);
  state.ledger = state.ledger.filter((entry) => entry.userId !== input.userId && entry.adminId !== input.userId);
  state.generationTasks = state.generationTasks.filter((task) => task.userId !== input.userId);
  state.history = state.history.filter((item) => item.userId !== input.userId);
  return { deletedUser: toPublicUser(user), users: state.users.map(toPublicUser) };
}

export function registerAccount(state: AccountState, input: RegisterInput) {
  const email = normalizeEmail(input.email);
  const password = input.password.trim();
  const name = input.name?.trim() || email.split("@")[0] || "Creator";

  if (!email.includes("@")) {
    throw new AccountError("invalid_email", "Email is invalid.");
  }
  if (password.length < 6) {
    throw new AccountError("weak_password", "Password must be at least 6 characters.");
  }
  if (state.users.some((user) => user.email === email)) {
    throw new AccountError("email_exists", "This email has already been registered.", 409);
  }

  const createdAt = nowIso();
  const isFirstUser = state.users.length === 0;
  const user: AccountUser = {
    id: randomUUID(),
    email,
    name,
    passwordHash: hashPassword(password),
    role: isFirstUser ? "admin" : "user",
    credits: isFirstUser ? INITIAL_ADMIN_CREDITS : 0,
    createdAt,
    updatedAt: createdAt
  };
  state.users.push(user);
  return { user: toPublicUser(user) };
}

export function loginAccount(state: AccountState, email: string, password: string) {
  const user = state.users.find((item) => item.email === normalizeEmail(email));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AccountError("invalid_credentials", "Email or password is incorrect.", 401);
  }
  return { user: toPublicUser(user) };
}

export function createSession(state: AccountState, userId: string) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) throw new AccountError("user_not_found", "User not found.", 404);
  const session: AccountSession = {
    token: createSessionToken(),
    userId,
    expiresAt: sessionExpiry(),
    createdAt: nowIso()
  };
  state.sessions.push(session);
  return session;
}

export function deleteSession(state: AccountState, token: string) {
  state.sessions = state.sessions.filter((session) => session.token !== token);
}

export function getUserBySessionToken(state: AccountState, token: string) {
  const now = Date.now();
  state.sessions = state.sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
  const session = state.sessions.find((item) => item.token === token);
  if (!session) return null;
  const user = state.users.find((item) => item.id === session.userId);
  return user ? toPublicUser(user) : null;
}

export function grantCredits(state: AccountState, input: CreditInput) {
  assertPositiveAmount(input.amount);
  if (input.adminId) {
    const admin = state.users.find((user) => user.id === input.adminId);
    if (!admin || admin.role !== "admin") {
      throw new AccountError("admin_required", "Only the main account can allocate credits.", 403);
    }
  }

  const user = state.users.find((item) => item.id === input.userId);
  if (!user) throw new AccountError("user_not_found", "User not found.", 404);
  user.credits += Math.round(input.amount);
  user.updatedAt = nowIso();

  const entry: CreditLedgerEntry = {
    id: randomUUID(),
    userId: user.id,
    adminId: input.adminId,
    amount: Math.round(input.amount),
    balanceAfter: user.credits,
    reason: input.reason,
    createdAt: nowIso(),
    metadata: input.metadata
  };
  state.ledger.unshift(entry);
  return { user: toPublicUser(user), entry };
}

export function debitCredits(state: AccountState, input: CreditInput) {
  assertPositiveAmount(input.amount);
  const user = state.users.find((item) => item.id === input.userId);
  if (!user) throw new AccountError("user_not_found", "User not found.", 404);
  const amount = Math.round(input.amount);
  if (user.credits < amount) {
    throw new AccountError("insufficient_credits", "The account does not have enough credits.", 402);
  }

  user.credits -= amount;
  user.updatedAt = nowIso();
  const entry: CreditLedgerEntry = {
    id: randomUUID(),
    userId: user.id,
    adminId: input.adminId,
    amount: -amount,
    balanceAfter: user.credits,
    reason: input.reason,
    createdAt: nowIso(),
    metadata: input.metadata
  };
  state.ledger.unshift(entry);
  return { user: toPublicUser(user), entry };
}

export function recordGenerationTask(state: AccountState, input: RecordGenerationInput) {
  const existing = state.generationTasks.find((task) => task.id === input.id);
  if (existing) return existing;

  const createdAt = nowIso();
  const task: GenerationTaskRecord = {
    id: input.id,
    userId: input.userId,
    type: input.type,
    model: input.model,
    amount: Math.round(input.amount),
    status: "queued",
    refunded: false,
    createdAt,
    updatedAt: createdAt
  };
  state.generationTasks.unshift(task);
  return task;
}

export function recordGenerationHistory(state: AccountState, input: RecordHistoryInput) {
  const existing = input.taskId
    ? state.history.find((item) => item.userId === input.userId && item.taskId === input.taskId)
    : null;
  const updatedAt = nowIso();

  if (existing) {
    existing.model = input.model || existing.model;
    existing.prompt = input.prompt || existing.prompt;
    existing.previewUrl = input.previewUrl || existing.previewUrl;
    existing.status = input.status || existing.status;
    existing.error = input.error || existing.error;
    existing.updatedAt = updatedAt;
    return existing;
  }

  const record: GenerationHistoryRecord = {
    id: randomUUID(),
    userId: input.userId,
    mode: input.type,
    model: input.model,
    prompt: input.prompt,
    previewUrl: input.previewUrl,
    taskId: input.taskId,
    status: input.status,
    error: input.error,
    createdAt: updatedAt,
    updatedAt
  };
  state.history.unshift(record);
  state.history = state.history.slice(0, 300);
  return record;
}

export function updateHistoryByTaskId(state: AccountState, taskId: string, patch: HistoryPatch) {
  const updated: GenerationHistoryRecord[] = [];
  const updatedAt = nowIso();

  for (const item of state.history) {
    if (item.taskId !== taskId) continue;
    item.previewUrl = patch.previewUrl || item.previewUrl;
    item.status = patch.status || item.status;
    item.error = patch.error || item.error;
    item.updatedAt = updatedAt;
    updated.push(item);
  }

  return updated;
}

export function listHistoryForUser(state: AccountState, userId: string, limit = 60) {
  return state.history.filter((item) => item.userId === userId).slice(0, limit);
}

export function clearHistoryForUser(state: AccountState, userId: string) {
  state.history = state.history.filter((item) => item.userId !== userId);
}

export function settleGenerationTask(state: AccountState, taskId: string, status: string) {
  const task = state.generationTasks.find((item) => item.id === taskId);
  if (!task) return null;

  const normalized = status.toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(normalized)) {
    task.status = "completed";
    task.updatedAt = nowIso();
    updateHistoryByTaskId(state, taskId, { status: "completed" });
    return task;
  }

  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
    task.status = "failed";
    task.updatedAt = nowIso();
    updateHistoryByTaskId(state, taskId, { status: "failed" });
    if (!task.refunded) {
      grantCredits(state, {
        userId: task.userId,
        amount: task.amount,
        reason: `${task.type} generation failed refund`,
        metadata: { taskId: task.id, model: task.model }
      });
      task.refunded = true;
    }
  }
  return task;
}

export function parseSessionCookie(cookieHeader: string | null) {
  if (!cookieHeader) return "";
  const cookies = cookieHeader.split(";").map((item) => item.trim());
  const match = cookies.find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : "";
}

export function sessionCookieHeader(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    SESSION_DAYS * 24 * 60 * 60
  }`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function readAccountState(forceReload = false) {
  if (!forceReload && globalForAccounts.siyuAccountState) return globalForAccounts.siyuAccountState;

  const githubState = await readGithubAccountState();
  if (githubState) {
    globalForAccounts.siyuAccountState = githubState;
    return globalForAccounts.siyuAccountState;
  }

  try {
    const text = await readFile(dataFilePath(), "utf8");
    globalForAccounts.siyuAccountState = ensureShape(JSON.parse(text) as Partial<AccountState>);
  } catch {
    globalForAccounts.siyuAccountState = createEmptyAccountState();
  }
  return globalForAccounts.siyuAccountState;
}

async function writeAccountState(state: AccountState) {
  const file = dataFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2));
  await writeGithubAccountState(state);
}

export async function withAccountState<T>(mutator: (state: AccountState) => T | Promise<T>) {
  const previousWrite = globalForAccounts.siyuAccountWrite ?? Promise.resolve();
  let resolveNext: (value: unknown) => void;
  let rejectNext: (reason?: unknown) => void;
  globalForAccounts.siyuAccountWrite = new Promise((resolve, reject) => {
    resolveNext = resolve;
    rejectNext = reject;
  });

  await previousWrite.catch(() => undefined);
  try {
    let result: T | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await readAccountState(attempt > 0);
      try {
        result = await mutator(state);
        await writeAccountState(state);
        resolveNext!(result);
        return result;
      } catch (error) {
        lastError = error;
        if (!isRetryableAccountWriteError(error) || attempt >= 2) throw error;
        globalForAccounts.siyuAccountState = undefined;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  } catch (error) {
    rejectNext!(error);
    throw error;
  }
}

export async function requireUser(request: Request) {
  const token = parseSessionCookie(request.headers.get("cookie"));
  if (!token) {
    throw new AccountError("auth_required", "Please log in before generating.", 401);
  }

  const user = await withAccountState((state) => getUserBySessionToken(state, token));
  if (!user) {
    throw new AccountError("auth_required", "Session expired. Please log in again.", 401);
  }
  return user;
}

export async function chargeUserCredits(
  request: Request,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>
) {
  const token = parseSessionCookie(request.headers.get("cookie"));
  if (!token) throw new AccountError("auth_required", "Please log in before generating.", 401);

  return withAccountState((state) => {
    const user = getUserBySessionToken(state, token);
    if (!user) throw new AccountError("auth_required", "Session expired. Please log in again.", 401);
    return debitCredits(state, { userId: user.id, amount, reason, metadata });
  });
}

export async function refundCreditsForUser(
  userId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>
) {
  return withAccountState((state) => grantCredits(state, { userId, amount, reason, metadata }));
}
