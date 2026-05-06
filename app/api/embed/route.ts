import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Body: { texts: string[] }
 *  Returns: { embeddings: number[][] }
 *
 *  Wraps OpenAI's text-embedding-3-small (1536 dims, ~$0.02 / 1M tokens).
 *  Used by Pixel Play to vector-index every newly-created asset's
 *  description so the gallery search can do semantic match when no
 *  substring hits — Hermes-style "every artifact knows what it is."
 *
 *  Cheap call. Each text is typically 5–30 tokens; a project of 200
 *  assets costs roughly ~$0.0001 to fully index.
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
    .map((t) => t.slice(0, 400));
  if (texts.length === 0) {
    return NextResponse.json({ error: "texts[] is required" }, { status: 400 });
  }
  const userKey = req.headers.get("x-openai-key")?.trim() || "";
  const apiKey = userKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "No OpenAI API key. Open ⚙ Settings and paste your key." },
      { status: 401 }
    );
  }
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small",
        input: texts,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Embed ${res.status}: ${text.slice(0, 300)}` },
        { status: 502 }
      );
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embeddings = (json.data || [])
      .map((d) => d.embedding)
      .filter((e): e is number[] => Array.isArray(e));
    return NextResponse.json({ embeddings });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
