import { NextResponse } from "next/server";
import { createProject, type Brief } from "@doc/core";
import { PROJECTS_ROOT, slugify } from "@/lib/projects";

export async function POST(req: Request) {
  const brief = (await req.json()) as Brief;
  const slug = slugify(brief.topic);
  createProject(PROJECTS_ROOT, slug, brief, new Date().toISOString());
  return NextResponse.json({ slug });
}
