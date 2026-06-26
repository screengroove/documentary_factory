import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media"; // remotion-best-practices: media components come from @remotion/media
import type { DocumentaryProps } from "./props.js";
import { Captions } from "./Captions.js";

type Seg = DocumentaryProps["segments"][number];

export function Segment({ seg, audioSrc }: { seg: Seg; audioSrc: string }) {
  const frame = useCurrentFrame();
  // Eased progress so the Ken Burns move feels cinematic rather than linear/mechanical.
  const t = interpolate(frame, [0, seg.durationInFrames], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });
  const { from, to } = seg.kenBurns;
  // Interpolate the crop rect, then express it as a CSS transform (scale + translate).
  const w = from.w + (to.w - from.w) * t;
  const scale = 1 / w;
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  const translateXPct = -x * 100;
  const translateYPct = -y * 100;

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <Img
        src={seg.imagePath.startsWith("http") ? seg.imagePath : staticFile(seg.imagePath)}
        style={{
          width: "100%", height: "100%", objectFit: "cover",
          transform: `scale(${scale}) translate(${translateXPct}%, ${translateYPct}%)`,
          transformOrigin: "top left",
        }}
      />
      <Audio src={audioSrc} />
      <Captions words={seg.words} />
    </AbsoluteFill>
  );
}
