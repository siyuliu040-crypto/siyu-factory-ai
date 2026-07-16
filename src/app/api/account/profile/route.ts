import {
  AccountError,
  getUserBySessionToken,
  parseSessionCookie,
  updateAccountName,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    if (!token) throw new AccountError("auth_required", "Please log in first.", 401);

    const body = (await request.json()) as { name?: string };
    const result = await withAccountState((state) => {
      const user = getUserBySessionToken(state, token);
      if (!user) throw new AccountError("auth_required", "Session expired. Please log in again.", 401);
      return updateAccountName(state, { userId: user.id, name: String(body.name || "") });
    });

    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
