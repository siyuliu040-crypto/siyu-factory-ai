import {
  HELLOBABYGO_BASE_URL,
  authHeaders,
  jsonError,
  parseUpstreamResponse
} from "@/lib/hellobabygo";
import { settleGenerationTask, updateHistoryByTaskId, withAccountState } from "@/lib/accounts";
import {
  extractVideoUrl,
  normalizeVideoStatusPayload,
  type NormalizedVideoStatus
} from "@/lib/video-status";

export const dynamic = "force-dynamic";

async function fetchVideoStatus(path: string, id: string) {
  const response = await fetch(
    `${HELLOBABYGO_BASE_URL}${path.replace(":id", encodeURIComponent(id))}`,
    {
      method: "GET",
      headers: authHeaders({ Accept: "application/json" }),
      cache: "no-store"
    }
  );
  return {
    response,
    data: await parseUpstreamResponse(response)
  };
}

async function settleNormalizedStatus(id: string, normalized: NormalizedVideoStatus) {
  const status = normalized.payload.status;
  const previewUrl = extractVideoUrl(normalized.payload);

  await withAccountState((state) => {
    settleGenerationTask(state, id, status);
    if (previewUrl || status) {
      updateHistoryByTaskId(state, id, { status, previewUrl });
    }
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let requestedId = "";
  try {
    const { id } = await params;
    requestedId = id;
    if (!id) {
      return jsonError({ error: "video id is required" }, 400);
    }

    const primary = await fetchVideoStatus("/v1/videos/:id", id);
    let normalized = normalizeVideoStatusPayload(id, primary.data, primary.response.status);

    if (normalized.transient) {
      const legacy = await fetchVideoStatus("/v1/video/generations/:id", id);
      const legacyNormalized = normalizeVideoStatusPayload(id, legacy.data, legacy.response.status);
      if (!legacyNormalized.transient) normalized = legacyNormalized;
    }

    if (!normalized.transient) {
      await settleNormalizedStatus(id, normalized);
    }
    return Response.json(normalized.payload, { status: normalized.statusCode });
  } catch (error) {
    const detail = error instanceof Error ? error.message : error;
    if (requestedId) {
      const normalized = normalizeVideoStatusPayload(requestedId, { detail }, 202);
      return Response.json(normalized.payload, { status: normalized.statusCode });
    }
    return jsonError({
      error: "Video status request failed",
      detail
    });
  }
}
