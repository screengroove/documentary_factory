# Speech Pronunciation Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users fix how the TTS narrator pronounces specific words via a project-wide pronunciation dictionary, with an LLM suggestion helper, an audio preview, and an explicit "apply & re-record" action — all in a tabbed Gate 4 (voiceover) UI.

**Architecture:** A project-level `pronunciations: {term, respelling}[]` field on the manifest. At voiceover time, terms are substituted into narration before Kokoro TTS (`applyPronunciations`), and the WhisperX caption words are mapped back to the original spelling (`remapWords`). The web UI adds a tabbed voiceover gate (Audio Segments | Pronunciation), with three new endpoints: term-only LLM suggestion, Kokoro-only audio preview, and an apply route that clears affected audio and re-records.

**Tech Stack:** TypeScript (strict, ESM), Zod, Vitest, Next.js (App Router) in `@doc/web`, core logic in `@doc/core`, Replicate (Kokoro + WhisperX), Anthropic SDK.

## Global Constraints

- **ESM imports use the `.js` suffix** for relative paths inside `@doc/core` (e.g. `import { x } from "./pronunciation.js"`). Match existing files.
- **Tests are Vitest**, colocated as `*.test.ts`. Run per-workspace: `npm --workspace @doc/core run test`, `npm --workspace @doc/web run test`.
- **Web changes must pass `npm --workspace @doc/web run build`** — tsc + vitest miss Next webpack errors.
- **Match existing style** (see `edits.ts`, `voiceover.ts`, `GateClient.tsx`): small focused functions, inline `style={{}}` in JSX, `--color-*` design tokens.
- **Providers are not unit-tested** in this repo (no network tests). New provider code (`synthesize`) and routes that hit the network are verified by build + manual run, not Vitest.
- **Respelling convention** (used by the LLM prompt and docs): plain-English letters + hyphens, hyphens separate syllables, CAPS mark the stressed syllable, no IPA. Example: `Iwanicki → ee-vah-NEE-tskee`.

---

### Task 1: Manifest `pronunciations` field

**Files:**
- Modify: `packages/core/src/manifest.ts`
- Test: `packages/core/src/manifest.schema.test.ts`

**Interfaces:**
- Produces: `PronunciationEntry = { term: string; respelling: string }`; optional `Manifest.pronunciations?: PronunciationEntry[]`.

- [ ] **Step 1: Write the failing test** — append to `manifest.schema.test.ts`:

```ts
test("pronunciations is optional and round-trips", () => {
  const base = ManifestSchema.parse(minimalManifest()); // existing helper in this file
  expect(base.pronunciations).toBeUndefined();           // old manifests load unchanged
  const withDict = ManifestSchema.parse({
    ...minimalManifest(),
    pronunciations: [{ term: "Iwanicki", respelling: "ee-vah-NEE-tskee" }],
  });
  expect(withDict.pronunciations).toEqual([{ term: "Iwanicki", respelling: "ee-vah-NEE-tskee" }]);
});
```

> If `minimalManifest()` doesn't exist in the file, build the object inline from an existing passing test in the same file (copy its manifest literal).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @doc/core run test -- manifest.schema`
Expected: FAIL (`pronunciations` not in parsed output / unknown key stripped).

- [ ] **Step 3: Add the schema** — in `manifest.ts`, near `MusicSchema`:

```ts
const PronunciationEntrySchema = z.object({
  term: z.string(),       // word/phrase as it appears in narration
  respelling: z.string(), // plain-English phonetic respelling for TTS
});
export type PronunciationEntry = z.infer<typeof PronunciationEntrySchema>;
```

And add to `ManifestSchema` (alongside `music`):

```ts
  pronunciations: z.array(PronunciationEntrySchema).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @doc/core run test -- manifest.schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/manifest.ts packages/core/src/manifest.schema.test.ts
git commit -m "feat(core): add optional pronunciations field to manifest"
```

---

### Task 2: `applyPronunciations` (substitution)

**Files:**
- Create: `packages/core/src/pronunciation.ts`
- Test: `packages/core/src/pronunciation.test.ts`

**Interfaces:**
- Consumes: `PronunciationEntry` (Task 1).
- Produces: `applyPronunciations(narration: string, entries: PronunciationEntry[]): { spokenText: string; used: PronunciationEntry[] }`.

- [ ] **Step 1: Write the failing test** — `pronunciation.test.ts`:

