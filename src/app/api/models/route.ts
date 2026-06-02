import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";

export const dynamic = "force-dynamic";

function isAllowedModel(model: unknown) {
  if (!model || typeof model !== "object") return true;
  const id = String((model as { id?: unknown }).id || "").toLowerCase();
  if (!id) return true;
  if (id.includes("sora")) return false;
  if (id.includes("16x9") || id.includes("landscape")) return false;
  if (id.includes("veo_3_1-fast-portrait-hd") || id.includes("veo_3_1-fast-portrait-fl-hd")) return false;
  return true;
}

export async function GET() {
  try {
    const response = await fetch(`${HELLOBABYGO_BASE_URL}/v1/models`, {
      method: "GET",
      headers: authHeaders({ Accept: "application/json" }),
      cache: "no-store"
    });
    const data = await parseUpstreamResponse(response);
    if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
      return Response.json(
        {
          ...(data as Record<string, unknown>),
          data: ((data as { data: unknown[] }).data).filter(isAllowedModel)
        },
        { status: response.status }
      );
    }
    return Response.json(data, { status: response.status });
  } catch (error) {
    return jsonError({
      error: "Unable to load model list",
      detail: error instanceof Error ? error.message : error
    });
  }
}
