import type { DocumentaryProps } from "@doc/core";
export type { DocumentaryProps };

export function totalFrames(props: DocumentaryProps): number {
  const intro = props.intro?.durationInFrames ?? 0;
  return intro + props.segments.reduce((n, s) => n + s.durationInFrames, 0);
}

export function dimensions(aspectRatio: DocumentaryProps["aspectRatio"]) {
  return aspectRatio === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}

// Constant `base` volume, ramped up over the first `fadeIn` frames and down over
// the last `fadeOut` frames of the composition.
export function musicVolume(
  frame: number,
  totalFrames: number,
  base: number,
  fadeIn = 30,
  fadeOut = 45,
): number {
  const up = Math.min(1, frame / Math.max(1, fadeIn));
  const down = Math.min(1, (totalFrames - frame) / Math.max(1, fadeOut));
  return base * Math.max(0, Math.min(up, down));
}
