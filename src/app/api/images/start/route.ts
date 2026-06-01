import { jsonError } from "@/lib/hellobabygo";
import { startImageJob, type ImageJobRequest } from "@/lib/image-jobs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ImageJobRequest>;
    const model = body.model || "";
    const prompt = body.prompt?.trim() || "";

    if (!model || !prompt) {
      return jsonError({ error: "model and prompt are required" }, 400);
    }

    const job = startImageJob({
      model,
      prompt,
      n: body.n ?? 1,
      size: body.size ?? "1024x1024",
      aspect_ratio: body.aspect_ratio,
      response_format: body.response_format ?? "url"
    });

    return Response.json(
      { id: job.id, status: job.status, progress: job.progress },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return jsonError({
      error: "Image start failed",
      detail: error instanceof Error ? error.message : error
    });
  }
}
