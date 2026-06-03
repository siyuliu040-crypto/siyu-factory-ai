import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";
import { VIDU_MODELS } from "@/lib/vidu";

export const dynamic = "force-dynamic";

function isAllowedModel(model: unknown) {
  if (!model || typeof model !== "object") return true;
  const id = String((model as { id?: unknown }).id || "").toLowerCase();
  if (!id) return true;
  if (id.includes("sora")) return false;
  if (id.includes("16x9") || id.includes("landscape")) return false;
  if (id.includes("firefly-veo31-ref")) return false;
  if (id.includes("veo_3_1-fast-portrait")) return false;
  if (id.includes("veo_3_1-fast-portrait-hd") || id.includes("veo_3_1-fast-portrait-fl-hd")) return false;
  if (id === "grok-imagine-video") return false;
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
      const filtered = ((data as { data: unknown[] }).data).filter(isAllowedModel);
      const liveIds = new Set(filtered.map((item) => String((item as { id?: unknown })?.id || "")));
      const viduModels = VIDU_MODELS
        .filter((id) => !liveIds.has(id))
        .map((id) => ({
          id,
          object: "model",
          owned_by: "vidu",
          supported_endpoint_types: ["openai-video"]
        }));
      return Response.json(
        {
          ...(data as Record<string, unknown>),
          data: [...viduModels, ...filtered]
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
