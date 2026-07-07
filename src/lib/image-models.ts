export type NormalizedImageRequest = {
  model: string;
  size?: string;
  aspect_ratio?: string;
};

function normalizeNanoBananaModel(model: string) {
  const match = model.match(/^(nano_banana(?:_2|_pro)?)-(1K|2K|4K)-(auto|portrait|square)$/i);
  if (!match) return null;

  const family = match[1].toLowerCase();
  const shape = match[3].toLowerCase();
  return {
    model: family === "nano_banana" ? "nano_banana_2" : family,
    aspect_ratio: shape === "square" ? "1:1" : shape === "portrait" ? "9:16" : undefined
  };
}

export function normalizeImageRequestForUpstream(input: {
  model: string;
  size?: string;
  aspect_ratio?: string;
}): NormalizedImageRequest {
  const normalizedNano = normalizeNanoBananaModel(input.model);
  if (!normalizedNano) {
    return {
      model: input.model,
      size: input.size,
      aspect_ratio: input.aspect_ratio
    };
  }

  return {
    model: normalizedNano.model,
    size: input.size,
    aspect_ratio: normalizedNano.aspect_ratio || input.aspect_ratio
  };
}