```ts
import { expect, test } from "vitest";
import { applyPronunciations } from "./pronunciation.js";

test("replaces whole words, case-insensitively, preserving punctuation", () => {
  const r = applyPronunciations("Arsenic, and more arsenic.", [{ term: "arsenic", respelling: "AR-suh-nik" }]);
  expect(r.spokenText).toBe("AR-suh-nik, and more AR-suh-nik.");
  expect(r.used).toEqual([{ term: "arsenic", respelling: "AR-suh-nik" }]);
});

test("does not match inside another word", () => {
  const r = applyPronunciations("Alice met Al.", [{ term: "Al", respelling: "AL" }]);
  expect(r.spokenText).toBe("Alice met AL.");
});

test("longest term wins over a contained term", () => {
  const r = applyPronunciations("World Health Organization", [
    { term: "Health", respelling: "HELLTH" },
    { term: "World Health Organization", respelling: "W-H-O" },
  ]);
  expect(r.spokenText).toBe("W-H-O");
});

test("no match leaves text unchanged and used empty", () => {
  const r = applyPronunciations("nothing here", [{ term: "xyz", respelling: "ZZZ" }]);
  expect(r.spokenText).toBe("nothing here");
  expect(r.used).toEqual([]);
});

test("blank entries are ignored", () => {
  const r = applyPronunciations("hi", [{ term: "  ", respelling: "x" }, { term: "hi", respelling: "" }]);
  expect(r.spokenText).toBe("hi");
  expect(r.used).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @doc/core run test -- pronunciation`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `pronunciation.ts`:

```ts
import type { PronunciationEntry } from "./manifest.js";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Substitute each term's respelling into the narration before TTS. Whole-word
// (\b), case-insensitive, punctuation-preserving. Longest term first so a phrase
// wins over a word it contains. Returns the spoken text plus the entries that
// actually matched (drives whether caption remapping is needed).
export function applyPronunciations(
  narration: string,
  entries: PronunciationEntry[],
): { spokenText: string; used: PronunciationEntry[] } {
  const sorted = [...entries]
    .filter((e) => e.term.trim() && e.respelling.trim())
    .sort((a, b) => b.term.length - a.term.length);
  let spokenText = narration;
  const used: PronunciationEntry[] = [];
  for (const e of sorted) {
    const re = new RegExp(`\\b${escapeRe(e.term)}\\b`, "gi");
    const replaced = spokenText.replace(re, e.respelling);
    if (replaced !== spokenText) {
      used.push(e);
      spokenText = replaced;
    }
  }
  return { spokenText, used };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @doc/core run test -- pronunciation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pronunciation.ts packages/core/src/pronunciation.test.ts
git commit -m "feat(core): applyPronunciations substitutes respellings before TTS"
```

---

### Task 3: `remapWords` (caption fix)

**Files:**
- Modify: `packages/core/src/pronunciation.ts`
- Test: `packages/core/src/pronunciation.test.ts`

**Interfaces:**
- Consumes: `Word` (from `./providers/types.js`), `PronunciationEntry`.
- Produces: `remapWords(narration: string, words: Word[], used: PronunciationEntry[]): Word[]`.

**Why:** captions render `segment.audio.words[].word` verbatim (`packages/render/src/Captions.tsx`). WhisperX transcribes the *respelled* audio, so without this the caption would read the respelling. This maps the spoken tokens of a corrected term back to the original spelling, keeping the audio's timing. It degrades gracefully: on any alignment drift it returns `words` unchanged (current behavior).

- [ ] **Step 1: Write the failing test** — append to `pronunciation.test.ts`:

```ts
import { remapWords } from "./pronunciation.js";

const W = (word: string, start: number, end: number) => ({ word, start, end });

test("collapses a corrected term's spoken tokens back to the original spelling", () => {
  const words = [W("Hello", 0, 0.5), W("ee", 0.5, 0.7), W("vah", 0.7, 0.9), W("nee", 0.9, 1.1), W("tskee", 1.1, 1.4), W("world", 1.4, 1.9)];
  const out = remapWords("Hello Iwanicki world", words, [{ term: "Iwanicki", respelling: "ee-vah-nee-tskee" }]);
  expect(out).toEqual([W("Hello", 0, 0.5), W("Iwanicki", 0.5, 1.4), W("world", 1.4, 1.9)]);
});

test("no used entries returns words unchanged", () => {
  const words = [W("a", 0, 1)];
  expect(remapWords("a", words, [])).toBe(words);
});

test("falls back to original words on drift", () => {
  const words = [W("ee", 0, 0.5)]; // missing the trailing anchor entirely
  const out = remapWords("Hello Iwanicki world", words, [{ term: "Iwanicki", respelling: "ee" }]);
  expect(out).toBe(words);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @doc/core run test -- pronunciation`
Expected: FAIL (`remapWords` not exported).

- [ ] **Step 3: Implement** — append to `pronunciation.ts`:

