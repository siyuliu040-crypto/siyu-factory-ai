import { jsonError } from "@/lib/hellobabygo";
import { getImageJob } from "@/lib/image-jobs";
import { settleGenerationTask, updateHistoryByTaskId, withAccountState } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return jsonError({ error: "image job id is required" }, 400);

  const job = getImageJob(id);
  if (!job) {
    const recovered = await withAccountState((state) => {
      const task = state.generationTasks.find((item) => item.id === id && item.type === "image");
      const history = state.history.find((item) => item.taskId === id && item.mode === "image");

      if (history?.previewUrl || task?.status === "completed") {
        return {
          id,
          status: "completed",
          progress: 100,
          result: history?.previewUrl ? { data: [{ url: history.previewUrl }] } : undefined,
          error: history?.error,
          recovered: true
        };
      }

      if (task && task.status !== "failed") {
        settleGenerationTask(state, id, "failed");
        updateHistoryByTaskId(state, id, {
          status: "failed",
          error: "Image task was interrupted by a server restart. Credits have been refunded; please submit again."
        });
        return {
          id,
          status: "failed",
          progress: 100,
          error: "Image task was interrupted by a server restart. Credits have been refunded; please submit again.",
          recovered: true
        };
      }

      if (task?.status === "failed" || history?.status === "failed") {
        return {
          id,
          status: "failed",
          progress: 100,
          error: history?.error || "Image task failed.",
          recovered: true
        };
      }

      return null;
    });

    if (recovered) return Response.json(recovered, { headers: { "Cache-Control": "no-store" } });
    return jsonError({ error: "image job not found", status: 404 }, 404);
  }

  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
