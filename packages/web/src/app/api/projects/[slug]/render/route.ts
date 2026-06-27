import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadManifest, buildInputProps } from "@doc/core";
import { PROJECTS_ROOT } from "@/lib/projects";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = join(PROJECTS_ROOT, slug);
  try {
    // buildInputProps throws if any segment lacks shot/image/audio — surface that
    // clearly rather than as a bare 500 the reviewer can't interpret.
    const props = buildInputProps(loadManifest(dir));
    const propsPath = join(dir, "out", "inputProps.json");
    writeFileSync(propsPath, JSON.stringify({ props }));
    const outPath = join(dir, "out", `${slug}.mp4`);
    // Run from the render package so its remotion.config.ts loads (it sets the
    // webpack extensionAlias that resolves the ".js" import specifiers). Entry
    // is index.ts (the file that calls registerRoot), not Root.tsx. publicDir
    // points at the project dir so staticFile() resolves assets/*.
    const renderDir = join(process.cwd(), "..", "render");
    execFileSync("npx", [
      "remotion", "render",
      "src/index.ts",
      "Documentary", outPath,
      "--props", propsPath,
      "--public-dir", dir,
    ], { cwd: renderDir, stdio: ["ignore", "inherit", "pipe"] });
    return NextResponse.json({ ok: true, out: `out/${slug}.mp4` });
  } catch (err) {
    // execFileSync surfaces the subprocess stderr on err.stderr — include its tail
    // so a failed render reports the real Remotion error, not just the command.
    const stderr = (err as { stderr?: Buffer | string }).stderr;
    const detail = stderr ? String(stderr).trim().split("\n").slice(-12).join("\n") : "";
    const base = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: detail ? `${base}\n\n${detail}` : base },
      { status: 500 },
    );
  }
}
