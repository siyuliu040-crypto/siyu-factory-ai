import {
  clearSessionCookieHeader,
  deleteSession,
  parseSessionCookie,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    if (token) {
      await withAccountState((state) => deleteSession(state, token));
    }
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": clearSessionCookieHeader()
        }
      }
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
