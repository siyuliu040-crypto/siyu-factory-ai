import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";
import { extractVideoUrl } from "@/lib/video-status";

export const dynamic = "force-dynamic";

async function fetchVideoMetadata(path: string, id: string) {
  const response = await fetch(`${HELLOBABYGO_BASE_URL}${path.replace(":id", encodeURIComponent(id))}`, {
    headers: authHeaders({ Accept: "application/json" }),
    cache: "no-store"
  });
  return parseUpstreamResponse(response);
}

async function streamRemoteVideo(url: string, id: string) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok || !response.body) return Response.redirect(url, 302);
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "video/mp4",
        "Content-Disposition": `attachment; filename="${id}.mp4"`
      }
    });
  } catch {
    return Response.redirect(url, 302);
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return jsonError({ error: "video id is required" }, 400);
    }

    const primaryMetadata = await fetchVideoMetadata("/v1/videos/:id", id);
    const primaryUrl = extractVideoUrl(primaryMetadata);
    if (primaryUrl) return streamRemoteVideo(primaryUrl, id);

    const legacyMetadata = await fetchVideoMetadata("/v1/video/generations/:id", id);
    const legacyUrl = extractVideoUrl(legacyMetadata);
    if (legacyUrl) return streamRemoteVideo(legacyUrl, id);

    const response = await fetch(
      `${HELLOBABYGO_BASE_URL}/v1/videos/${encodeURIComponent(id)}/content`,
      {
        headers: authHeaders(),
        cache: "no-store"
      }
    );

    if (!response.ok) {
      return jsonError(
        { error: "Unable to download generated video", status: response.status },
        response.status
      );
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "video/mp4",
        "Content-Disposition": `inline; filename="${id}.mp4"`
      }
    });
  } catch (error) {
    return jsonError({
      error: "Video content request failed",
      detail: error instanceof Error ? error.message : error
    });
  }
}
