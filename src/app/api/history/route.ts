import {
  AccountError,
  clearHistoryForUser,
  listHistoryForUser,
  recordGenerationHistory,
  requireUser,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";
import { jsonError } from "@/lib/hellobabygo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const history = await withAccountState((state) => listHistoryForUser(state, user.id));
    return Response.json({ history }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({ error: "Unable to load history", detail: error instanceof Error ? error.message : error });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as {
      mode?: "image" | "video";
      model?: string;
      prompt?: string;
      previewUrl?: string;
      videoId?: string;
      status?: string;
    };

    if (body.mode !== "image" && body.mode !== "video") {
      return jsonError({ error: "history mode must be image or video" }, 400);
    }
    if (!body.model || !body.prompt) {
      return jsonError({ error: "history model and prompt are required" }, 400);
    }

    const record = await withAccountState((state) =>
      recordGenerationHistory(state, {
        userId: user.id,
        type: body.mode!,
        model: body.model!,
        prompt: body.prompt!,
        previewUrl: body.previewUrl,
        taskId: body.videoId,
        status: body.status
      })
    );

    return Response.json({ history: record }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({ error: "Unable to save history", detail: error instanceof Error ? error.message : error });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    await withAccountState((state) => clearHistoryForUser(state, user.id));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({ error: "Unable to clear history", detail: error instanceof Error ? error.message : error });
  }
}
