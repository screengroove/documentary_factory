import Link from "next/link";
import { listProjects } from "@/lib/projects";
import { CreateForm } from "./CreateForm";

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
