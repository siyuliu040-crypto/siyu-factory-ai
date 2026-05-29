import { HELLOBABYGO_BASE_URL, authHeaders, jsonError } from "@/lib/hellobabygo";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return jsonError({ error: "video id is required" }, 400);
    }

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
