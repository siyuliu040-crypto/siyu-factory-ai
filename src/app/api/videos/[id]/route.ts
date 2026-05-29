import {
  HELLOBABYGO_BASE_URL,
  authHeaders,
  jsonError,
  parseUpstreamResponse
} from "@/lib/hellobabygo";

export const dynamic = "force-dynamic";

function isTransientVideoStatus(payload: unknown) {
  const message = typeof payload === "string" ? payload : JSON.stringify(payload);
  return (
    message.includes("fail_to_fetch_task") ||
    message.includes("Internal Server Error") ||
    message.includes("Not Found") ||
    message.includes("\"detail\":\"Not Found\"")
  );
}

function pendingVideoResponse(id: string, upstream: unknown, upstreamStatus?: number) {
  return Response.json(
    {
      id,
      task_id: id,
      status: "queued",
      progress: 0,
      transient: true,
      upstream_status: upstreamStatus,
      message: "The upstream provider has not exposed this task status yet. Retrying is safe.",
      upstream
    },
    { status: 202 }
  );
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

    const response = await fetch(
      `${HELLOBABYGO_BASE_URL}/v1/videos/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: authHeaders({ Accept: "application/json" }),
        cache: "no-store"
      }
    );
    const data = await parseUpstreamResponse(response);

    if (isTransientVideoStatus(data)) {
      return pendingVideoResponse(id, data, response.status);
    }
    return Response.json(data, { status: response.status });
  } catch (error) {
    const detail = error instanceof Error ? error.message : error;
    if (requestedId) {
      return pendingVideoResponse(requestedId, { detail });
    }
    return jsonError({
      error: "Video status request failed",
      detail
    });
  }
}
