import {
  HELLOBABYGO_BASE_URL,
  authHeaders,
  jsonError,
  parseUpstreamResponse
} from "@/lib/hellobabygo";
import { hfsyHeaders, HFSY_BASE_URL, isHfsyModel, parseHfsyResponse } from "@/lib/hfsy";
import { settleGenerationTask, updateHistoryByTaskId, withAccountState } from "@/lib/accounts";
import { isViduModel, normalizeViduStatus, parseViduResponse, VIDU_BASE_URL, viduHeaders } from "@/lib/vidu";
import {
  getSyCredentials,
  isSyModel,
  normalizeSyStatusPayload,
  parseSyResponse,
  SY_BASE_URL
} from "@/lib/sy";
import {
  extractVideoUrl,
  normalizeVideoStatusPayload,
  type NormalizedVideoStatus
} from "@/lib/video-status";

export const dynamic = "force-dynamic";

const HFSY_STUCK_TIMEOUT_MS = Number(process.env.HFSY_STUCK_TIMEOUT_MS || 30 * 60 * 1000);

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

async function fetchHfsyVideoStatus(path: string, id: string) {
  const resolvedPath = path.includes(":id")
    ? path.replace(":id", encodeURIComponent(id))
    : `${path}${path.includes("?") ? "&" : "?"}id=${encodeURIComponent(id)}`;
  const response = await fetch(
    `${HFSY_BASE_URL}${resolvedPath}`,
    {
      method: "GET",
      headers: hfsyHeaders({ Accept: "application/json" }),
      cache: "no-store"
    }
  );
  return {
    response,
    data: await parseHfsyResponse(response)
  };
}

async function fetchViduVideoStatus(id: string) {
  const response = await fetch(`${VIDU_BASE_URL}/ent/v2/tasks/${encodeURIComponent(id)}/creations`, {
    method: "GET",
    headers: viduHeaders({ Accept: "application/json" }),
    cache: "no-store"
  });
  return {
    response,
    data: await parseViduResponse(response)
  };
}

async function fetchSyVideoStatus(id: string) {
  const credentials = getSyCredentials();
  const body = new URLSearchParams({
    username: credentials.username,
    userpwd: credentials.userpwd,
    cardNo: credentials.cardNo,
    task_id: id
  });
  const response = await fetch(`${SY_BASE_URL}/dm/ai_api.php?action=query`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store"
  });
  return {
    response,
    data: await parseSyResponse(response)
  };
}

async function settleNormalizedStatus(id: string, normalized: NormalizedVideoStatus) {
  const status = normalized.payload.status;
  const previewUrl = extractVideoUrl(normalized.payload);
  const error = normalized.payload.error ? JSON.stringify(normalized.payload.error) : undefined;

  await withAccountState((state) => {
    settleGenerationTask(state, id, status);
    if (previewUrl || status) {
      updateHistoryByTaskId(state, id, { status, previewUrl, error });
    }
  });
}

function isPendingVideoStatus(status: string) {
  return status === "queued" || status === "in_progress";
}

function isStuckHfsyTask(task: { createdAt: string; model: string }, normalized: NormalizedVideoStatus) {
  if (!isPendingVideoStatus(normalized.payload.status)) return false;
  if (!task.model.toLowerCase().startsWith("hfsy:")) return false;
  const createdAt = Date.parse(task.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt >= HFSY_STUCK_TIMEOUT_MS;
}

async function settleStuckHfsyTask(id: string, task: { model: string }) {
  const error =
    "HFSY 上游任务长时间停留在生成中，系统已判定为卡住并自动退回本次站内积分。请换用其他可用模型重新提交。";

  await withAccountState((state) => {
    settleGenerationTask(state, id, "failed");
    updateHistoryByTaskId(state, id, {
      status: "failed",
      error
    });
  });

  return {
    id,
    task_id: id,
    status: "failed",
    progress: 100,
    provider: "hfsy",
    model: task.model,
    error,
    message: error,
    stuck_timeout_ms: HFSY_STUCK_TIMEOUT_MS
  };
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

    const task = await withAccountState((state) => state.generationTasks.find((item) => item.id === id) || null);
    if (task && isViduModel(task.model)) {
      const vidu = await fetchViduVideoStatus(id);
      const payload = normalizeViduStatus(id, vidu.data, vidu.response.status);
      await withAccountState((state) => {
        settleGenerationTask(state, id, payload.status);
        if (payload.video_url || payload.status) {
          updateHistoryByTaskId(state, id, {
            status: payload.status,
            previewUrl: payload.video_url,
            error: payload.error ? JSON.stringify(payload.error) : undefined
          });
        }
      });
      const statusCode = payload.status === "queued" || payload.status === "in_progress" ? 202 : vidu.response.status;
      return Response.json(payload, { status: statusCode });
    }

    if (task && isSyModel(task.model)) {
      const sy = await fetchSyVideoStatus(id);
      const payload = normalizeSyStatusPayload(id, sy.data, sy.response.status);
      await withAccountState((state) => {
        settleGenerationTask(state, id, payload.status);
        if (payload.video_url || payload.status) {
          updateHistoryByTaskId(state, id, {
            status: payload.status,
            previewUrl: payload.video_url,
            error: payload.error ? String(payload.error) : undefined
          });
        }
      });
      const statusCode = payload.status === "queued" || payload.status === "in_progress" ? 202 : sy.response.status;
      return Response.json(payload, { status: statusCode });
    }

    if (task && isHfsyModel(task.model)) {
      const primary = await fetchHfsyVideoStatus("/v1/video/query", id);
      let normalized = normalizeVideoStatusPayload(id, primary.data, primary.response.status);

      if (normalized.transient) {
        const legacy = await fetchHfsyVideoStatus("/pg/videos/async-generations/:id", id);
        const legacyNormalized = normalizeVideoStatusPayload(id, legacy.data, legacy.response.status);
        if (!legacyNormalized.transient) normalized = legacyNormalized;
      }

      if (normalized.transient) {
        const legacy = await fetchHfsyVideoStatus("/v1/videos/:id", id);
        const legacyNormalized = normalizeVideoStatusPayload(id, legacy.data, legacy.response.status);
        if (!legacyNormalized.transient) normalized = legacyNormalized;
      }

      if (isStuckHfsyTask(task, normalized)) {
        const payload = await settleStuckHfsyTask(id, task);
        return Response.json(payload);
      }

      if (!normalized.transient) {
        await settleNormalizedStatus(id, normalized);
      }
      return Response.json(
        { ...normalized.payload, provider: "hfsy" },
        { status: normalized.statusCode }
      );
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
