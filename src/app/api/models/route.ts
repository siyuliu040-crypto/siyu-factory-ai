import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";
import { HFSY_IMAGE_MODELS, HFSY_MODELS } from "@/lib/hfsy";
import { SY_MODELS } from "@/lib/sy";
import { VIDU_MODELS } from "@/lib/vidu";

export const dynamic = "force-dynamic";

const CUSTOM_VIDEO_MODELS = [
  "grok-imagine-1.0-video-ref-6s",
  "grok-imagine-1.0-video-ref-10s"
];

const VERIFIED_PORTRAIT_VIDEO_MODELS = new Set<string>([
  "veo_3_1-fast-portrait-fl-hd",
  "sora-2-4s-9x16",
  "sora-2-8s-9x16"
]);

const HBG_VERIFIED_VIDEO_MODELS = [
  { id: "veo_3_1-fast-portrait-fl-hd", name: "HBG VEO 3.1 Fast 首尾帧 HD" }
];

function isAllowedModel(model: unknown) {
  if (!model || typeof model !== "object") return true;
  const id = String((model as { id?: unknown }).id || "").toLowerCase();
  if (!id) return true;
  if (id.includes("16x9") || id.includes("landscape")) return false;
  if (id.includes("sora") || id.includes("veo_3_1-fast") || id.includes("firefly-veo31-fast")) {
    return VERIFIED_PORTRAIT_VIDEO_MODELS.has(id);
  }
  if (id.includes("firefly-veo31-ref")) return false;
  if (id === "grok-imagine-video") return false;
  if (id === "grok-imagine-1.0-video") return false;
  return true;
}

function isVideoModelId(id: string) {
  const lower = id.toLowerCase();
  return (
    lower.includes("video") ||
    lower.includes("veo") ||
    lower.includes("sora") ||
    lower.includes("grok-imagine")
  );
}

function isImageModelId(id: string) {
  const lower = id.toLowerCase();
  return (
    lower.includes("image") ||
    lower.includes("banana") ||
    lower.includes("dall") ||
    lower.includes("flux") ||
    lower.includes("midjourney") ||
    lower.includes("stable-diffusion") ||
    lower.includes("sdxl")
  );
}

function normalizeUpstreamModel(model: unknown) {
  if (!model || typeof model !== "object") return model;
  const record = model as Record<string, unknown>;
  const id = String(record.id || "");
  if (!isVideoModelId(id)) return model;
  return {
    ...record,
    supported_endpoint_types: ["openai-video"]
  };
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
      const filtered = ((data as { data: unknown[] }).data)
        .filter(isAllowedModel)
        .filter((model) => !isImageModelId(String((model as { id?: unknown })?.id || "")))
        .map(normalizeUpstreamModel);
      const liveIds = new Set(filtered.map((item) => String((item as { id?: unknown })?.id || "")));
      const hbgVideoModels = HBG_VERIFIED_VIDEO_MODELS
        .filter((model) => !liveIds.has(model.id))
        .map((model) => ({
          id: model.id,
          object: "model",
          owned_by: "hellobabygo",
          supported_endpoint_types: ["openai-video"],
          name: model.name
        }));
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
      const hfsyImageModels = process.env.HFSY_API_KEY
        ? HFSY_IMAGE_MODELS.map((model) => ({
            id: model.id,
            object: "model",
            owned_by: "hfsy",
            supported_endpoint_types: model.endpoint === "gemini" ? ["gemini", "openai"] : ["image-generation"],
            name: model.label
          }))
        : [];
      return Response.json(
        {
          ...(data as Record<string, unknown>),
          data: [...syModels, ...hfsyModels, ...hfsyImageModels, ...hbgVideoModels, ...viduModels, ...customVideoModels, ...filtered]
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
