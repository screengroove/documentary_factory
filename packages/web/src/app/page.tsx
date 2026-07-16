import { listProjects } from "@/lib/projects";
import { CreateForm } from "./CreateForm";
import { ProjectCard } from "./ProjectCard";

export const dynamic = "force-dynamic";

export default function Home() {
  const projects = listProjects();
  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-app)" }}>
      <header style={{ padding: "56px 56px 36px", borderBottom: "1px solid var(--border-hairline)",
        background: "radial-gradient(120% 140% at 0% 0%, rgba(79,143,247,0.07), transparent 60%)" }}>
        <div className="eyebrow" style={{ color: "var(--color-accent)", marginBottom: 14 }}>Agentic Documentary Pipeline</div>
        <h1 style={{ fontSize: "var(--text-display)", lineHeight: 1.1, maxWidth: 680 }}>Documentaries</h1>
        <p style={{ margin: "16px 0 0", maxWidth: 560, lineHeight: 1.6 }}>
          Turn a topic into a narrated-stills documentary through five checkpointed stages and four human review gates.
        </p>
      </header>

      <div style={{ padding: "40px 56px", maxWidth: 980, display: "flex", flexDirection: "column", gap: 32 }}>
        <section>
          <div className="eyebrow" style={{ marginBottom: 14 }}>New documentary</div>
          <CreateForm />
        </section>

        <section>
          <div className="eyebrow" style={{ marginBottom: 14 }}>Projects · {projects.length}</div>
          {projects.length === 0 ? (
            <div className="ds-card" style={{ padding: 24, color: "var(--text-meta)" }}>
              No projects yet — create your first above.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {projects.map((p) => (
                <ProjectCard key={p.slug} slug={p.slug} status={p.status} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
