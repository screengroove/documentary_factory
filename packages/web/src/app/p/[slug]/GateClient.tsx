"use client";
import { useState } from "react";
import type { Manifest, StageName } from "@doc/core";

const ORDER: StageName[] = ["script", "shotlist", "images", "voiceover", "assemble"];

export function GateClient({ slug, initial }: { slug: string; initial: Manifest }) {
  const [m, setM] = useState(initial);
  const refresh = async () =>
    setM(await (await fetch(`/api/projects/${slug}/manifest`)).json());

  const post = async (path: string, body: unknown) => {
    await fetch(`/api/projects/${slug}/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
  };

  // Current stage = first non-approved stage.
  const current = ORDER.find((s) => m.stages[s].status !== "approved") ?? "assemble";

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1>{slug}</h1>
      <p>Current stage: <b>{current}</b> — status: {m.stages[current].status}</p>
      {m.stages[current].error && <p style={{ color: "crimson" }}>Error: {m.stages[current].error}</p>}

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button onClick={() => post("run", { stage: current })}>Run “{current}”</button>
        <button onClick={() => post("approve", { stage: current })}>Approve “{current}”</button>
        {current === "assemble" && m.stages.voiceover.status === "approved" && (
          <button onClick={() => post("render", {})}>Render video</button>
        )}
      </div>

      {/* Gate 1: script editor */}
      {current === "script" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          <textarea defaultValue={s.narration} style={{ width: "100%" }}
            onBlur={(e) => post("segments", { op: "editNarration", id: s.id, text: e.target.value })} />
        </div>
      ))}

      {/* Gate 2: prompt editor */}
      {current === "shotlist" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          <input defaultValue={s.shot?.imagePrompt ?? ""} style={{ width: "100%" }}
            onBlur={(e) => post("segments", { op: "editPrompt", id: s.id, prompt: e.target.value })} />
        </div>
      ))}

      {/* Gate 3: image gallery */}
      {current === "images" && m.segments.map((s) => (
        <figure key={s.id} style={{ display: "inline-block", margin: 8 }}>
          {s.image && <img src={`/api/assets/${slug}/images/${s.id}.png`} width={240} alt={s.id} />}
          <figcaption>
            <button onClick={() => post("segments", { op: "rejectImage", id: s.id, seed: s.image?.seed ? s.image.seed + 1 : 1 })}>
              Regenerate
            </button>
          </figcaption>
        </figure>
      ))}

      {/* Gate 4: audio review */}
      {current === "voiceover" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          <span>{s.narration.slice(0, 40)}… </span>
          {s.audio && <audio controls src={`/api/assets/${slug}/audio/${s.id}.wav`} />}
          <button onClick={() => post("segments", { op: "rejectAudio", id: s.id })}>Re-record</button>
        </div>
      ))}
    </main>
  );
}