```ts
import type { Word } from "./providers/types.js";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Map WhisperX words (aligned to the respelled audio) back to the original
// narration spelling. Unchanged narration words act as anchors; the spoken
// tokens between anchors that cover a corrected term collapse into one word
// carrying the original term and the term's combined timing. Returns `words`
// unchanged if alignment drifts (graceful — captions then match WhisperX as before).
export function remapWords(narration: string, words: Word[], used: PronunciationEntry[]): Word[] {
  if (used.length === 0) return words;
  const narr = narration.split(/\s+/).filter(Boolean);
  const termSeqs = used.map((e) => ({ term: e.term, seq: e.term.split(/\s+/).filter(Boolean).map(norm) }));
  const out: Word[] = [];
  let wi = 0;
  for (let ni = 0; ni < narr.length; ) {
    const match = termSeqs.find((t) => t.seq.length > 0 && t.seq.every((s, k) => norm(narr[ni + k] ?? "") === s));
    if (match) {
      const afterNi = ni + match.seq.length;
      const nextAnchor = afterNi < narr.length ? norm(narr[afterNi]) : null;
      let wj = wi;
      while (wj < words.length && (nextAnchor === null || norm(words[wj].word) !== nextAnchor)) wj++;
      const span = words.slice(wi, wj);
      if (span.length === 0) return words; // nothing to map — bail
      out.push({ word: match.term, start: span[0].start, end: span[span.length - 1].end });
      wi = wj;
      ni = afterNi;
    } else {
      if (wi >= words.length) return words; // drift — bail
      out.push(words[wi]);
      wi++;
      ni++;
    }
  }
  for (; wi < words.length; wi++) out.push(words[wi]);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @doc/core run test -- pronunciation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pronunciation.ts packages/core/src/pronunciation.test.ts
git commit -m "feat(core): remapWords restores original spelling in captions"
```

---

### Task 4: `suggestRespelling` (LLM helper)

**Files:**
- Modify: `packages/core/src/pronunciation.ts`
- Test: `packages/core/src/pronunciation.test.ts`

**Interfaces:**
- Consumes: `LlmClient` (`./providers/types.js`).
- Produces: `suggestRespelling(llm: LlmClient, term: string): Promise<string>`.

- [ ] **Step 1: Write the failing test** — append to `pronunciation.test.ts`:

```ts
import { suggestRespelling } from "./pronunciation.js";

test("suggestRespelling asks the LLM and returns the trimmed respelling", async () => {
  let sawSystem = "", sawUser = "";
  const llm = { complete: async ({ system, user, schema }: any) => { sawSystem = system; sawUser = user; return schema.parse({ respelling: " ee-vah-NEE-tskee " }); } };
  const out = await suggestRespelling(llm as any, "Iwanicki");
  expect(out).toBe("ee-vah-NEE-tskee");
  expect(sawUser).toBe("Iwanicki");
  expect(sawSystem.toLowerCase()).toContain("respelling");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @doc/core run test -- pronunciation`
Expected: FAIL (`suggestRespelling` not exported).

- [ ] **Step 3: Implement** — append to `pronunciation.ts`:

```ts
import { z } from "zod";
import type { LlmClient } from "./providers/types.js";

// Ask the LLM for a single plain-English phonetic respelling of `term`. Term-only
// (stateless) — no project context. Convention: hyphens separate syllables, CAPS
// mark stress, no IPA.
export async function suggestRespelling(llm: LlmClient, term: string): Promise<string> {
  const schema = z.object({ respelling: z.string() });
  const system =
    "You are a pronunciation assistant for a text-to-speech narrator. Given a single " +
    "word or short phrase, return a plain-English phonetic respelling that makes a TTS " +
    "engine say it correctly. Rules: use only plain English letters and hyphens; separate " +
    "syllables with hyphens; put the STRESSED syllable in CAPITALS; do not use IPA; output " +
    'only the respelling. Example: "Iwanicki" -> "ee-vah-NEE-tskee".';
  const { respelling } = await llm.complete({ system, user: term, schema });
  return respelling.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace @doc/core run test -- pronunciation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pronunciation.ts packages/core/src/pronunciation.test.ts
git commit -m "feat(core): suggestRespelling proposes a phonetic respelling via LLM"
```

---

### Task 5: Export new core API + `synthesize` (Kokoro-only)

**Files:**
- Modify: `packages/core/src/providers/replicate-tts.ts`
- Modify: `packages/core/src/index.ts` (the package barrel — confirm the path; it re-exports manifest, stages, providers)

**Interfaces:**
- Produces (exported from `@doc/core`): `applyPronunciations`, `remapWords`, `suggestRespelling`, `PronunciationEntry`, `anthropicLlm`, `synthesize`, `DEFAULT_VOICE_ID`.
- Produces: `synthesize(token: string, args: { text: string; voiceId: string }, opts?: { ttsModel?: string }): Promise<Buffer>`.

> No Vitest here (provider network code + barrel). Verified by build/typecheck.

- [ ] **Step 1: Refactor `replicate-tts.ts`** — extract the Kokoro call so `speak` reuses it and `synthesize` can skip WhisperX. Replace the body of `speak`'s synthesis step and add the standalone export:

