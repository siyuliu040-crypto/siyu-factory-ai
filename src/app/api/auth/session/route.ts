import {
  getUserBySessionToken,
  getAccountStorageInfo,
  getPrimaryAdminId,
  parseSessionCookie,
  readAccountState,
  toPublicUser,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    const user = token
      ? await withAccountState((state) => getUserBySessionToken(state, token))
      : null;
    const state = await readAccountState();
    const isAdmin = user?.role === "admin";
    const users = isAdmin ? state.users.map(toPublicUser) : undefined;
    const ledger = user?.role === "admin"
      ? state.ledger.slice(0, 60)
      : state.ledger.filter((entry) => entry.userId === user?.id).slice(0, 30);

    return Response.json(
      {
        authenticated: Boolean(user),
        user,
        users,
        adminId: isAdmin ? getPrimaryAdminId(state) : undefined,
        ledger,
        storage: getAccountStorageInfo()
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
