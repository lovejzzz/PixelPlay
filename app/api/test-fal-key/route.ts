import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

/** Settings-modal connection test for FAL.ai keys. POSTs an empty body
 *  to `fal.run/fal-ai/flux/schnell` — FAL checks auth before payload
 *  validation, so a bad key returns 401 and a good key returns 422
 *  (Unprocessable Entity for the missing `prompt`). Validation failure
 *  is not billed. Mirrors `/api/test-key` for OpenAI. */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-fal-key")?.trim() || "";
  if (!key) {
    return NextResponse.json({ ok: false, error: "No key provided" }, { status: 400 });
  }
  try {
    const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (res.status === 401 || res.status === 403) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { detail?: string; error?: string };
        if (j.detail) detail = j.detail;
        else if (j.error) detail = j.error;
      } catch {
        /* keep default */
      }
      return NextResponse.json({ ok: false, error: detail }, { status: 200 });
    }
    // Anything other than auth-failure means the key was accepted —
    // even a 422 validation error confirms the credential is valid.
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}
