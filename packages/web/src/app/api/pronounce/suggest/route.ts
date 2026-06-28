import { NextResponse } from "next/server";
import { anthropicLlm, suggestRespelling } from "@doc/core";

// Term-only (stateless) phonetic-respelling suggestion. Runs Claude server-side
// (API key is server-only) and returns a single respelling.
export async function POST(req: Request) {
  try {
    const { term } = (await req.json()) as { term: string };
    if (!term?.trim()) return NextResponse.json({ error: "term required" }, { status: 400 });
    const llm = anthropicLlm(process.env.ANTHROPIC_API_KEY!);
    const respelling = await suggestRespelling(llm, term.trim());
    return NextResponse.json({ respelling });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
