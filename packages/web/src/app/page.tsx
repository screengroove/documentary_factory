import Link from "next/link";
import { listProjects } from "@/lib/projects";
import { CreateForm } from "./CreateForm";
import type { StageName } from "@doc/core";

export const dynamic = "force-dynamic";

const STAGES: StageName[] = ["script", "shotlist", "images", "voiceover", "assemble"];

const DOT: Record<string, string> = {
  approved: "var(--status-approved)",
  running: "var(--status-running)",
  awaiting_review: "var(--status-review)",
  error: "var(--status-error)",
  pending: "var(--status-pending)",
};

function StatusDots({ status }: { status: Record<StageName, string> }) {
  const done = STAGES.filter((s) => status[s] === "approved").length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {STAGES.map((s) => (
        <span key={s} title={`${s}: ${status[s]}`}
          style={{ width: 9, height: 9, borderRadius: "var(--radius-full)", background: DOT[status[s]] ?? DOT.pending,
            animation: status[s] === "running" ? "ds-pulse 1.4s ease-in-out infinite" : undefined }} />
      ))}
      <span className="mono muted" style={{ marginLeft: 4, fontSize: 11 }}>{done}/5</span>
    </div>
  );
}

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
          <div className="eyebrow" style={{ marginBottom: 14 }}>Projects · {projects.length}</div>
          {projects.length === 0 ? (
            <div className="ds-card" style={{ padding: 24, color: "var(--text-meta)" }}>
              No projects yet — create your first below.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {projects.map((p) => (
                <Link key={p.slug} href={`/p/${p.slug}`} className="ds-card"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                    padding: "16px 18px", textDecoration: "none" }}>
                  <span className="mono" style={{ color: "var(--text-heading)", fontSize: 13, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.slug}</span>
                  <StatusDots status={p.status} />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="eyebrow" style={{ marginBottom: 14 }}>New documentary</div>
          <CreateForm />
        </section>
      </div>
    </main>
  );
}
