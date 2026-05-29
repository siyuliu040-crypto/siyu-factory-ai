import { jsonError } from "@/lib/hellobabygo";
import { getImageJob } from "@/lib/image-jobs";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return jsonError({ error: "image job id is required" }, 400);

  const job = getImageJob(id);
  if (!job) return jsonError({ error: "image job not found", status: 404 }, 404);

  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
