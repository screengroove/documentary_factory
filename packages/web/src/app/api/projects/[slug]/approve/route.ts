import { NextResponse } from "next/server";
import { join } from "node:path";
import { approveStage } from "@/lib/edits";
import { PROJECTS_ROOT } from "@/lib/projects";
import type { StageName } from "@doc/core";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { stage } = (await req.json()) as { stage: StageName };
  approveStage(join(PROJECTS_ROOT, slug), stage);
  return NextResponse.json({ ok: true });
}
