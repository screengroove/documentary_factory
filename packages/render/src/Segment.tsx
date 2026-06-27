import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media"; // remotion-best-practices: media components come from @remotion/media
import type { DocumentaryProps } from "./props.js";
import { Captions } from "./Captions.js";

type Seg = DocumentaryProps["segments"][number];

// Crossfade between consecutive stills within a segment (~0.5s at 30fps). The
// first still never fades in, so segment-to-segment boundaries stay hard cuts.
const CROSSFADE_FRAMES = 15;

const src = (path: string) => (path.startsWith("http") ? path : staticFile(path));

export function Segment({ seg, audioSrc }: { seg: Seg; audioSrc: string }) {
  const frame = useCurrentFrame();

  // One audio clip + caption track span the whole segment; the stills are a
  // visual sequence layered underneath. Later stills paint on top and fade in
  // over the previous one, so the outgoing still shows through until covered.
  let start = 0;
  const layers = seg.stills.map((still, i) => {
    const from0 = start;
    const end0 = start + still.durationInFrames;
    start = end0;

    // Eased Ken Burns over this still's own window.
    const t = interpolate(frame, [from0, end0], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.ease),
    });
    const { from, to } = still.kenBurns;
    const w = from.w + (to.w - from.w) * t;
    const scale = 1 / w;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;

    // First still is always opaque; others fade in over the previous still.
    const fade = Math.min(CROSSFADE_FRAMES, still.durationInFrames);
    const opacity = i === 0 ? 1 : interpolate(frame, [from0, from0 + fade], [0, 1], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });

    return (
      <Img
        key={i}
        src={src(still.imagePath)}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
          transform: `scale(${scale}) translate(${-x * 100}%, ${-y * 100}%)`,
          transformOrigin: "top left",
          opacity,
        }}
      />
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {layers}
      <Audio src={audioSrc} />
      <Captions words={seg.words} />
    </AbsoluteFill>
  );
}
