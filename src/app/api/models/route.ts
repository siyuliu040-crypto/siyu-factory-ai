import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";
import { HFSY_MODELS } from "@/lib/hfsy";
import { SY_MODELS } from "@/lib/sy";
import { VIDU_MODELS } from "@/lib/vidu";

export const dynamic = "force-dynamic";

const CUSTOM_VIDEO_MODELS = [
  "grok-imagine-1.0-video-ref-6s",
  "grok-imagine-1.0-video-ref-10s"
];

const VERIFIED_PORTRAIT_VIDEO_MODELS = new Set<string>([
]);

function isAllowedModel(model: unknown) {
  if (!model || typeof model !== "object") return true;
  const id = String((model as { id?: unknown }).id || "").toLowerCase();
  if (!id) return true;
  if (id.includes("16x9") || id.includes("landscape")) return false;
  if (id.includes("sora") || id.includes("veo_3_1-fast-portrait") || id.includes("firefly-veo31-fast")) {
    return VERIFIED_PORTRAIT_VIDEO_MODELS.has(id);
  }
  if (id.includes("firefly-veo31-ref")) return false;
  if (id === "grok-imagine-video") return false;
  if (id === "grok-imagine-1.0-video") return false;
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
      const customVideoModels = CUSTOM_VIDEO_MODELS.map((id) => ({
        id,
        object: "model",
        owned_by: "custom",
        supported_endpoint_types: ["openai-video"]
      }));
      const syModels = SY_MODELS.map((model) => ({
        id: model.id,
        object: "model",
        owned_by: "sy",
        supported_endpoint_types: ["openai-video"],
        name: model.label
      }));
      const hfsyModels = process.env.HFSY_API_KEY
        ? HFSY_MODELS.map((model) => ({
            id: model.id,
            object: "model",
            owned_by: "hfsy",
            supported_endpoint_types: ["openai-video"],
            name: model.label
          }))
        : [];
      return Response.json(
        {
          ...(data as Record<string, unknown>),
          data: [...syModels, ...hfsyModels, ...viduModels, ...customVideoModels, ...filtered]
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