```ts
// Kokoro synthesis only: run the model, download the WAV. Shared by speak()
// (which then aligns) and the preview endpoint (which does not).
async function kokoro(
  client: Replicate, model: `${string}/${string}`, text: string, voiceId: string,
): Promise<{ audioUrl: string; audio: Buffer }> {
  const ttsOut = await client.run(model, { input: { text, voice: voiceId, speed: 1 } });
  const audioUrl = firstUrl(ttsOut);
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Kokoro audio download failed: ${res.status}`);
  return { audioUrl, audio: Buffer.from(await res.arrayBuffer()) };
}

// Standalone Kokoro synth for previews — no WhisperX alignment (≈2× faster).
export async function synthesize(
  token: string, args: { text: string; voiceId: string }, opts: { ttsModel?: string } = {},
): Promise<Buffer> {
  const client = new Replicate({ auth: token });
  const ttsModel = (opts.ttsModel ?? KOKORO) as `${string}/${string}`;
  const { audio } = await kokoro(client, ttsModel, args.text, args.voiceId);
  return audio;
}
```

And inside `replicateTts(...).speak`, replace the first synthesis block with:

```ts
      // 1) Synthesize (Kokoro). 2) Align (WhisperX) using the same URL.
      const { audioUrl, audio } = await kokoro(client, ttsModel, text, voiceId);
```

(Delete the now-duplicated `client.run(ttsModel, ...)`, `firstUrl`, `fetch`, and `Buffer.from` lines that the block replaced; keep the WhisperX `client.run(alignModel, { input: { audio_file: audioUrl, ... } })` and the `words` mapping unchanged.)

- [ ] **Step 2: Add barrel exports** — in `packages/core/src/index.ts` add:

```ts
export { applyPronunciations, remapWords, suggestRespelling } from "./pronunciation.js";
export type { PronunciationEntry } from "./manifest.js";
export { anthropicLlm } from "./providers/anthropic.js";
export { synthesize } from "./providers/replicate-tts.js";
export { DEFAULT_VOICE_ID } from "./stages/voiceover.js";
```

> Check `index.ts` first; some of these (e.g. `DEFAULT_VOICE_ID`, `anthropicLlm`) may already be re-exported. Add only what's missing; don't duplicate.

- [ ] **Step 3: Typecheck / build core**

Run: `npm --workspace @doc/core run build` (or `test`, which typechecks)
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/providers/replicate-tts.ts packages/core/src/index.ts
git commit -m "feat(core): export synthesize (Kokoro-only) and pronunciation API"
```

---

### Task 6: Wire pronunciation into the voiceover stage

**Files:**
- Modify: `packages/core/src/stages/voiceover.ts`
- Test: `packages/core/src/stages/voiceover.test.ts`

**Interfaces:**
- Consumes: `applyPronunciations`, `remapWords` (Tasks 2-3); `Manifest.pronunciations` (Task 1).

- [ ] **Step 1: Write the failing test** — append to `voiceover.test.ts`:

```ts
test("applies the pronunciation dictionary and remaps caption words", async () => {
  const dir = projectWithSegments(); // narration: "Hello there."
  let passedText = "";
  const deps = makeFakeDeps({
    tts: { speak: async ({ text }) => { passedText = text; return {
      audio: Buffer.from([1]),
      words: [{ word: "Hello", start: 0, end: 0.5 }, { word: "thair", start: 0.5, end: 1.0 }],
    }; } },
  });
  let m = loadManifest(dir);
  m.pronunciations = [{ term: "there", respelling: "thair" }];
  saveManifest(dir, m);

  await runVoiceover(dir, deps, { getDuration: async () => 1.0 });

  expect(passedText).toBe("Hello thair.");            // respelled text reaches TTS
  m = loadManifest(dir);
  expect(m.segments[0].audio?.words.map((w) => w.word)).toEqual(["Hello", "there"]); // caption restored
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace @doc/core run test -- voiceover`
Expected: FAIL (`passedText` is `"Hello there."` / words are `["Hello","thair"]`).

- [ ] **Step 3: Implement** — in `voiceover.ts`, add the import and update the loop body:

```ts
import { applyPronunciations, remapWords } from "../pronunciation.js";
```

```ts
  for (const seg of m.segments) {
    if (seg.audio) continue;
    const { spokenText, used } = applyPronunciations(seg.narration, m.pronunciations ?? []);
    const { audio, words } = await deps.tts.speak({ text: spokenText, voiceId });
    const captionWords = used.length ? remapWords(seg.narration, words, used) : words;
    const filePath = join(projectPaths(projectDir).audio, `${seg.id}.wav`);
    writeFileSync(filePath, audio);
    const durationSec = await getDuration(filePath);
    seg.audio = { path: `assets/audio/${seg.id}.wav`, durationSec, words: captionWords };
    saveManifest(projectDir, m);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @doc/core run test -- voiceover`
