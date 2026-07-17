import { getHfsyImageModel } from "@/lib/hfsy";

export type NormalizedImageRequest = {
  model: string;
  size?: string;
  aspect_ratio?: string;
};

export function normalizeImageRequestForUpstream(input: {
  model: string;
  size?: string;
  aspect_ratio?: string;
}): NormalizedImageRequest {
  const hfsyModel = getHfsyImageModel(input.model);
  return {
    model: hfsyModel?.upstreamModel || input.model,
    size: input.size,
    aspect_ratio: input.aspect_ratio
  };
}
