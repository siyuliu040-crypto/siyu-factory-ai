import {
  AccountError,
  getUserBySessionToken,
  grantCredits,
  parseSessionCookie,
  toPublicUser,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    if (!token) throw new AccountError("auth_required", "Please log in first.", 401);

    const body = (await request.json()) as { userId?: string; amount?: number; reason?: string };
    const result = await withAccountState((state) => {
      const admin = getUserBySessionToken(state, token);
      if (!admin || admin.role !== "admin") {
        throw new AccountError("admin_required", "Only the main account can allocate credits.", 403);
      }
      const grant = grantCredits(state, {
        adminId: admin.id,
        userId: body.userId || "",
        amount: Number(body.amount || 0),
        reason: body.reason?.trim() || "admin allocation"
      });
      return {
        user: grant.user,
        entry: grant.entry,
        users: state.users.map(toPublicUser)
      };
    });

    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
