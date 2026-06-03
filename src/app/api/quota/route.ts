import { forwardJson, getApiKey, jsonError } from "@/lib/hellobabygo";
import { AccountError, requireUser } from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

type Probe = {
  path: string;
  label: string;
};

const probes: Probe[] = [
  { path: "/api/usage/token", label: "console_usage_token" },
  { path: "/api/token/usage", label: "console_token_usage" },
  { path: "/api/user/self", label: "console_user_self" },
  { path: "/api/user/token", label: "console_user_token" },
  { path: "/api/v1/user", label: "api_v1_user" },
  { path: "/api/v3/user", label: "api_v3_user" },
  { path: "/api/v4/user", label: "api_v4_user" }
];

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.role !== "admin") {
      throw new AccountError("admin_required", "Only the main account can view upstream quota.", 403);
    }
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({ error: "Unable to verify account", detail: error instanceof Error ? error.message : error }, 500);
  }

  const attempts = [];

  for (const probe of probes) {
    try {
      const response = await forwardJson(probe.path, { method: "GET" });
      const payload = await response.json();
      attempts.push({ ...probe, status: response.status, payload });

      if (response.ok && payload?.success !== false) {
        return Response.json({
          connected: true,
          source: probe.label,
          data: payload
        });
      }
    } catch (error) {
      attempts.push({
        ...probe,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  try {
    getApiKey();
    return Response.json({
      connected: true,
      source: "api_key",
      data: null,
      message:
        "API key is valid for OpenAI-compatible endpoints, but this gateway did not expose quota through API-key auth.",
      attempts
    });
  } catch (error) {
    return jsonError(
      {
        error: "HELLOBABYGO_API_KEY is not configured",
        detail: error instanceof Error ? error.message : error
      },
      500
    );
  }
}
