import { NextResponse } from "next/server";
import { createProject, type Brief } from "@doc/core";
import { PROJECTS_ROOT, slugify } from "@/lib/projects";

export async function POST(req: Request) {
  const brief = (await req.json()) as Brief;
  const slug = slugify(brief.topic);
  if (!slug) {
    return NextResponse.json(
      { error: "Topic needs at least one letter or number (a–z, 0–9)" },
      { status: 400 },
    );
  }
  try {
    createProject(PROJECTS_ROOT, slug, brief, new Date().toISOString());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  return NextResponse.json({ slug });
}
