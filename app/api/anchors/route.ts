import { NextRequest, NextResponse } from "next/server";
import { proposeAnchors } from "../../lib/proposeAnchors.mjs";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Body: { descriptor: string, category: string }
 *  Returns: { anchors: Array<{name, x, y, w, h}> }
 *
 *  Cheap (one gpt-4o-mini chat call, ~$0.0002). Returns [] for
 *  categories that don't naturally have surfaces (lighting, book,
 *  weapon, etc.) so the caller can skip the round-trip in bulk.
 *  Empty-key falls back to a single default "top" anchor for
 *  surface-bearing categories. */
type Body = { descriptor?: string; category?: string };

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const descriptor = typeof body.descriptor === "string" ? body.descriptor.slice(0, 200) : "";
  const category = typeof body.category === "string" ? body.category : "";
  if (!descriptor || !category) {
    return NextResponse.json({ error: "descriptor and category are required" }, { status: 400 });
  }
  const userKey = req.headers.get("x-openai-key")?.trim() || "";
  const apiKey = userKey || process.env.OPENAI_API_KEY || "";
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  try {
    const anchors = await proposeAnchors(apiKey, descriptor, category, { model });
    return NextResponse.json({ anchors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
