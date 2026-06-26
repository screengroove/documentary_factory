import { Composition } from "remotion";
import { Documentary } from "./Documentary.js";
import { dimensions, totalFrames, type DocumentaryProps } from "./props.js";

const EMPTY: DocumentaryProps = { fps: 30, aspectRatio: "16:9", segments: [] };

export const RemotionRoot = () => (
  <Composition
    id="Documentary"
    component={Documentary as any}
    durationInFrames={1}
    fps={30}
    width={1280}
    height={720}
    defaultProps={{ props: EMPTY }}
    calculateMetadata={({ props }) => {
      const p = (props as { props: DocumentaryProps }).props;
      const dim = dimensions(p.aspectRatio);
      return { durationInFrames: Math.max(1, totalFrames(p)), fps: p.fps, ...dim };
    }}
  />
);
