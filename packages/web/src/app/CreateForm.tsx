"use client";
import { useState } from "react";

export function CreateForm() {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const brief = {
      topic, targetMinutes: 6, tone: "wistful, archival",
      aspectRatio: "16:9", imageStyle: "1970s 35mm film, muted", autoMode,
    };
    try {
      const res = await fetch("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(brief),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.slug) {
        setError(data.error ?? `Create failed (${res.status})`);
        return;
      }
      window.location.href = `/p/${data.slug}`;
    } catch {
      setError("Create failed — network error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ds-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", width: "100%" }}>
        <input className="input" placeholder="Documentary topic — e.g. The history of lighthouses"
          value={topic} onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && topic && !busy) submit(); }} />
        <button className="btn btn--primary" onClick={submit} disabled={!topic || busy}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 13, color: "var(--status-error)" }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%" }}>
        <label className="mono" style={{ fontSize: 12, color: "var(--text-body)", display: "flex", alignItems: "center", gap: 7, cursor: busy ? "default" : "pointer" }}>
          <input type="checkbox" checked={autoMode} disabled={busy}
            onChange={(e) => setAutoMode(e.target.checked)} />
          Auto mode
        </label>
        <span style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.5 }}>
          Skips all review gates — script, shotlist, images, voiceover and assembly run back-to-back, then the final MP4 renders automatically. Keep the project page open; you can switch back to manual at any time.
        </span>
      </div>
    </div>
  );
}
