import { readFile } from "fs/promises";
import path from "path";

const UPLOAD_DIR = "/tmp/siyu-factory-uploads";
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(path.join(UPLOAD_DIR, id));
    const extension = id.split(".").pop()?.toLowerCase() || "jpg";
    return new Response(file, {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Type": CONTENT_TYPES[extension] || "image/jpeg"
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
