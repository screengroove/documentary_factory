"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { StageName } from "@doc/core";

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

export function ProjectCard({ slug, status }: { slug: string; status: Record<StageName, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm(`Delete project "${slug}"? This permanently removes all of its files and cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      setBusy(false);
      const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
      alert(`Could not delete project: ${error}`);
    }
  };

  return (
    <div className="ds-card" style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 18px",
      opacity: busy ? 0.5 : 1, pointerEvents: busy ? "none" : undefined }}>
      <Link href={`/p/${slug}`} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 16, textDecoration: "none" }}>
        <span className="mono" style={{ color: "var(--text-heading)", fontSize: 13, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slug}</span>
        <StatusDots status={status} />
      </Link>
      <button className="btn" onClick={remove} disabled={busy} title="Delete project"
        aria-label={`Delete project ${slug}`}
        style={{ flex: "none", padding: "6px 10px", color: "var(--status-error)" }}>
        {busy ? "Deleting…" : "Delete"}
      </button>
    </div>
  );
}
