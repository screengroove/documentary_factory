import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS_ROOT } from "@/lib/projects";
import { contentTypeFor } from "./contentType";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; path: string[] }> }) {
  const { slug, path } = await params;
  const file = join(PROJECTS_ROOT, slug, "assets", ...path);
  const body = readFileSync(file);
  return new Response(body, { headers: { "content-type": contentTypeFor(file) } });
}
