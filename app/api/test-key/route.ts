import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

/** Settings-modal connection test. Hits OpenAI's /v1/models with the
 *  user-supplied key and returns ok / not-ok. Cheap (~$0 — metadata
 *  endpoint, no tokens). Lives as a tiny server route because OpenAI's
 *  API doesn't send CORS headers, so a direct browser fetch can't reach
 *  it from a static page. */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-openai-key")?.trim() || "";
  if (!key) {
    return NextResponse.json({ ok: false, error: "No key provided" }, { status: 400 });
  }
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return NextResponse.json({ ok: true });
    let detail = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* keep default */
    }
    return NextResponse.json({ ok: false, error: detail }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}
