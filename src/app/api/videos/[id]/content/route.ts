import { HELLOBABYGO_BASE_URL, authHeaders, jsonError, parseUpstreamResponse } from "@/lib/hellobabygo";
import { withAccountState } from "@/lib/accounts";
import { extractVideoUrl } from "@/lib/video-status";
import { hfsyHeaders, HFSY_BASE_URL, isHfsyModel, parseHfsyResponse } from "@/lib/hfsy";
import { extractSyVideoUrl, getSyCredentials, isSyModel, parseSyResponse, SY_BASE_URL } from "@/lib/sy";
import { extractViduVideoUrl, isViduModel, parseViduResponse, VIDU_BASE_URL, viduHeaders } from "@/lib/vidu";

export const dynamic = "force-dynamic";

async function fetchVideoMetadata(path: string, id: string) {
  const response = await fetch(`${HELLOBABYGO_BASE_URL}${path.replace(":id", encodeURIComponent(id))}`, {
    headers: authHeaders({ Accept: "application/json" }),
    cache: "no-store"
  });
  return parseUpstreamResponse(response);
}

async function fetchViduVideoMetadata(id: string) {
  const response = await fetch(`${VIDU_BASE_URL}/ent/v2/tasks/${encodeURIComponent(id)}/creations`, {
    headers: viduHeaders({ Accept: "application/json" }),
    cache: "no-store"
  });
  return parseViduResponse(response);
}

async function fetchHfsyVideoMetadata(path: string, id: string) {
  const resolvedPath = path.includes(":id")
    ? path.replace(":id", encodeURIComponent(id))
    : `${path}${path.includes("?") ? "&" : "?"}id=${encodeURIComponent(id)}`;
  const response = await fetch(`${HFSY_BASE_URL}${resolvedPath}`, {
    headers: hfsyHeaders({ Accept: "application/json" }),
    cache: "no-store"
  });
  return parseHfsyResponse(response);
}

async function fetchSyVideoMetadata(id: string) {
  const credentials = getSyCredentials();
  const body = new URLSearchParams({
    username: credentials.username,
    userpwd: credentials.userpwd,
    cardNo: credentials.cardNo,
    task_id: id
  });
  const response = await fetch(`${SY_BASE_URL}/dm/ai_api.php?action=query`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store"
  });
  return parseSyResponse(response);
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

    const task = await withAccountState((state) => state.generationTasks.find((item) => item.id === id) || null);
    if (task && isViduModel(task.model)) {
      const viduMetadata = await fetchViduVideoMetadata(id);
      const viduUrl = extractViduVideoUrl(viduMetadata);
      if (viduUrl) return streamRemoteVideo(viduUrl, id);
      return jsonError({ error: "Unable to download generated Vidu video" }, 404);
    }

    if (task && isSyModel(task.model)) {
      const syMetadata = await fetchSyVideoMetadata(id);
      const syUrl = extractSyVideoUrl(syMetadata);
      if (syUrl) return streamRemoteVideo(syUrl, id);
      return jsonError({ error: "Unable to download generated SY video" }, 404);
    }

    if (task && isHfsyModel(task.model)) {
      const primaryMetadata = await fetchHfsyVideoMetadata("/v1/video/query", id);
      const primaryUrl = extractVideoUrl(primaryMetadata);
      if (primaryUrl) return streamRemoteVideo(primaryUrl, id);

      const legacyMetadata = await fetchHfsyVideoMetadata("/pg/videos/async-generations/:id", id);
      const legacyUrl = extractVideoUrl(legacyMetadata);
      if (legacyUrl) return streamRemoteVideo(legacyUrl, id);

      const videosMetadata = await fetchHfsyVideoMetadata("/v1/videos/:id", id);
      const videosUrl = extractVideoUrl(videosMetadata);
      if (videosUrl) return streamRemoteVideo(videosUrl, id);

      return jsonError({ error: "Unable to download generated HFSY video" }, 404);
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
        "Content-Disposition": `attachment; filename="${id}.mp4"`
      }
    });
  } catch (error) {
    return jsonError({
      error: "Video content request failed",
      detail: error instanceof Error ? error.message : error
    });
  }
}
