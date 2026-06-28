"use client";
import { useState } from "react";
import type { Manifest, PronunciationEntry } from "@doc/core";

type Row = PronunciationEntry;

export default function PronunciationPanel({ entries, post, longPost, busy }: {
  entries: PronunciationEntry[];
  post: (path: string, body: unknown) => Promise<Manifest>;
  longPost: (path: string, body: unknown, label: string) => Promise<Manifest>;
  busy: string | null;
}) {
  const [rows, setRows] = useState<Row[]>(entries);
  const [pending, setPending] = useState<Record<number, "suggest" | "preview">>({});

  const persist = (next: Row[]) => { setRows(next); void post("segments", { op: "setPronunciations", entries: next }); };
  const edit = (i: number, patch: Partial<Row>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows([...rows, { term: "", respelling: "" }]);
  const delRow = (i: number) => persist(rows.filter((_, k) => k !== i));

  const suggest = async (i: number) => {
    const term = rows[i].term.trim();
    if (!term) return;
    setPending({ ...pending, [i]: "suggest" });
    try {
      const res = await fetch(`/api/pronounce/suggest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term }) });
      const data = await res.json();
      if (res.ok && data.respelling) persist(rows.map((r, k) => (k === i ? { ...r, respelling: data.respelling } : r)));
    } finally { setPending((p) => { const n = { ...p }; delete n[i]; return n; }); }
  };

  const preview = async (i: number) => {
    const text = rows[i].respelling.trim();
    if (!text) return;
    setPending({ ...pending, [i]: "preview" });
    try {
      const res = await fetch(`/api/pronounce/preview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) { const url = URL.createObjectURL(await res.blob()); await new Audio(url).play(); }
    } finally { setPending((p) => { const n = { ...p }; delete n[i]; return n; }); }
  };

  const affected = rows.filter((r) => r.term.trim() && r.respelling.trim()).length;

  return (
    <div className="ds-card" style={{ padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 15px", borderBottom: "1px solid var(--border-hairline)" }}>
        <span className="mono" style={{ fontSize: 13, color: "var(--text-heading)" }}>Pronunciation Dictionary</span>
        <button className="btn btn--ghost btn--sm" disabled={!!busy} onClick={addRow}>+ Add</button>
      </div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: "var(--status-review)", background: "var(--status-review-tint)", border: "1px solid var(--status-review-border)", borderRadius: "var(--radius-md)", padding: "8px 11px" }}>
          <span className="badge badge--review"><span className="dot" />review</span>
          Changes take effect when you Apply &amp; re-record — that sends the voiceover gate back to review and the video will need re-rendering.
        </div>

        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 16px", color: "var(--text-meta)" }}>
            <div style={{ fontSize: 13, color: "var(--text-body)", marginBottom: 5 }}>No pronunciation corrections yet</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", maxWidth: 320, margin: "0 auto 14px" }}>Add a term and its phonetic respelling to fix how the narrator says names, acronyms, or jargon.</div>
            <button className="btn btn--primary btn--sm" disabled={!!busy} onClick={addRow}>+ Add first correction</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto auto", gap: 7, alignItems: "center" }}>
                  <input className="input mono" style={{ fontSize: 13 }} placeholder="term" value={r.term}
                    onChange={(e) => edit(i, { term: e.target.value })} onBlur={() => persist(rows)} />
                  <button className="btn btn--secondary btn--sm" title="Suggest phonetic spelling" disabled={!!busy || !r.term.trim() || !!pending[i]} onClick={() => suggest(i)}>
                    {pending[i] === "suggest" ? "…" : "✨"}
                  </button>
                  <input className="input mono" style={{ fontSize: 13, color: "var(--color-cyan)" }} placeholder="respelling" value={r.respelling}
                    onChange={(e) => edit(i, { respelling: e.target.value })} onBlur={() => persist(rows)} />
                  <button className="btn btn--secondary btn--sm" title="Preview" disabled={!r.respelling.trim() || !!pending[i]} onClick={() => preview(i)}>
                    {pending[i] === "preview" ? "…" : "▶"}
                  </button>
                  <button className="btn btn--danger btn--sm" title="Delete" disabled={!!busy} onClick={() => delRow(i)}>🗑</button>
                </div>
              ))}
            </div>
            <div><button className="btn btn--secondary btn--sm" disabled={!!busy} onClick={addRow}>+ Add correction</button></div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6, paddingTop: 11, borderTop: "1px solid var(--border-hairline)" }}>
              <button className="btn btn--primary btn--sm" disabled={!!busy || affected === 0}
                onClick={() => longPost(`pronounce/apply`, {}, "Re-recording…")}>
                {busy === "Re-recording…" ? "Re-recording…" : `Apply & re-record (${affected} segment${affected === 1 ? "" : "s"})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
