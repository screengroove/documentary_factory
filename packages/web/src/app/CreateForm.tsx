"use client";
import { useState } from "react";

export function CreateForm() {
  const [topic, setTopic] = useState("");
  const submit = async () => {
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
    <div style={{ marginTop: 16 }}>
      <input placeholder="Documentary topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <button onClick={submit} disabled={!topic}>Create</button>
    </div>
  );
}