Expected: PASS (both the new test and the existing "writes audio file…" test).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/stages/voiceover.ts packages/core/src/stages/voiceover.test.ts
git commit -m "feat(core): voiceover applies pronunciation dictionary + remaps captions"
```

---

### Task 7: `setPronunciations` + `prepareReRecord` (web edits)

**Files:**
- Modify: `packages/web/src/lib/edits.ts`
- Test: `packages/web/src/lib/edits.test.ts`

**Interfaces:**
- Consumes: `PronunciationEntry`, `applyPronunciations` from `@doc/core`.
- Produces: `setPronunciations(dir: string, entries: PronunciationEntry[]): void` (non-destructive save, allowed post-approval); `prepareReRecord(dir: string): string[]` (clears audio for term-containing segments, resets assemble to pending, returns affected ids).

- [ ] **Step 1: Write the failing tests** — append to `edits.test.ts`:

```ts
import { setPronunciations, prepareReRecord } from "./edits.js";

test("setPronunciations saves entries, drops blanks, is allowed after approval, leaves audio", () => {
  const dir = proj();
  let m = loadManifest(dir);
  m.stages.voiceover.status = "approved";
  m.segments = [{ id: "seg-001", order: 0, narration: "arsenic", audio: { path: "a", durationSec: 1, words: [] } }];
  saveManifest(dir, m);
  setPronunciations(dir, [{ term: "arsenic", respelling: "AR-suh-nik" }, { term: "", respelling: "x" }]);
  m = loadManifest(dir);
  expect(m.pronunciations).toEqual([{ term: "arsenic", respelling: "AR-suh-nik" }]); // blank dropped
  expect(m.segments[0].audio).toBeDefined();                                          // non-destructive
});

