import { NextRequest, NextResponse } from "next/server";
import { classifyTexts } from "../../lib/classify.mjs";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Body: { texts: string[] }
 *  Returns: { categories: string[] }
 *
 *  Sibling to /api/embed. Labels each text with one category from a
 *  fixed enum (see app/lib/classify.mjs CATEGORIES). One batched
 *  gpt-4o-mini chat call per request (~$0.0003 for 5 items).
 *
 *  Falls back to a keyword heuristic when the request has no API key.
 *  The route always returns 200 with an aligned `categories` array
 *  unless the body itself is malformed.
 */
type Body = { texts?: string[] };

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const texts = (body.texts || [])
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .map((t) => t.slice(0, 200));
  if (texts.length === 0) {
    return NextResponse.json({ error: "texts[] is required" }, { status: 400 });
  }
  const userKey = req.headers.get("x-openai-key")?.trim() || "";
  const apiKey = userKey || process.env.OPENAI_API_KEY || "";
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  try {
    const categories = await classifyTexts(apiKey, texts, { model });
    return NextResponse.json({ categories });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
