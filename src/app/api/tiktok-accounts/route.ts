import {
  AccountError,
  getUserBySessionToken,
  parseSessionCookie,
  requireUser,
  type TiktokInventoryRow,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";
import { jsonError } from "@/lib/hellobabygo";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

const ALLOWED_CATEGORIES = new Set(["full-moon", "custom-followers", "showcase"]);
const MAX_ROWS = 200;
const MAX_CELL_LENGTH = 1200;
const MAX_IMAGE_LENGTH = 260000;

function cleanCell(value: unknown, fallback = "") {
  return String(value ?? fallback).slice(0, MAX_CELL_LENGTH);
}

function normalizeRows(rows: unknown): TiktokInventoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_ROWS).map((row) => {
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const imageUrl = cleanCell(record.imageUrl);
    return {
      id: cleanCell(record.id, randomUUID()) || randomUUID(),
      imageUrl: imageUrl.slice(0, MAX_IMAGE_LENGTH),
      account: cleanCell(record.account),
      price: cleanCell(record.price),
      followers: cleanCell(record.followers),
      twoFa: cleanCell(record.twoFa),
      email: cleanCell(record.email),
      status: cleanCell(record.status),
      notes: cleanCell(record.notes),
      updatedAt: new Date().toISOString()
    };
  });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const data = await withAccountState((state) => ({
      inventory: state.tiktokInventory,
      canEdit: user.role === "admin"
    }));
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({ error: "Unable to load TikTok inventory", detail: error instanceof Error ? error.message : error });
  }
}

export async function PATCH(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    if (!token) throw new AccountError("auth_required", "Please log in first.", 401);

    const body = (await request.json()) as { category?: string; rows?: unknown };
    const category = String(body.category || "");
    if (!ALLOWED_CATEGORIES.has(category)) {
      return jsonError({ error: "invalid_tiktok_category" }, 400);
    }

    const result = await withAccountState((state) => {
      const actor = getUserBySessionToken(state, token);
      if (!actor) throw new AccountError("auth_required", "Session expired. Please log in again.", 401);
      if (actor.role !== "admin") throw new AccountError("admin_required", "Only admins can edit TikTok inventory.", 403);
      state.tiktokInventory[category] = normalizeRows(body.rows);
      return { inventory: state.tiktokInventory, canEdit: true };
    });

    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({ error: "Unable to save TikTok inventory", detail: error instanceof Error ? error.message : error });
  }
}
