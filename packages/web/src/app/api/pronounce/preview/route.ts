import { synthesize, DEFAULT_VOICE_ID } from "@doc/core";

// Synthesize a respelling with Kokoro (no WhisperX alignment) so the user can
// hear it before committing to a re-record. Returns a WAV the browser plays.
export async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text: string };
    if (!text?.trim()) return new Response("text required", { status: 400 });
    const audio = await synthesize(process.env.REPLICATE_API_TOKEN!, { text: text.trim(), voiceId: DEFAULT_VOICE_ID });
    return new Response(new Uint8Array(audio), { headers: { "content-type": "audio/wav" } });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
  }
}
