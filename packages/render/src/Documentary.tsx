import { Sequence, staticFile } from "remotion";
import type { DocumentaryProps } from "./props.js";
import { Segment } from "./Segment.js";

export function Documentary({ props }: { props: DocumentaryProps }) {
  let start = 0;
  return (
    <>
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
