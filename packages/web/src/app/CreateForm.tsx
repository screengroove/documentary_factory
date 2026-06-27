"use client";
import { useState } from "react";

export function CreateForm() {
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const brief = {
      topic, targetMinutes: 6, tone: "wistful, archival",
      aspectRatio: "16:9", imageStyle: "1970s 35mm film, muted",
    };
    const { slug } = await (await fetch("/api/projects", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(brief),
    })).json();
    window.location.href = `/p/${slug}`;
  };
  return (
    <div className="ds-card" style={{ padding: 18, display: "flex", gap: 12, alignItems: "center" }}>
      <input className="input" placeholder="Documentary topic — e.g. The history of lighthouses"
        value={topic} onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && topic && !busy) submit(); }} />
      <button className="btn btn--primary" onClick={submit} disabled={!topic || busy}>
        {busy ? "Creating…" : "Create"}
      </button>
    </div>
  );
}
