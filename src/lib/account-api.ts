import { AccountError } from "@/lib/accounts";

export function accountErrorResponse(error: unknown) {
  if (error instanceof AccountError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  return Response.json(
    {
      error: "account_request_failed",
      message: error instanceof Error ? error.message : "Account request failed."
    },
    { status: 500 }
  );
}
