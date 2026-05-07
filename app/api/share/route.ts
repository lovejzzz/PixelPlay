import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Body: multipart/form-data with a single `file` field (the zip produced by
 *  the client's exportProject flow).
 *  Returns: { url, id } — public Vercel Blob URL + the random UUID key.
 *
 *  Requires BLOB_READ_WRITE_TOKEN (set automatically by Vercel when a Blob
 *  store is connected to the project). 500s with a hint if the token's
 *  missing so the user can fix the deploy.
 */

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap — projects exceeding this are
                                     // unusual and would cost noticeable storage.

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          "Sharing isn't configured on this deployment. Connect a Vercel Blob store and set BLOB_READ_WRITE_TOKEN.",
      },
      { status: 500 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data body" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Project zip too large (${file.size} bytes; max ${MAX_BYTES})` },
      { status: 413 }
    );
  }

  const id = crypto.randomUUID();
  try {
    const result = await put(`shared/${id}.zip`, file, {
      access: "public",
      contentType: "application/zip",
    });
    return NextResponse.json({ url: result.url, id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 502 }
    );
  }
}

/** GET ?id=<id> — looks up the public blob URL for a previously-uploaded
 *  share and 302-redirects to it. The client uses this to fetch a shared
 *  zip without leaking the underlying random-suffix blob URL pattern. */
export async function GET(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Sharing isn't configured on this deployment." },
      { status: 500 }
    );
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: "Missing or invalid id" }, { status: 400 });
  }
  try {
    const { blobs } = await list({ prefix: `shared/${id}`, limit: 1 });
    if (blobs.length === 0) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }
    return NextResponse.redirect(blobs[0].url, 302);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 502 }
    );
  }
}
