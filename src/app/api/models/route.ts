import { forwardJson, jsonError } from "@/lib/hellobabygo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await forwardJson("/v1/models", { method: "GET" });
  } catch (error) {
    return jsonError({
      error: "Unable to load model list",
      detail: error instanceof Error ? error.message : error
    });
  }
}
