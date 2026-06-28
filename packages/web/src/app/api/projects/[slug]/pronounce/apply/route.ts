import { NextResponse } from "next/server";
import { join } from "node:path";
import { prepareReRecord } from "@/lib/edits";
import { runStage } from "@/lib/runner";
import { PROJECTS_ROOT } from "@/lib/projects";

// Apply the dictionary to audio: clear audio for term-containing segments + reset
// the stale assemble render, then re-record those segments (runVoiceover sends the
// voiceover gate back to awaiting_review).
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    prepareReRecord(join(PROJECTS_ROOT, slug));
    await runStage(slug, "voiceover");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
