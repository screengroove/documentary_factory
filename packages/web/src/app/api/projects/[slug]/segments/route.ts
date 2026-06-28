import { NextResponse } from "next/server";
import { join } from "node:path";
import { editNarration, editPrompt, rejectImage, rejectAudio, editTitle, rejectTitleImage, setMusicTrack, setMusicEnabled, setPronunciations } from "@/lib/edits";
const MUSIC_LIB_DIR = join(process.cwd(), "..", "core", "assets", "music");
import { PROJECTS_ROOT } from "@/lib/projects";
import type { PronunciationEntry } from "@doc/core";

type Action =
  | { op: "editNarration"; id: string; text: string }
  | { op: "editPrompt"; id: string; stillIndex: number; prompt: string }
  | { op: "rejectImage"; id: string; stillIndex: number; seed?: number; prompt?: string }
  | { op: "rejectAudio"; id: string }
  | { op: "editTitle"; text?: string; subtitle?: string }
  | { op: "rejectTitleImage"; seed?: number; prompt?: string }
  | { op: "setMusicTrack"; trackId: string }
  | { op: "setMusicEnabled"; enabled: boolean }
  | { op: "setPronunciations"; entries: PronunciationEntry[] };

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = join(PROJECTS_ROOT, slug);
  const a = (await req.json()) as Action;
  if (a.op === "editNarration") editNarration(dir, a.id, a.text);
  else if (a.op === "editPrompt") editPrompt(dir, a.id, a.stillIndex, a.prompt);
  else if (a.op === "rejectImage") rejectImage(dir, a.id, a.stillIndex, { seed: a.seed, prompt: a.prompt });
  else if (a.op === "rejectAudio") rejectAudio(dir, a.id);
  else if (a.op === "editTitle") editTitle(dir, { text: a.text, subtitle: a.subtitle });
  else if (a.op === "rejectTitleImage") rejectTitleImage(dir, { seed: a.seed, prompt: a.prompt });
  else if (a.op === "setMusicTrack") setMusicTrack(dir, a.trackId, { musicLibDir: MUSIC_LIB_DIR });
  else if (a.op === "setMusicEnabled") setMusicEnabled(dir, a.enabled);
  else if (a.op === "setPronunciations") setPronunciations(dir, a.entries);
  return NextResponse.json({ ok: true });
}
