import { NextResponse } from "next/server";
import { runStage } from "@/lib/runner";
import type { StageName } from "@doc/core";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { stage } = (await req.json()) as { stage: StageName };
  try {
    await runStage(slug, stage);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
