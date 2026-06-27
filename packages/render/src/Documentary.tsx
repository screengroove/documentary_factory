import { Sequence, staticFile } from "remotion";
import type { DocumentaryProps } from "./props.js";
import { Segment } from "./Segment.js";
import { Intro } from "./Intro.js";

export function Documentary({ props }: { props: DocumentaryProps }) {
  const intro = props.intro;
  // The intro plays first; everything after it is offset by its length.
  let start = intro?.durationInFrames ?? 0;
  return (
    <>
      {intro && (
        <Sequence from={0} durationInFrames={intro.durationInFrames}>
          <Intro intro={intro} />
        </Sequence>
      )}
      {props.segments.map((seg) => {
        const from = start;
        start += seg.durationInFrames;
        const audioSrc = staticFile(`assets/audio/${seg.id}.wav`);
        return (
          <Sequence key={seg.id} from={from} durationInFrames={seg.durationInFrames}>
            <Segment seg={seg} audioSrc={audioSrc} />
          </Sequence>
        );
      })}
    </>
  );
}
