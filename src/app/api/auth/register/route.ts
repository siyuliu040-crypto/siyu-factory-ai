import {
  createSession,
  registerAccount,
  sessionCookieHeader,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; name?: string; password?: string };
    const result = await withAccountState((state) => {
      const created = registerAccount(state, {
        email: body.email || "",
        name: body.name,
        password: body.password || ""
      });
      const session = createSession(state, created.user.id);
      return { user: created.user, token: session.token };
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
