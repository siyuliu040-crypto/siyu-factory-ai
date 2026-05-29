import { HELLOBABYGO_BASE_URL, authHeaders, jsonError } from "@/lib/hellobabygo";

type ImageGeneratePayload = {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  response_format?: "url" | "b64_json";
};

function normalizeUpstreamText(text: string, status: number) {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify(status >= 200 && status < 300 ? parsed : { ...parsed, upstream_status: status });
  } catch {
    return JSON.stringify({ error: "Image upstream request failed", upstream_status: status, detail: text });
  }
}

function streamUpstream(path: string, init: RequestInit) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(" "));
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(" "));
      }, 5000);

      try {
        const response = await fetch(`${HELLOBABYGO_BASE_URL}${path}`, {
          ...init,
          cache: "no-store"
        });
        const text = await response.text();
        clearInterval(keepAlive);
        controller.enqueue(encoder.encode(normalizeUpstreamText(text, response.status)));
      } catch (error) {
        clearInterval(keepAlive);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: "Image generation request failed",
              detail: error instanceof Error ? error.message : error
            })
          )
        );
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const incoming = await request.formData();
      const model = String(incoming.get("model") || "");
      const prompt = String(incoming.get("prompt") || "").trim();

      if (!model || !prompt) {
        return jsonError({ error: "model and prompt are required" }, 400);
      }

      const references = incoming
        .getAll("image")
        .filter((value): value is File => value instanceof File && value.size > 0);

      if (references.length > 0) {
        const formData = new FormData();
        formData.set("model", model);
        formData.set("prompt", prompt);
        formData.set("n", String(incoming.get("n") || "1"));
        formData.set("size", String(incoming.get("size") || "1024x1024"));
        formData.set("response_format", String(incoming.get("response_format") || "url"));

        for (const [index, reference] of references.entries()) {
          formData.append("image", reference, reference.name || `reference-${index + 1}.png`);
        }

        return streamUpstream("/v1/images/edits", {
          method: "POST",
          headers: authHeaders({ Accept: "application/json" }),
          body: formData
        });
      }

      return streamUpstream("/v1/images/generations", {
        method: "POST",
        headers: authHeaders({
          "Content-Type": "application/json",
          Accept: "application/json"
        }),
        body: JSON.stringify({
          model,
          prompt,
          n: Number(incoming.get("n") || 1),
          size: String(incoming.get("size") || "1024x1024"),
          response_format: String(incoming.get("response_format") || "url")
        })
      });
    }

    const body = (await request.json()) as ImageGeneratePayload;

    if (!body.model || !body.prompt?.trim()) {
      return jsonError({ error: "model and prompt are required" }, 400);
    }

    return streamUpstream("/v1/images/generations", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
        Accept: "application/json"
      }),
      body: JSON.stringify({
        model: body.model,
        prompt: body.prompt.trim(),
        n: body.n ?? 1,
        size: body.size ?? "1024x1024",
        response_format: body.response_format ?? "url"
      })
    });
  } catch (error) {
    return jsonError({
      error: "Image generation request failed",
      detail: error instanceof Error ? error.message : error
    });
  }
}
