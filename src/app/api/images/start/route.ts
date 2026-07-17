import { jsonError } from "@/lib/hellobabygo";
import { startImageJob, type ImageJobRequest } from "@/lib/image-jobs";
import {
  AccountError,
  chargeUserCredits,
  recordGenerationHistory,
  recordGenerationTask,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";
import { getGenerationCost } from "@/lib/pricing";
import { getPromptLimit, isPromptTooLong } from "@/lib/prompt-limits";
import { getHfsyImageModel, isHfsyImageModel } from "@/lib/hfsy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("multipart/form-data")
      ? await readMultipartImageRequest(request)
      : ((await request.json()) as Partial<ImageJobRequest>);
    const model = body.model || "";
    const prompt = body.prompt?.trim() || "";

    if (!model || !prompt) {
      return jsonError({ error: "model and prompt are required" }, 400);
    }
    if (!isHfsyImageModel(model)) {
      return jsonError({
        error: "unsupported_image_model",
        message: "Only HFSY image models are enabled on this site."
      }, 400);
    }
    const hfsyImageModel = getHfsyImageModel(model);
    if (body.references?.length && hfsyImageModel?.referenceMode === "text-only") {
      return jsonError({
        error: "reference_not_supported",
        message: "This HFSY image model only supports prompt-only image generation. Use Nano Banana for reference-image generation."
      }, 400);
    }
    if (isPromptTooLong(model, prompt, "image")) {
      return jsonError({
        error: "prompt_too_long",
        message: `This image model supports up to ${getPromptLimit(model, "image")} prompt characters. Shorten the prompt and try again.`
      }, 400);
    }

    const amount = getGenerationCost(model, body.n ?? 1);
    const charge = await chargeUserCredits(request, amount, "image generation", { model, size: body.size });
    const job = startImageJob({
      model,
      prompt,
      n: body.n ?? 1,
      size: body.size ?? "1024x1024",
      aspect_ratio: body.aspect_ratio,
      response_format: body.response_format ?? "url",
      references: body.references
    }, {
      userId: charge.user.id,
      amount
    });
    await withAccountState((state) => {
      recordGenerationTask(state, {
        id: job.id,
        userId: charge.user.id,
        type: "image",
        model,
        amount
      });
      recordGenerationHistory(state, {
        userId: charge.user.id,
        type: "image",
        model,
        prompt,
        taskId: job.id,
        status: "queued"
      });
    });

    return Response.json(
      { id: job.id, status: job.status, progress: job.progress, charged: amount, balance: charge.user.credits },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof AccountError) return accountErrorResponse(error);
    return jsonError({
      error: "Image start failed",
      detail: error instanceof Error ? error.message : error
    });
  }
}

async function readMultipartImageRequest(request: Request): Promise<Partial<ImageJobRequest>> {
  const incoming = await request.formData();
  const references = await Promise.all(
    incoming
      .getAll("image")
      .filter((value): value is File => value instanceof File && value.size > 0)
      .map(async (file, index) => ({
        name: file.name || `reference-${index + 1}.png`,
        type: file.type || "image/png",
        data: Buffer.from(await file.arrayBuffer()).toString("base64")
      }))
  );

  return {
    model: String(incoming.get("model") || ""),
    prompt: String(incoming.get("prompt") || ""),
    n: Number(incoming.get("n") || 1),
    size: String(incoming.get("size") || "1024x1024"),
    aspect_ratio: incoming.get("aspect_ratio") ? String(incoming.get("aspect_ratio")) : undefined,
    response_format: String(incoming.get("response_format") || "url") as ImageJobRequest["response_format"],
    references
  };
}
