import { jsonError } from "@/lib/hellobabygo";

export const dynamic = "force-dynamic";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url") || "";
  if (!rawUrl) return jsonError({ error: "image url is required" }, 400);

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return jsonError({ error: "invalid image url" }, 400);
  }

  if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
    return jsonError({ error: "unsupported image url protocol" }, 400);
  }

  const response = await fetch(target.toString(), {
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8" },
    cache: "no-store"
  });
  if (!response.ok) {
    return jsonError({
      error: "image_proxy_fetch_failed",
      status: response.status
    }, 502);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    return jsonError({ error: "image is too large to proxy" }, 413);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return jsonError({ error: "image is too large to proxy" }, 413);
  }

  return new Response(bytes, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": contentType.startsWith("image/") ? contentType : "image/jpeg",
      "Content-Length": String(bytes.byteLength)
    }
  });
}
