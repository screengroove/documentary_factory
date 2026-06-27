import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { DocumentaryProps } from "./props.js";

type IntroProps = NonNullable<DocumentaryProps["intro"]>;

const src = (path: string) => (path.startsWith("http") ? path : staticFile(path));
// Serif for a documentary feel; the generic keyword resolves on headless Linux
// Chromium too, where named fonts like Georgia are absent.
const TITLE_FONT = "Georgia, 'Times New Roman', serif";

export function Intro({ intro }: { intro: IntroProps }) {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const d = intro.durationInFrames;

  // Slow Ken Burns across the whole card (same crop-rect → transform math as a still).
  const t = interpolate(frame, [0, d], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.ease),
  });
  const { from, to } = intro.kenBurns;
  const w = from.w + (to.w - from.w) * t;
  const scale = 1 / w;
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;

  // Title rises + fades in; the whole card fades out at the end for a clean cut
  // into the first segment.
  const textIn = interpolate(frame, [6, 28], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(frame, [6, 28], [width * 0.014, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cardOut = interpolate(frame, [d - 15, d], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden", opacity: cardOut }}>
      <Img
        src={src(intro.imagePath)}
        style={{
          position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
          transform: `scale(${scale}) translate(${-x * 100}%, ${-y * 100}%)`, transformOrigin: "top left",
        }}
      />
      {/* Scrim so the type stays legible over any image. */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.2) 45%, rgba(0,0,0,0.7) 100%)" }} />
      <AbsoluteFill
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          textAlign: "center", padding: width * 0.08, gap: width * 0.02,
          opacity: textIn, transform: `translateY(${rise}px)`,
        }}
      >
        <h1 style={{
          margin: 0, color: "white", fontFamily: TITLE_FONT, fontWeight: 700, lineHeight: 1.05,
          letterSpacing: "-0.01em", fontSize: width * 0.062, textShadow: "0 2px 24px rgba(0,0,0,0.6)",
        }}>{intro.text}</h1>
        {intro.subtitle && (
          <p style={{
            margin: 0, color: "rgba(255,255,255,0.86)", fontFamily: TITLE_FONT, fontWeight: 400,
            fontSize: width * 0.03, letterSpacing: "0.02em", textShadow: "0 1px 12px rgba(0,0,0,0.55)",
          }}>{intro.subtitle}</p>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
