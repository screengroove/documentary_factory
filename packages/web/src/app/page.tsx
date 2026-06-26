import Link from "next/link";
import { listProjects } from "@/lib/projects";
import { CreateForm } from "./CreateForm";

// The project list is read from the live filesystem, so it must be rendered on
// demand — never statically prerendered at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  const projects = listProjects();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Documentaries</h1>
      <ul>
        {projects.map((p) => (
          <li key={p.slug}>
            <Link href={`/p/${p.slug}`}>{p.slug}</Link> — script: {p.status.script}
          </li>
        ))}
      </ul>
      <CreateForm />
    </main>
  );
}
