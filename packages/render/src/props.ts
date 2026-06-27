import type { DocumentaryProps } from "@doc/core";
export type { DocumentaryProps };

export function totalFrames(props: DocumentaryProps): number {
  const intro = props.intro?.durationInFrames ?? 0;
  return intro + props.segments.reduce((n, s) => n + s.durationInFrames, 0);
}

export function dimensions(aspectRatio: DocumentaryProps["aspectRatio"]) {
  return aspectRatio === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}
