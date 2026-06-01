import { forwardJson, jsonError } from "@/lib/hellobabygo";

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type || "image/jpeg";
  return `data:${mediaType};base64,${buffer.toString("base64")}`;
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const model = String(incoming.get("model") || "");
    const prompt = String(incoming.get("prompt") || "").trim();

    if (!model || !prompt) {
      return jsonError({ error: "model and prompt are required" }, 400);
    }

    const seconds = incoming.get("seconds");
    const size = incoming.get("size");
    const imageUrl = incoming.get("image_url");
    const references = incoming
      .getAll("input_reference")
      .filter((value): value is File => value instanceof File && value.size > 0);
    const uploadedReferenceUrls = await Promise.all(references.map((reference) => fileToDataUrl(reference)));
    const referenceUrls = [
      ...(imageUrl ? [String(imageUrl)] : []),
      ...uploadedReferenceUrls
    ].filter(Boolean);

    if (references.length === 0) {
      return await forwardJson("/v1/videos", {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt,
          ...(seconds ? { seconds: String(seconds) } : {}),
          ...(size ? { size: String(size) } : {}),
          ...(imageUrl ? { image_url: String(imageUrl), image_input: [String(imageUrl)] } : {})
        })
      });
    }

    return await forwardJson("/v1/videos", {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt,
        ...(seconds ? { seconds: String(seconds) } : {}),
        ...(size ? { size: String(size) } : {}),
        image_url: referenceUrls[0],
        image_input: referenceUrls,
        input_reference: referenceUrls[0]
      })
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : error;
    return jsonError({
      error: "Video generation request failed",
      message:
        "Video generation failed before the upstream task was created. Try fewer or smaller reference images, then submit again.",
      detail
    });
  }
}
