"use client";
import { useEffect, useState } from "react";
import type { Manifest, StageName } from "@doc/core";

const ORDER: StageName[] = ["script", "shotlist", "images", "voiceover", "assemble"];
const GATE_NO: Record<StageName, string> = { script: "1", shotlist: "2", images: "3", voiceover: "4", assemble: "5" };

// The active stage is the first one not yet approved — the only stage you can act on.
function activeStage(m: Manifest): StageName {
  return ORDER.find((s) => m.stages[s].status !== "approved") ?? "assemble";
}

const STATUS_META: Record<string, { label: string; mod: string; color: string }> = {
  pending:         { label: "Pending",         mod: "badge--pending",  color: "var(--status-pending)" },
  running:         { label: "Running",         mod: "badge--running",  color: "var(--status-running)" },
  awaiting_review: { label: "Awaiting review", mod: "badge--review",   color: "var(--status-review)" },
  approved:        { label: "Approved",        mod: "badge--approved", color: "var(--status-approved)" },
  error:           { label: "Error",           mod: "badge--error",    color: "var(--status-error)" },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return <span className={`badge ${meta.mod}`}><span className="dot" />{meta.label}</span>;
}

export function GateClient({ slug, initial }: { slug: string; initial: Manifest }) {
  const [m, setM] = useState(initial);
  const [viewing, setViewing] = useState<StageName>(activeStage(initial));
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The rendered MP4 lives at <slug>/out/<slug>.mp4, served by /video. It's not
  // tracked in the manifest, so probe the route to know whether a video exists
  // (also covers reloads where a prior render is still on the volume).
  const [videoReady, setVideoReady] = useState(false);
  // Bumped after each render to bust the browser cache of the <video>/download.
  const [videoVersion, setVideoVersion] = useState(0);

  const checkVideo = async () => {
    const res = await fetch(`/api/projects/${slug}/video`, { method: "HEAD" }).catch(() => null);
    setVideoReady(!!res?.ok);
  };
  useEffect(() => { void checkVideo(); }, [slug]);

  const active = activeStage(m);
  const editable = viewing === active;
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
  // Stages persist per-segment, so poll while in flight to stream progress in.
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

  const approve = async () => {
    const man = await post("approve", { stage: active });
    setViewing(activeStage(man));
  };

  const renderVideo = async () => {
    await longPost("render", {}, "Rendering video");
    setVideoVersion((v) => v + 1);
    await checkVideo();
  };

  const viewingStatus = m.stages[viewing].status;

  return (
    <main style={{ minHeight: "100vh", background: "var(--surface-app)" }}>
      {/* Header */}
      <header style={{ padding: "32px 48px 24px", borderBottom: "1px solid var(--border-hairline)",
        background: "radial-gradient(120% 140% at 0% 0%, rgba(79,143,247,0.06), transparent 60%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <a href="/" className="mono" style={{ fontSize: 12, color: "var(--text-meta)" }}>← projects</a>
        </div>
        <h1 className="mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--text-heading)",
          letterSpacing: "-0.01em", wordBreak: "break-word" }}>{slug}</h1>
      </header>

      <div style={{ padding: "28px 48px", maxWidth: 980, display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Stage stepper */}
        <div className="ds-card" style={{ padding: "26px 20px" }}>
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            {ORDER.map((s, i) => {
              const st = m.stages[s].status;
              const meta = STATUS_META[st] ?? STATUS_META.pending;
              const isActive = s === active;
              const isViewing = s === viewing;
              const connectColor = st === "approved" ? "var(--status-approved)"
                : st === "running" ? "var(--status-running)" : "var(--border-card)";
              return (
                <button key={s} onClick={() => setViewing(s)}
                  style={{ all: "unset", cursor: "pointer", flex: 1, display: "flex", flexDirection: "column",
                    alignItems: "center", textAlign: "center", position: "relative" }}>
                  {/* left connector */}
                  {i > 0 && (
                    <span style={{ position: "absolute", top: 13, left: "-50%", right: "50%", height: 2,
                      background: connectColor, opacity: connectColor === "var(--border-card)" ? 1 : 0.5 }} />
                  )}
                  {/* node circle */}
                  <span style={{ position: "relative", zIndex: 1, width: 28, height: 28, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                    background: st === "pending" ? "var(--color-bg-elevated)" : (meta.color + "00") || "transparent",
                    backgroundColor: st === "pending" ? "var(--color-bg-elevated)"
                      : st === "approved" ? "var(--status-approved-tint)"
                      : st === "running" ? "var(--status-running-tint)"
                      : st === "awaiting_review" ? "var(--status-review-tint)"
                      : st === "error" ? "var(--status-error-tint)" : "var(--color-bg-elevated)",
                    border: `1.5px solid ${st === "pending" ? "var(--border-card)" : meta.color}`,
                    color: meta.color,
                    boxShadow: isViewing ? "0 0 0 3px var(--focus-ring)" : undefined }}>
                    {st === "approved" ? "✓"
                      : st === "error" ? "!"
                      : st === "running" ? <span style={{ width: 12, height: 12, borderRadius: "50%",
                          border: "2px solid var(--status-running)", borderTopColor: "transparent",
                          animation: "ds-spin 0.8s linear infinite" }} />
                      : st === "awaiting_review" ? <span style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
                      : <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{GATE_NO[s]}</span>}
                  </span>
                  <span style={{ marginTop: 10, fontSize: 12, fontWeight: 600,
                    color: st === "pending" ? "var(--text-meta)" : "var(--text-heading)" }}>
                    {isActive ? "▶ " : ""}{s}
                  </span>
                  <span className="mono" style={{ fontSize: 10, marginTop: 2, color: meta.color }}>{st}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Gate header + nav */}
        <div className="ds-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="chip">Gate {GATE_NO[viewing]}</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-heading)", letterSpacing: "-0.01em" }}>
                {viewing}{editable ? "" : " · read-only"}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button className="btn btn--ghost btn--sm" disabled={viewIdx === 0}
                  onClick={() => setViewing(ORDER[viewIdx - 1])}>‹ Prev</button>
                <button className="btn btn--ghost btn--sm" disabled={viewIdx === ORDER.length - 1}
                  onClick={() => setViewing(ORDER[viewIdx + 1])}>Next ›</button>
              </div>
            </div>
          </div>
          <StatusBadge status={viewingStatus} />
        </div>

        {/* Messages */}
        {m.stages[viewing].error && (
          <div className="ds-card" style={{ padding: "12px 16px", borderColor: "var(--status-error-border)",
            background: "var(--status-error-tint)", color: "var(--status-error)" }}>
            Error: {m.stages[viewing].error}
          </div>
        )}
        {actionError && (
          <div className="ds-card" style={{ padding: "12px 16px", borderColor: "var(--status-error-border)",
            background: "var(--status-error-tint)", color: "var(--status-error)" }}>
            Action failed: {actionError}
          </div>
        )}
        {busy && (
          <div className="ds-card" style={{ padding: "12px 16px", borderColor: "var(--status-running-border)",
            background: "var(--status-running-tint)", color: "var(--status-running)", display: "flex",
            alignItems: "center", gap: 10 }}>
            <span style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid var(--status-running)",
              borderTopColor: "transparent", animation: "ds-spin 0.8s linear infinite" }} />
            {busy} — this can take a minute or two; results stream in as they finish.
          </div>
        )}

        {/* Action bar */}
        {editable ? (
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn--primary" disabled={!!busy}
              onClick={() => longPost("run", { stage: active }, `Running “${active}”`)}>Run “{active}”</button>
            <button className="btn btn--secondary" disabled={!!busy} onClick={approve}>Approve “{active}”</button>
            {active === "assemble" && m.stages.voiceover.status === "approved" && (
              <button className="btn btn--primary" disabled={!!busy}
                onClick={renderVideo}>{videoReady ? "Re-render video" : "Render video"}</button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text-meta)", fontSize: 13 }}>
            Read-only — this isn’t the active stage.
            <button className="btn btn--secondary btn--sm" onClick={() => setViewing(active)}>Go to active ({active})</button>
          </div>
        )}

        {/* ── Panels ── */}
        {/* Gate 1: script */}
        {viewing === "script" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {m.title && (
              <div className="ds-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8,
                borderColor: "var(--color-cyan)" }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)" }}>Title card</span>
                {editable ? (
                  <>
                    <input className="input" defaultValue={m.title.text}
                      onBlur={(e) => post("segments", { op: "editTitle", text: e.target.value })} />
                    <input className="input" placeholder="Subtitle" defaultValue={m.title.subtitle ?? ""}
                      onBlur={(e) => post("segments", { op: "editTitle", subtitle: e.target.value })} />
                  </>
                ) : (
                  <>
                    <p style={{ margin: 0, color: "var(--text-body)", fontWeight: 600 }}>{m.title.text}</p>
                    {m.title.subtitle && <p style={{ margin: 0, color: "var(--text-meta)" }}>{m.title.subtitle}</p>}
                  </>
                )}
              </div>
            )}
            {m.segments.map((s) => (
              <div key={s.id} className="ds-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)" }}>{s.id}</span>
                {editable
                  ? <textarea className="textarea" rows={3} defaultValue={s.narration}
                      onBlur={(e) => post("segments", { op: "editNarration", id: s.id, text: e.target.value })} />
                  : <p style={{ margin: 0, whiteSpace: "pre-wrap", color: "var(--text-body)", lineHeight: 1.55 }}>{s.narration}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Gate 2: shotlist */}
        {viewing === "shotlist" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {m.segments.map((s) => (
              <div key={s.id} className="ds-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)" }}>{s.id}</span>
                {(s.stills ?? []).length === 0
                  ? <p style={{ margin: 0, color: "var(--text-disabled)" }}>— not generated yet —</p>
                  : (s.stills ?? []).map((st, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--text-meta)", flex: "none", width: 32 }}>#{i + 1}</span>
                        {editable
                          ? <input className="input" style={{ flex: 1 }} defaultValue={st.imagePrompt}
                              onBlur={(e) => post("segments", { op: "editPrompt", id: s.id, stillIndex: i, prompt: e.target.value })} />
                          : <p style={{ margin: 0, flex: 1, color: "var(--text-body)" }}>{st.imagePrompt}</p>}
                      </div>
                    ))}
              </div>
            ))}
          </div>
        )}

        {/* Gate 3: images — one labeled row of still figures per segment */}
        {viewing === "images" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {m.title && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)" }}>Title card</span>
                <figure className="ds-card" style={{ margin: 0, padding: 10, overflow: "hidden", maxWidth: 360 }}>
                  {m.title.image
                    ? <img src={`/api/assets/${slug}/images/title.png`} alt="Title card"
                        style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block",
                          border: "1px solid var(--border-hairline)" }} />
                    : <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: "var(--radius-sm)",
                        background: "var(--surface-code)", border: "1px solid var(--border-hairline)", display: "grid",
                        placeItems: "center", color: "var(--text-disabled)", fontSize: 12 }}>not generated</div>}
                  <figcaption style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginTop: 8 }}>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-meta)" }}>{m.title.text}</span>
                    {editable && (
                      <button className="btn btn--secondary btn--sm" disabled={!!busy}
                        onClick={() => post("segments", { op: "rejectTitleImage" })}>
                        ⟳ Regenerate</button>
                    )}
                  </figcaption>
                </figure>
              </div>
            )}
            {m.segments.map((s) => (
              <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)" }}>{s.id}</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
                  {(s.stills ?? []).map((st, i) => (
                    <figure key={i} className="ds-card" style={{ margin: 0, padding: 10, overflow: "hidden" }}>
                      {st.image
                        ? <img src={`/api/assets/${slug}/images/${s.id}-${i}.png`} alt={`${s.id} #${i + 1}`}
                            style={{ width: "100%", borderRadius: "var(--radius-sm)", display: "block",
                              border: "1px solid var(--border-hairline)" }} />
                        : <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: "var(--radius-sm)",
                            background: "var(--surface-code)", border: "1px solid var(--border-hairline)", display: "grid",
                            placeItems: "center", color: "var(--text-disabled)", fontSize: 12 }}>not generated</div>}
                      <figcaption style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginTop: 8 }}>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-meta)" }}>#{i + 1}</span>
                        {editable && (
                          <button className="btn btn--secondary btn--sm" disabled={!!busy}
                            onClick={() => post("segments", { op: "rejectImage", id: s.id, stillIndex: i, seed: st.image?.seed ? st.image.seed + 1 : 1 })}>
                            ⟳ Regenerate</button>
                        )}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Gate 4: voiceover */}
        {viewing === "voiceover" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {m.segments.map((s) => (
              <div key={s.id} className="ds-card" style={{ padding: 14, display: "flex", alignItems: "center",
                gap: 14, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)", flex: "none" }}>{s.id}</span>
                <span style={{ flex: 1, minWidth: 160, color: "var(--text-body)" }}>{s.narration.slice(0, 56)}…</span>
                {s.audio
                  ? <audio controls src={`/api/assets/${slug}/audio/${s.id}.wav`} style={{ height: 34 }} />
                  : <span style={{ color: "var(--text-disabled)", fontSize: 13 }}>— not generated yet —</span>}
                {editable && (
                  <button className="btn btn--secondary btn--sm" disabled={!!busy}
                    onClick={() => post("segments", { op: "rejectAudio", id: s.id })}>Re-record</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Gate 5: assemble */}
        {viewing === "assemble" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="ds-card" style={{ padding: 20, color: "var(--text-body)" }}>
              {m.timeline
                ? <span className="mono" style={{ color: "var(--color-cyan)", fontSize: 13 }}>
                    timeline · {m.segments.length} segments · {m.timeline.totalDurationSec.toFixed(1)}s @ {m.timeline.fps}fps</span>
                : "Run assemble to derive the timeline, then Render video."}
            </div>
            {videoReady && (
              <div className="ds-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-heading)" }}>Final video</span>
                  <a className="btn btn--primary btn--sm" href={`/api/projects/${slug}/video?v=${videoVersion}`}
                    download={`${slug}.mp4`}>↓ Download MP4</a>
                </div>
                <video controls src={`/api/projects/${slug}/video?v=${videoVersion}`}
                  style={{ width: "100%", borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-hairline)", display: "block", background: "#000" }} />
              </div>
            )}
          </div>
        )}

        <div style={{ height: 16 }} />
      </div>
    </main>
  );
}