test("prepareReRecord clears audio for term-containing segments only and resets assemble", () => {
  const dir = proj();
  let m = loadManifest(dir);
  m.stages.assemble.status = "approved";
  m.pronunciations = [{ term: "arsenic", respelling: "AR-suh-nik" }];
  m.segments = [
    { id: "seg-001", order: 0, narration: "about arsenic", audio: { path: "a", durationSec: 1, words: [] } },
    { id: "seg-002", order: 1, narration: "no match here", audio: { path: "b", durationSec: 1, words: [] } },
  ];
  saveManifest(dir, m);
  const affected = prepareReRecord(dir);
  m = loadManifest(dir);
  expect(affected).toEqual(["seg-001"]);
  expect(m.segments[0].audio).toBeUndefined();
  expect(m.segments[1].audio).toBeDefined();
  expect(m.stages.assemble.status).toBe("pending");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace @doc/web run test -- edits`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement** — in `edits.ts`, update imports and add functions:

```ts
import { loadManifest, saveManifest, type StageName, type Still, type PronunciationEntry, applyPronunciations, CATALOG, trackSourcePath, DEFAULT_MUSIC_VOLUME } from "@doc/core";
```

```ts
// Save the dictionary. Non-destructive (never touches audio) and allowed at any
// gate state — late pronunciation fixes are the point. Blank rows are dropped.
export function setPronunciations(dir: string, entries: PronunciationEntry[]): void {
  const m = loadManifest(dir);
  m.pronunciations = entries.filter((e) => e.term.trim() && e.respelling.trim());
  saveManifest(dir, m);
}

// Stage a re-record: clear audio for every segment whose narration contains any
// current dictionary term, reset the (now-stale) assemble render to pending, and
// return the affected segment ids. The apply route then runs voiceover, which
// regenerates exactly the cleared segments.
export function prepareReRecord(dir: string): string[] {
  const m = loadManifest(dir);
  const entries = m.pronunciations ?? [];
  const affected: string[] = [];
  for (const s of m.segments) {
    if (!s.audio) continue;
    if (applyPronunciations(s.narration, entries).used.length > 0) {
      delete s.audio;
      affected.push(s.id);
    }
  }
  if (affected.length) m.stages.assemble.status = "pending";
  saveManifest(dir, m);
  return affected;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace @doc/web run test -- edits`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/edits.ts packages/web/src/lib/edits.test.ts
git commit -m "feat(web): setPronunciations (save) + prepareReRecord (clear affected audio)"
```

---

### Task 8: `setPronunciations` op on the segments route

**Files:**
- Modify: `packages/web/src/app/api/projects/[slug]/segments/route.ts`

**Interfaces:**
- Consumes: `setPronunciations` (Task 7), `PronunciationEntry` (`@doc/core`).

> No Vitest (thin Next route). Verified by build + manual.

- [ ] **Step 1: Add the op** — update the import, the `Action` union, and dispatch:

```ts
import { editNarration, editPrompt, rejectImage, rejectAudio, editTitle, rejectTitleImage, setMusicTrack, setMusicEnabled, setPronunciations } from "@/lib/edits";
import type { PronunciationEntry } from "@doc/core";
```

```ts
  | { op: "setMusicEnabled"; enabled: boolean }
  | { op: "setPronunciations"; entries: PronunciationEntry[] };
```

```ts
  else if (a.op === "setMusicEnabled") setMusicEnabled(dir, a.enabled);
  else if (a.op === "setPronunciations") setPronunciations(dir, a.entries);
```

- [ ] **Step 2: Build to verify it typechecks**

Run: `npm --workspace @doc/web run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/projects/[slug]/segments/route.ts
git commit -m "feat(web): segments route handles setPronunciations op"
```

---

### Task 9: Suggest endpoint

**Files:**
- Create: `packages/web/src/app/api/pronounce/suggest/route.ts`

**Interfaces:**
- Consumes: `anthropicLlm`, `suggestRespelling` (`@doc/core`).
- Produces: `POST /api/pronounce/suggest` body `{ term: string }` → `{ respelling: string }`.

> No Vitest (network route; the logic is unit-tested in Task 4). Verified by build + manual.

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { anthropicLlm, suggestRespelling } from "@doc/core";

export async function POST(req: Request) {
  try {
    const { term } = (await req.json()) as { term: string };
    if (!term?.trim()) return NextResponse.json({ error: "term required" }, { status: 400 });
    const llm = anthropicLlm(process.env.ANTHROPIC_API_KEY!);
    const respelling = await suggestRespelling(llm, term.trim());
    return NextResponse.json({ respelling });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

Run: `npm --workspace @doc/web run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/pronounce/suggest/route.ts
git commit -m "feat(web): /api/pronounce/suggest returns an LLM respelling for a term"
```

---

### Task 10: Preview endpoint

**Files:**
- Create: `packages/web/src/app/api/pronounce/preview/route.ts`

**Interfaces:**
- Consumes: `synthesize`, `DEFAULT_VOICE_ID` (`@doc/core`).
- Produces: `POST /api/pronounce/preview` body `{ text: string }` → `audio/wav`.

> No Vitest (network route). Verified by build + manual.

- [ ] **Step 1: Implement**

```ts
import { synthesize, DEFAULT_VOICE_ID } from "@doc/core";

export async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text: string };
    if (!text?.trim()) return new Response("text required", { status: 400 });
    const audio = await synthesize(process.env.REPLICATE_API_TOKEN!, { text: text.trim(), voiceId: DEFAULT_VOICE_ID });
    return new Response(new Uint8Array(audio), { headers: { "content-type": "audio/wav" } });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

Run: `npm --workspace @doc/web run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/api/pronounce/preview/route.ts
git commit -m "feat(web): /api/pronounce/preview synthesizes a respelling (no WhisperX)"
```

---

### Task 11: Apply endpoint

**Files:**
- Create: `packages/web/src/app/api/projects/[slug]/pronounce/apply/route.ts`

**Interfaces:**
- Consumes: `prepareReRecord` (Task 7), `runStage` (`@/lib/runner`), `PROJECTS_ROOT` (`@/lib/projects`).
- Produces: `POST /api/projects/[slug]/pronounce/apply` → `{ ok: true }` (after re-recording).

> No Vitest (runs the real voiceover stage). The clear/reset logic is unit-tested in Task 7. Verified by manual run.

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { join } from "node:path";
import { prepareReRecord } from "@/lib/edits";
import { runStage } from "@/lib/runner";
import { PROJECTS_ROOT } from "@/lib/projects";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    prepareReRecord(join(PROJECTS_ROOT, slug)); // clear affected audio + reset assemble
    await runStage(slug, "voiceover");          // regenerate cleared segments; sets awaiting_review
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

Run: `npm --workspace @doc/web run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "packages/web/src/app/api/projects/[slug]/pronounce/apply/route.ts"
git commit -m "feat(web): /pronounce/apply re-records affected segments"
```

---

### Task 12: Pronunciation panel component

**Files:**
- Create: `packages/web/src/app/p/[slug]/PronunciationPanel.tsx`

**Interfaces:**
- Consumes: `Manifest`, `PronunciationEntry` (`@doc/core`); props `{ slug, entries, post, longPost, busy }` where `post(path, body)` and `longPost(path, body, label)` are the helpers from `GateClient` (Task 13) and `busy: string | null`.
- Produces: `<PronunciationPanel ... />` (default export).

> No component test infra in this repo (web tests are lib-only). Verified by build + manual.

- [ ] **Step 1: Implement** — full component:

```tsx
"use client";
import { useState } from "react";
import type { Manifest, PronunciationEntry } from "@doc/core";

type Row = PronunciationEntry;

export default function PronunciationPanel({ slug, entries, post, longPost, busy }: {
  slug: string;
  entries: PronunciationEntry[];
  post: (path: string, body: unknown) => Promise<Manifest>;
  longPost: (path: string, body: unknown, label: string) => Promise<Manifest>;
  busy: string | null;
}) {
  const [rows, setRows] = useState<Row[]>(entries);
  const [pending, setPending] = useState<Record<number, "suggest" | "preview">>({});

  const persist = (next: Row[]) => { setRows(next); void post("segments", { op: "setPronunciations", entries: next }); };
  const edit = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows([...rows, { term: "", respelling: "" }]);
  const delRow = (i: number) => persist(rows.filter((_, k) => k !== i));

  const suggest = async (i: number) => {
    const term = rows[i].term.trim();
    if (!term) return;
    setPending({ ...pending, [i]: "suggest" });
    try {
      const res = await fetch(`/api/pronounce/suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term }) });
      const data = await res.json();
      if (res.ok && data.respelling) { const next = rows.map((r, k) => (k === i ? { ...r, respelling: data.respelling } : r)); persist(next); }
    } finally { setPending((p) => { const n = { ...p }; delete n[i]; return n; }); }
  };

  const preview = async (i: number) => {
    const text = rows[i].respelling.trim();
    if (!text) return;
    setPending({ ...pending, [i]: "preview" });
    try {
      const res = await fetch(`/api/pronounce/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) { const url = URL.createObjectURL(await res.blob()); await new Audio(url).play(); }
    } finally { setPending((p) => { const n = { ...p }; delete n[i]; return n; }); }
  };

  const affected = rows.filter((r) => r.term.trim() && r.respelling.trim()).length;

  return (
    <div className="ds-card" style={{ padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 15px", borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--text-heading)" }}>Pronunciation Dictionary</span>
        <button className="btn btn--ghost btn--sm" disabled={!!busy} onClick={addRow}>+ Add</button>
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: "var(--status-review)", background: "var(--status-review-tint)", border: "1px solid var(--status-review-border)", borderRadius: "var(--radius-md)", padding: "8px 11px" }}>
          <span className="badge badge--review"><span className="dot" />review</span>
          Changes take effect when you Apply &amp; re-record — that sends the voiceover gate back to review and the video will need re-rendering.
        </div>

        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 16px", color: "var(--text-meta)" }}>
            <div style={{ fontSize: 13, color: "var(--text-body)", marginBottom: 5 }}>No pronunciation corrections yet</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", maxWidth: 320, margin: "0 auto 14px" }}>Add a term and its phonetic respelling to fix how the narrator says names, acronyms, or jargon.</div>
            <button className="btn btn--primary btn--sm" disabled={!!busy} onClick={addRow}>+ Add first correction</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto auto", gap: 7, alignItems: "center" }}>
                  <input className="input mono" style={{ fontSize: 13 }} placeholder="term" value={r.term}
                    onChange={(e) => edit(i, { term: e.target.value })} onBlur={() => persist(rows)} />
                  <button className="btn btn--secondary btn--sm" title="Suggest phonetic spelling" disabled={!!busy || !r.term.trim() || !!pending[i]} onClick={() => suggest(i)}>
                    {pending[i] === "suggest" ? "…" : "✨"}
                  </button>
                  <input className="input mono" style={{ fontSize: 13, color: "var(--color-cyan)" }} placeholder="respelling" value={r.respelling}
                    onChange={(e) => edit(i, { respelling: e.target.value })} onBlur={() => persist(rows)} />
                  <button className="btn btn--secondary btn--sm" title="Preview" disabled={!r.respelling.trim() || !!pending[i]} onClick={() => preview(i)}>
                    {pending[i] === "preview" ? "…" : "▶"}
                  </button>
                  <button className="btn btn--danger btn--sm" title="Delete" disabled={!!busy} onClick={() => delRow(i)}>🗑</button>
                </div>
              ))}
            </div>
            <div><button className="btn btn--secondary btn--sm" disabled={!!busy} onClick={addRow}>+ Add correction</button></div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6, paddingTop: 11, borderTop: "1px solid var(--border-hairline)" }}>
              <button className="btn btn--primary btn--sm" disabled={!!busy || affected === 0}
                onClick={() => longPost(`pronounce/apply`, {}, "Re-recording…")}>
                {busy === "Re-recording…" ? "Re-recording…" : `Apply & re-record (${affected} segment${affected === 1 ? "" : "s"})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm --workspace @doc/web run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "packages/web/src/app/p/[slug]/PronunciationPanel.tsx"
git commit -m "feat(web): PronunciationPanel — dictionary rows, suggest, preview, apply"
```

---

### Task 13: Tabbed Gate 4 in GateClient

**Files:**
- Modify: `packages/web/src/app/p/[slug]/GateClient.tsx`

**Interfaces:**
- Consumes: `PronunciationPanel` (Task 12), existing `post`/`longPost`/`busy`/`m`.

> No Vitest. Verified by build + manual.

- [ ] **Step 1: Import + tab state** — add at the top with the other imports:

```tsx
import PronunciationPanel from "./PronunciationPanel";
```

And next to the other `useState` hooks:

```tsx
  const [voiceoverTab, setVoiceoverTab] = useState<"segments" | "pronunciation">("segments");
```

- [ ] **Step 2: Replace the Gate 4 block** — replace the entire `{viewing === "voiceover" && ( ... )}` block (currently `GateClient.tsx:349-366`) with:

```tsx
        {/* Gate 4: voiceover */}
        {viewing === "voiceover" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {([["segments", "Audio Segments"], ["pronunciation", "Pronunciation"]] as const).map(([id, label]) => {
                const on = voiceoverTab === id;
                return (
                  <button key={id} onClick={() => setVoiceoverTab(id)}
                    className="btn btn--sm"
                    style={{
                      fontWeight: 600,
                      color: on ? "var(--color-accent)" : "var(--text-body)",
                      background: on ? "var(--color-accent-tint)" : "transparent",
                      border: `1px solid ${on ? "var(--color-accent)" : "var(--border-card)"}`,
                    }}>
                    {label}
                    {id === "pronunciation" && (
                      <span className="mono" style={{ marginLeft: 7, fontSize: 11, color: on ? "var(--color-accent)" : "var(--text-meta)", background: "var(--surface-code)", border: "1px solid var(--border-hairline)", borderRadius: 999, padding: "1px 7px" }}>
                        {m.pronunciations?.length ?? 0}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {voiceoverTab === "segments" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {m.segments.map((s) => (
                  <div key={s.id} className="ds-card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                    <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)", flex: "none" }}>{s.id}</span>
                    <span style={{ flex: 1, minWidth: 160, color: "var(--text-body)" }}>{s.narration.slice(0, 56)}…</span>
                    {s.audio
                      ? <audio controls src={`/api/assets/${slug}/audio/${s.id}.wav`} style={{ height: 34 }} />
                      : <span style={{ color: "var(--text-disabled)", fontSize: 13 }}>— not generated yet —</span>}
                    {editable && (
                      <button className="btn btn--secondary btn--sm" disabled={!!busy}
                        onClick={() => post("segments", { op: "rejectAudio", id: s.id })}>Re-record</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {voiceoverTab === "pronunciation" && (
              <PronunciationPanel slug={slug} entries={m.pronunciations ?? []} post={post} longPost={longPost} busy={busy} />
            )}
          </div>
        )}
```

> The Pronunciation tab is always editable (it does not gate on `editable`) — it is the tool for late fixes. The Audio Segments tab keeps the existing `editable` gating for per-segment Re-record.

- [ ] **Step 3: Build**

Run: `npm --workspace @doc/web run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "packages/web/src/app/p/[slug]/GateClient.tsx"
git commit -m "feat(web): tabbed Gate 4 — Audio Segments | Pronunciation"
```

---

### Task 14: End-to-end verification

**Files:** none (manual + full suites).

- [ ] **Step 1: Full test suites**

Run: `npm --workspace @doc/core run test && npm --workspace @doc/web run test`
Expected: all PASS.

- [ ] **Step 2: Web production build**

Run: `npm --workspace @doc/web run build`
Expected: PASS (no Next/webpack errors).

- [ ] **Step 3: Manual end-to-end** (dev server, a project past the voiceover gate):
  1. Open a project, Gate 4 → **Pronunciation** tab. Confirm the count chip + blue active tab.
  2. Add a term that appears in the narration (e.g. a name). Click **✨** → respelling fills. Click **▶** → hear the synthesized respelling.
  3. Click **Apply & re-record (N segments)**. Confirm: only term-containing segments re-record, the voiceover gate returns to *awaiting review*, and assemble shows re-runnable (pending).
  4. Re-approve voiceover, re-render, and confirm the final video says the term correctly while the burned-in caption shows the original spelling.
  5. Open an **older project with no `pronunciations`** field — confirm it still loads and the tab shows count 0 with the empty state.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test: verify pronunciation correction end-to-end"
```

---

## Self-Review notes

- **Spec coverage:** manifest field (T1), applyPronunciations (T2), remapWords/captions (T3), suggest LLM (T4), synthesize/exports (T5), voiceover wiring (T6), non-destructive setPronunciations + prepareReRecord (T7), segments op (T8), suggest/preview/apply routes (T9-T11), panel + tabs (T12-T13), verification (T14). All spec sections map to a task.
- **Supersession:** the spec's "clear audio on every dictionary edit" is replaced by the Apply model — `setPronunciations` is non-destructive (T7); only `prepareReRecord`/apply mutate audio.
- **Type consistency:** `applyPronunciations` returns `{ spokenText, used }` (T2) consumed in T6/T7; `remapWords(narration, words, used)` (T3) consumed in T6; `prepareReRecord(dir): string[]` (T7) consumed in T11; `synthesize(token, {text, voiceId})` (T5) consumed in T10; `PronunciationEntry` from `@doc/core` used in T7/T8/T12.
- **Open item to confirm during T5:** check `packages/core/src/index.ts` actual barrel path/contents before adding exports (some may already exist).
