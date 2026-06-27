import { NextResponse } from "next/server";
import { loadManifest } from "@doc/core";
import { join } from "node:path";
import { PROJECTS_ROOT } from "@/lib/projects";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return NextResponse.json(loadManifest(join(PROJECTS_ROOT, slug)));
}
