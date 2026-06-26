import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadManifest, buildInputProps } from "@doc/core";
import { PROJECTS_ROOT } from "@/lib/projects";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = join(PROJECTS_ROOT, slug);
  const props = buildInputProps(loadManifest(dir));
  const propsPath = join(dir, "out", "inputProps.json");
  writeFileSync(propsPath, JSON.stringify({ props }));
  const outPath = join(dir, "out", `${slug}.mp4`);
  // publicDir points at the project dir so staticFile() resolves assets/*.
  execFileSync("npx", [
    "remotion", "render",
    join(process.cwd(), "..", "render", "src", "Root.tsx"),
    "Documentary", outPath,
    "--props", propsPath,
    "--public-dir", dir,
  ], { stdio: "inherit" });
  return NextResponse.json({ ok: true, out: `out/${slug}.mp4` });
}
