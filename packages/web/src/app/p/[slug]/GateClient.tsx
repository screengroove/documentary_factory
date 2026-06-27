"use client";
import { useState } from "react";
import type { Manifest, StageName } from "@doc/core";

const ORDER: StageName[] = ["script", "shotlist", "images", "voiceover", "assemble"];

// The active stage is the first one not yet approved — the only stage you can act on.
function activeStage(m: Manifest): StageName {
  return ORDER.find((s) => m.stages[s].status !== "approved") ?? "assemble";
}

function glyph(status: string): string {
  switch (status) {
    case "approved": return "✓";
    case "awaiting_review": return "●";
    case "running": return "…";
    case "error": return "!";
    default: return "○"; // pending / not yet reached
  }
}

export function GateClient({ slug, initial }: { slug: string; initial: Manifest }) {
  const [m, setM] = useState(initial);
  const [viewing, setViewing] = useState<StageName>(activeStage(initial));
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const active = activeStage(m);
  const editable = viewing === active; // you can only act on the active stage
  const viewIdx = ORDER.indexOf(viewing);

  const refresh = async (): Promise<Manifest> => {
    const man = (await (await fetch(`/api/projects/${slug}/manifest`)).json()) as Manifest;
    setM(man);
    return man;
  };

  const post = async (path: string, body: unknown): Promise<Manifest> => {
    setActionError(null);
    const res = await fetch(`/api/projects/${slug}/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(data.error ?? `Request to ${path} failed (${res.status})`);
    }
    return refresh();
  };

  // Run/render hold the request open for the whole batch (minutes for images/audio).
  // Stages persist the manifest per-segment, so poll while in flight to stream
  // progress in, and show a busy banner so the UI never looks stalled/broken.
  const longPost = async (path: string, body: unknown, label: string): Promise<Manifest> => {
    setActionError(null);
    setBusy(label);
    const poll = setInterval(() => { void refresh(); }, 2500);
    try {
      const res = await fetch(`/api/projects/${slug}/${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? `Request to ${path} failed (${res.status})`);
      }
    } finally {
      clearInterval(poll);
      setBusy(null);
    }
    return refresh();
  };

  // Approving the active stage advances the pipeline — follow it to the next gate.
  const approve = async () => {
    const man = await post("approve", { stage: active });
    setViewing(activeStage(man));
  };

  const viewingStage = m.stages[viewing];

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1>{slug}</h1>

      {/* Stepper: jump to any stage */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "12px 0" }}>
        {ORDER.map((s, i) => {
          const isViewing = s === viewing;
          const isActive = s === active;
          return (
            <span key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setViewing(s)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  border: isViewing ? "2px solid #2563eb" : "1px solid #ccc",
                  background: isActive ? "#eef2ff" : "white",
                  fontWeight: isActive ? 700 : 400,
                }}
              >
                {isActive ? "▶ " : ""}{glyph(m.stages[s].status)} {s}
              </button>
              {i < ORDER.length - 1 && <span style={{ color: "#bbb" }}>—</span>}
            </span>
          );
        })}
      </div>

      {/* Prev / Next */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
        <button disabled={viewIdx === 0} onClick={() => setViewing(ORDER[viewIdx - 1])}>‹ Prev</button>
        <span>Viewing: <b>{viewing}</b> — status: {viewingStage.status}{editable ? " (active)" : ""}</span>
        <button disabled={viewIdx === ORDER.length - 1} onClick={() => setViewing(ORDER[viewIdx + 1])}>Next ›</button>
      </div>

      {viewingStage.error && <p style={{ color: "crimson" }}>Error: {viewingStage.error}</p>}
      {actionError && <p style={{ color: "crimson" }}>Action failed: {actionError}</p>}
      {busy && (
        <p style={{ color: "#2563eb", margin: "8px 0" }}>
          ⏳ {busy} — this can take a minute or two; results stream in as they finish.
        </p>
      )}

      {/* Action bar — only on the active stage; otherwise read-only notice */}
      {editable ? (
        <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
          <button disabled={!!busy} onClick={() => longPost("run", { stage: active }, `Running “${active}”`)}>
            Run “{active}”
          </button>
          <button disabled={!!busy} onClick={approve}>Approve “{active}”</button>
          {active === "assemble" && m.stages.voiceover.status === "approved" && (
            <button disabled={!!busy} onClick={() => longPost("render", {}, "Rendering video")}>Render video</button>
          )}
        </div>
      ) : (
        <p style={{ color: "#666", margin: "12px 0" }}>
          Read-only — this isn’t the active stage.{" "}
          <button onClick={() => setViewing(active)}>Go to active stage ({active})</button>
        </p>
      )}

      {/* Gate 1: script */}
      {viewing === "script" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          {editable ? (
            <textarea defaultValue={s.narration} style={{ width: "100%" }}
              onBlur={(e) => post("segments", { op: "editNarration", id: s.id, text: e.target.value })} />
          ) : (
            <p style={{ whiteSpace: "pre-wrap" }}>{s.narration}</p>
          )}
        </div>
      ))}

      {/* Gate 2: shotlist (image prompts) */}
      {viewing === "shotlist" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          {editable ? (
            <input defaultValue={s.shot?.imagePrompt ?? ""} style={{ width: "100%" }}
              onBlur={(e) => post("segments", { op: "editPrompt", id: s.id, prompt: e.target.value })} />
          ) : (
            <p style={{ color: s.shot ? "inherit" : "#999" }}>{s.shot?.imagePrompt ?? "— not generated yet —"}</p>
          )}
        </div>
      ))}

      {/* Gate 3: images */}
      {viewing === "images" && m.segments.map((s) => (
        <figure key={s.id} style={{ display: "inline-block", margin: 8 }}>
          {s.image
            ? <img src={`/api/assets/${slug}/images/${s.id}.png`} width={240} alt={s.id} />
            : <div style={{ width: 240, height: 135, background: "#f0f0f0", display: "grid", placeItems: "center", color: "#999" }}>not generated</div>}
          {editable && (
            <figcaption>
              <button disabled={!!busy} onClick={() => post("segments", { op: "rejectImage", id: s.id, seed: s.image?.seed ? s.image.seed + 1 : 1 })}>
                Regenerate
              </button>
            </figcaption>
          )}
        </figure>
      ))}

      {/* Gate 4: voiceover */}
      {viewing === "voiceover" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          <span>{s.narration.slice(0, 40)}… </span>
          {s.audio
            ? <audio controls src={`/api/assets/${slug}/audio/${s.id}.wav`} />
            : <span style={{ color: "#999" }}>— not generated yet —</span>}
          {editable && (
            <button disabled={!!busy} onClick={() => post("segments", { op: "rejectAudio", id: s.id })}>Re-record</button>
          )}
        </div>
      ))}

      {/* Gate 5: assemble */}
      {viewing === "assemble" && (
        <p style={{ color: "#666" }}>
          {m.timeline
            ? `Timeline ready: ${m.segments.length} segments, ${m.timeline.totalDurationSec.toFixed(1)}s @ ${m.timeline.fps}fps.`
            : "Run assemble to derive the timeline, then Render video."}
        </p>
      )}
    </main>
  );
}
