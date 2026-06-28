import { NextResponse } from "next/server";
import { join } from "node:path";
import { uploadStillImage } from "@/lib/edits";
import { PROJECTS_ROOT } from "@/lib/projects";

// Accepted upload types → stored file extension (format preserved).
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 10 * 1024 * 1024;

// Replace a still's image with a user-uploaded file (multipart: file, id, stillIndex).
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const id = form.get("id");
    const stillIndex = Number(form.get("stillIndex"));
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (typeof id !== "string" || !Number.isInteger(stillIndex)) return NextResponse.json({ error: "id and stillIndex required" }, { status: 400 });
    const ext = EXT[file.type];
    if (!ext) return NextResponse.json({ error: `unsupported type "${file.type}" (png, jpeg, webp only)` }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    uploadStillImage(join(PROJECTS_ROOT, slug), id, stillIndex, { bytes, ext });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
