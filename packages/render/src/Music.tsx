import { Audio } from "@remotion/media"; // remotion-best-practices: media components come from @remotion/media
import { staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { musicVolume, type DocumentaryProps } from "./props.js";

type MusicProps = NonNullable<DocumentaryProps["music"]>;
const src = (p: string) => (p.startsWith("http") ? p : staticFile(p));

// One looping low-volume bed under the whole composition, fading in/out. Volume
// is computed per-frame (not a callback) so it works regardless of Audio's
// volume-callback support.
export function Music({ music }: { music: MusicProps }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <Audio src={src(music.path)} loop volume={musicVolume(frame, durationInFrames, music.volume)} />;
}
