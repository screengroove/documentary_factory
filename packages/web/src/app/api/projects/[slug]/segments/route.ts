import { NextResponse } from "next/server";
import { join } from "node:path";
import { editNarration, editPrompt, rejectImage, rejectAudio } from "@/lib/edits";
import { PROJECTS_ROOT } from "@/lib/projects";

type Action =
  | { op: "editNarration"; id: string; text: string }
  | { op: "editPrompt"; id: string; prompt: string }
  | { op: "rejectImage"; id: string; seed?: number; prompt?: string }
  | { op: "rejectAudio"; id: string };

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = join(PROJECTS_ROOT, slug);
  const a = (await req.json()) as Action;
  if (a.op === "editNarration") editNarration(dir, a.id, a.text);
  else if (a.op === "editPrompt") editPrompt(dir, a.id, a.prompt);
  else if (a.op === "rejectImage") rejectImage(dir, a.id, { seed: a.seed, prompt: a.prompt });
  else if (a.op === "rejectAudio") rejectAudio(dir, a.id);
  return NextResponse.json({ ok: true });
}
