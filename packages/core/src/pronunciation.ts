import { z } from "zod";
import type { PronunciationEntry } from "./manifest.js";
import type { LlmClient, Word } from "./providers/types.js";

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
