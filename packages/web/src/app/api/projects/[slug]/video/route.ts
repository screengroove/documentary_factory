import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS_ROOT } from "@/lib/projects";

// Serves the rendered MP4 at <slug>/out/<slug>.mp4. The /api/assets route only
// serves the assets/ subtree (images/audio); the final render lands in out/.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const file = join(PROJECTS_ROOT, slug, "out", `${slug}.mp4`);
  if (!existsSync(file)) return new Response("Not rendered", { status: 404 });
  const body = readFileSync(file);
  return new Response(body, { headers: { "content-type": "video/mp4" } });
}
