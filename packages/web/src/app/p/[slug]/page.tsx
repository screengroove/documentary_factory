import { loadManifest, CATALOG } from "@doc/core";
import { join } from "node:path";
import { PROJECTS_ROOT } from "@/lib/projects";
import { GateClient } from "./GateClient";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manifest = loadManifest(join(PROJECTS_ROOT, slug));
  return (
    <GateClient
      slug={slug}
      initial={manifest}
      tracks={CATALOG.map((t) => ({ id: t.id, title: t.title, composer: t.composer }))}
    />
  );
}
