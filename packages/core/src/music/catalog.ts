import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Track = {
  id: string;
  title: string;
  composer: string;
  file: string;          // filename within the music library dir
  moods: string[];       // mood tags matched by pickTrack
  license: string;
  sourceUrl: string;
};

// Only tracks whose files are actually present + license-vetted (see
// packages/core/assets/music/ATTRIBUTION.md). Add rows as files arrive.
export const CATALOG: Track[] = [
  {
    id: "mamoun-statement-1",
    title: "Statement No.1 for solo piano",
    composer: "John Mamoun",
    file: "mamoun-statement-1.mp3",
    moods: ["contemplative", "reflective"],
    license: "Public Domain Mark 1.0",
    sourceUrl: "https://archive.org/details/Statement1",
  },
  {
    id: "schellekens-medieval",
    title: "Medieval Theme",
    composer: "Maarten Schellekens",
    file: "schellekens-medieval.mp3",
    moods: ["tense", "dramatic"],
    license: "CC0",
    sourceUrl: "https://freemusicarchive.org/music/maarten-schellekens/public-domain-1/medieval-theme",
  },
];

// Absolute path to the in-repo library. Resolves correctly under vitest (real
// ESM source). In the bundled Next server this is wrong — callers there MUST
// pass an explicit libDir (see plan Global Constraints). Computed via path.join
// rather than `new URL("...", import.meta.url)`: webpack treats that literal as
// a bundled asset and fails the Next build trying to resolve the directory.
export function musicLibraryDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../assets/music");
}

export function trackSourcePath(track: Track, libDir: string = musicLibraryDir()): string {
  return join(libDir, track.file);
}

// Lowercase the freeform tone and match its words against mood keywords; return
// the first catalog track sharing a matched mood, else the first track.
const TONE_KEYWORDS: Array<[RegExp, string]> = [
  [/wistful|archival|nostalg|reflect|contempl|calm|gentle|quiet/, "contemplative"],
  [/somber|grief|tragic|dark|melanchol|\bsad\b|mourn/, "somber"],
  [/hope|uplift|inspir|triumph|serene|warm|joy/, "hopeful"],
  [/tense|urgent|dramatic|suspense|ominous|foreboding|thriller/, "tense"],
  [/formal|institution|historic|stately|grand|noble/, "stately"],
];

export function pickTrack(tone: string, catalog: Track[] = CATALOG): Track {
  if (catalog.length === 0) throw new Error("Music catalog is empty");
  const t = tone.toLowerCase();
  const moods = TONE_KEYWORDS.filter(([re]) => re.test(t)).map(([, mood]) => mood);
  for (const mood of moods) {
    const hit = catalog.find((tr) => tr.moods.includes(mood));
    if (hit) return hit;
  }
  return catalog[0];
}
