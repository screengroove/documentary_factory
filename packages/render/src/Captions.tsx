import { useMemo } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import type { DocumentaryProps } from "./props.js";

type Word = DocumentaryProps["segments"][number]["words"][number];

const SWITCH_MS = 1200;            // how often the caption page advances
const HIGHLIGHT = "#ffd166";

export function Captions({ words }: { words: Word[] }) {
  const { fps } = useVideoConfig();
  const pages = useMemo(() => {
    const captions: Caption[] = words.map((w) => ({
      // captions are whitespace-sensitive — keep a leading space before each word
      text: w.word.startsWith(" ") ? w.word : ` ${w.word}`,
      startMs: w.start * 1000,
      endMs: w.end * 1000,
      timestampMs: ((w.start + w.end) / 2) * 1000,
      confidence: null,
    }));
    return createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: SWITCH_MS }).pages;
  }, [words]);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: 48 }}>
      {pages.map((page, i) => {
        const next = pages[i + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        const endFrame = Math.min(
          next ? (next.startMs / 1000) * fps : Infinity,
          startFrame + (SWITCH_MS / 1000) * fps,
        );
        const durationInFrames = endFrame - startFrame;
        if (durationInFrames <= 0) return null;
        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationInFrames} layout="none">
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function CaptionPage({ page }: { page: TikTokPage }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;
  return (
    <div
      style={{
        fontFamily: "system-ui", fontSize: 48, fontWeight: 700, textAlign: "center",
        color: "white", textShadow: "0 2px 8px rgba(0,0,0,0.8)", whiteSpace: "pre",
      }}
    >
      {page.tokens.map((token) => {
        const active = token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
        return (
          <span key={token.fromMs} style={{ color: active ? HIGHLIGHT : "white" }}>
            {token.text}
          </span>
        );
      })}
    </div>
  );
}
