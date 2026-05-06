import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Body: { errors: [{prompt, error}, ...], existingMemory?: string }
 *  Returns: { note: string } — a one-line markdown bullet (~80 chars)
 *  summarizing why these prompts kept failing, suitable for appending
 *  to a project's MEMORY blob.
 *
 *  Mirrors the Hermes-Agent self-improving-prompt loop: the live error→
 *  memory feedback turns recurring failure modes into one-shot lessons
 *  the model is told about on every subsequent generation. Uses
 *  gpt-4o-mini (~30 tokens in, ~30 out) so the cost is negligible.
 *
 *  If the OpenAI call fails or no key is supplied, the route falls back
 *  to a heuristic summary so the feature degrades gracefully.
 */

type ErrorEntry = { prompt: string; error: string };
type Body = {
  errors?: ErrorEntry[];
  existingMemory?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const errors = (body.errors || []).filter(
    (e) =>
      e &&
      typeof e.prompt === "string" &&
      typeof e.error === "string" &&
      e.prompt.length < 200 &&
      e.error.length < 400
  );
  if (errors.length === 0) {
    return NextResponse.json({ error: "No errors provided" }, { status: 400 });
  }
  const userKey = req.headers.get("x-openai-key")?.trim() || "";
  const apiKey = userKey || process.env.OPENAI_API_KEY || "";

  // Heuristic fallback: shared prompt prefix as a "watch out for" note.
  // Used both as a safety net AND the response when no key is present.
  const fallback = heuristicNote(errors);
  if (!apiKey) return NextResponse.json({ note: fallback });

  try {
    const sys =
      "You're improving a project memory blob. Given a list of failed " +
      "image-generation prompts and their errors, write ONE markdown " +
      "bullet (under 80 chars, single line) that warns the model what to " +
      "avoid or how to phrase. Start with '- '. No quotes around the bullet.";
    const user =
      "Recent failures:\n" +
      errors
        .slice(-3)
        .map((e, i) => `${i + 1}. prompt: ${e.prompt}\n   error: ${e.error}`)
        .join("\n");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.3,
        max_tokens: 60,
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ note: fallback });
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = (json.choices?.[0]?.message?.content || "").trim();
    if (!raw) return NextResponse.json({ note: fallback });
    // Take only the first line; cap length.
    const firstLine = raw.split("\n")[0].trim();
    const cleaned = firstLine.startsWith("- ") ? firstLine : `- ${firstLine}`;
    return NextResponse.json({ note: cleaned.slice(0, 100) });
  } catch {
    return NextResponse.json({ note: fallback });
  }
}

function heuristicNote(errors: ErrorEntry[]): string {
  // Shared prompt prefix (~first 30 chars) is the most reliable signal
  // of "the user keeps trying the same kind of thing and it fails."
  const recent = errors.slice(-3);
  const prefix = sharedPrefix(recent.map((e) => e.prompt.toLowerCase().trim()));
  const trimmed = prefix.length >= 8 ? prefix : recent[0].prompt;
  return `- Avoid: "${trimmed.slice(0, 60).trim()}" (failed 3× recently)`;
}

function sharedPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let i = 0;
  const min = Math.min(...strs.map((s) => s.length));
  while (i < min && strs.every((s) => s.charCodeAt(i) === strs[0].charCodeAt(i))) {
    i++;
  }
  return strs[0].slice(0, i);
}
