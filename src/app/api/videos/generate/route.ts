import { forwardJson, forwardMultipart, jsonError } from "@/lib/hellobabygo";

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

    if (references.length === 0) {
      return await forwardJson("/v1/videos", {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt,
          ...(seconds ? { seconds: String(seconds) } : {}),
          ...(size ? { size: String(size) } : {}),
          ...(imageUrl ? { image_url: String(imageUrl) } : {})
        })
      });
    }

    const formData = new FormData();
    formData.set("model", model);
    formData.set("prompt", prompt);

    if (seconds) formData.set("seconds", String(seconds));
    if (size) formData.set("size", String(size));
    if (imageUrl) formData.set("image_url", String(imageUrl));
    for (const [index, reference] of references.entries()) {
      formData.append("input_reference", reference, reference.name || `reference-${index + 1}.png`);
    }

    return await forwardMultipart("/v1/videos", formData);
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
