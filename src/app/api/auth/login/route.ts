import {
  createSession,
  loginAccount,
  sessionCookieHeader,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const result = await withAccountState((state) => {
      const login = loginAccount(state, body.email || "", body.password || "");
      const session = createSession(state, login.user.id);
      return { user: login.user, token: session.token };
    });

    return Response.json(
      { user: result.user },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookieHeader(result.token)
        }
      }
    );
  } catch (error) {
    return accountErrorResponse(error);
  }
}
