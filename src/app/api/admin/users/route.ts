import {
  AccountError,
  deleteAccountUser,
  getUserBySessionToken,
  parseSessionCookie,
  setUserRole,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    if (!token) throw new AccountError("auth_required", "Please log in first.", 401);

    const body = (await request.json()) as { userId?: string; role?: "admin" | "user" };
    const result = await withAccountState((state) => {
      const actor = getUserBySessionToken(state, token);
      if (!actor) throw new AccountError("auth_required", "Session expired. Please log in again.", 401);
      return setUserRole(state, {
        actorId: actor.id,
        userId: body.userId || "",
        role: body.role === "admin" ? "admin" : "user"
      });
    });

    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return accountErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    if (!token) throw new AccountError("auth_required", "Please log in first.", 401);

    const body = (await request.json()) as { userId?: string };
    const result = await withAccountState((state) => {
      const actor = getUserBySessionToken(state, token);
      if (!actor) throw new AccountError("auth_required", "Session expired. Please log in again.", 401);
      return deleteAccountUser(state, {
        actorId: actor.id,
        userId: body.userId || ""
      });
    });

    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
