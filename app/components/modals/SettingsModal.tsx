"use client";

import { useEffect, useState } from "react";

/** Mirror of the page.tsx local type — exported so Home can pass it to
 *  the onSave callback. Defined here because the modal owns its shape. */
export type SettingsPrefs = {
  openaiKey: string;
  falKey: string;
  imageProvider: "openai" | "fal";
};

/**
 * API-key + provider settings modal. Local-only state + a Test button
 * that hits /api/test-key and /api/test-fal-key for round-trip
 * verification. Keys live in localStorage only (never persisted server-
 * side), so "Save" is just an onSave callback into the Home component.
 *
 * Extracted from page.tsx in Phase 15 fire #90.
 */
export function SettingsModal({
  initialKey,
  initialFalKey,
  initialProvider,
  onClose,
  onSave,
}: {
  initialKey: string;
  initialFalKey: string;
  initialProvider: "openai" | "fal";
  onClose: () => void;
  onSave: (prefs: SettingsPrefs) => void;
}) {
  const [draft, setDraft] = useState(initialKey);
  const [falDraft, setFalDraft] = useState(initialFalKey);
  const [provider, setProvider] = useState<"openai" | "fal">(initialProvider);
  const [show, setShow] = useState(false);
  const [showFal, setShowFal] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg, setTestMsg] = useState("");
  const [falTestStatus, setFalTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [falTestMsg, setFalTestMsg] = useState("");

  async function testConnection() {
    const key = draft.trim();
    if (!key) {
      setTestStatus("fail");
      setTestMsg("Enter a key first.");
      return;
    }
    setTestStatus("testing");
    setTestMsg("");
    try {
      const res = await fetch("/api/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-openai-key": key },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setTestStatus("ok");
        setTestMsg("Connected. Key accepted by OpenAI.");
      } else {
        setTestStatus("fail");
        setTestMsg(data.error || "Unknown error");
      }
    } catch (err) {
      setTestStatus("fail");
      setTestMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  async function testFalConnection() {
    const key = falDraft.trim();
    if (!key) {
      setFalTestStatus("fail");
      setFalTestMsg("Enter a key first.");
      return;
    }
    setFalTestStatus("testing");
    setFalTestMsg("");
    try {
      const res = await fetch("/api/test-fal-key", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-fal-key": key },
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setFalTestStatus("ok");
        setFalTestMsg("Connected. Key accepted by FAL.");
      } else {
        setFalTestStatus("fail");
        setFalTestMsg(data.error || "Unknown error");
      }
    } catch (err) {
      setFalTestStatus("fail");
      setFalTestMsg(err instanceof Error ? err.message : "Network error");
    }
  }

  // Reset status if the user edits the key after running a test.
  useEffect(() => {
    if (testStatus !== "idle") {
      setTestStatus("idle");
      setTestMsg("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(() => {
    if (falTestStatus !== "idle") {
      setFalTestStatus("idle");
      setFalTestMsg("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [falDraft]);

  function commit(next?: Partial<SettingsPrefs>) {
    onSave({
      openaiKey: draft.trim(),
      falKey: falDraft.trim(),
      imageProvider: provider,
      ...next,
    });
  }
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-farm-ink animate-modal-in border-2 border-farm-wood w-full max-w-lg p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-pixel text-xl text-farm-grass">⚙ Settings</h2>
            <p className="text-xs opacity-70 mt-1">
              Bring your own API key. Stored in your browser only — never sent anywhere except the chosen provider.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide opacity-70">
            Image model
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            <label className="flex items-start gap-2 px-2 py-1.5 border border-farm-wood/60 hover:border-farm-grass cursor-pointer">
              <input
                type="radio"
                name="image-provider"
                value="openai"
                checked={provider === "openai"}
                onChange={() => setProvider("openai")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm">OpenAI gpt-image-1</div>
                <div className="text-[11px] opacity-60">Highest quality. ~$0.04 / image. Sprite-sheets, refs, masks.</div>
              </div>
            </label>
            <label className="flex items-start gap-2 px-2 py-1.5 border border-farm-wood/60 hover:border-farm-grass cursor-pointer">
              <input
                type="radio"
                name="image-provider"
                value="fal"
                checked={provider === "fal"}
                onChange={() => setProvider("fal")}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-sm">FAL Flux Schnell <span className="opacity-60">(fast/cheap)</span></div>
                <div className="text-[11px] opacity-60">~$0.003 / image, ~2-5s. Single images only — no sprite-sheets.</div>
              </div>
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide opacity-70">
            OpenAI API key
          </label>
          <div className="flex gap-2">
            <input
              type={show ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="sk-proj-…"
              className="flex-1 bg-farm-bg/40 border border-farm-wood text-farm-parchment text-sm px-2 py-1.5 focus:outline-none focus:border-farm-grass font-mono"
              autoFocus
            />
            <button
              onClick={() => setShow((v) => !v)}
              className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
              title={show ? "Hide" : "Show"}
            >
              {show ? "🙈" : "👁"}
            </button>
            <button
              type="button"
              onClick={testConnection}
              disabled={testStatus === "testing" || !draft.trim()}
              className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass disabled:opacity-40 disabled:cursor-not-allowed"
              title="Verify the key against OpenAI"
            >
              {testStatus === "testing" ? "⏳" : "Test"}
            </button>
          </div>
          {testStatus !== "idle" && (
            <div
              className={
                "text-[11px] " +
                (testStatus === "ok"
                  ? "text-farm-grass"
                  : testStatus === "fail"
                  ? "text-red-300"
                  : "opacity-70")
              }
            >
              {testStatus === "testing" && "Testing…"}
              {testStatus === "ok" && `✓ ${testMsg}`}
              {testStatus === "fail" && `✗ ${testMsg}`}
            </div>
          )}
          <p className="text-[11px] opacity-60">
            Get a key at{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-farm-grass"
            >
              platform.openai.com/api-keys
            </a>
            . Image generation requires{" "}
            <a
              href="https://platform.openai.com/settings/organization/general"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-farm-grass"
            >
              organization verification
            </a>
            . Your key never leaves your browser except in requests to OpenAI's API.
          </p>
        </div>

        {provider === "fal" && (
          <div className="space-y-2">
            <label className="block text-xs uppercase tracking-wide opacity-70">
              FAL API key
            </label>
            <div className="flex gap-2">
              <input
                type={showFal ? "text" : "password"}
                value={falDraft}
                onChange={(e) => setFalDraft(e.target.value)}
                placeholder="fal-key-…"
                className="flex-1 bg-farm-bg/40 border border-farm-wood text-farm-parchment text-sm px-2 py-1.5 focus:outline-none focus:border-farm-grass font-mono"
              />
              <button
                onClick={() => setShowFal((v) => !v)}
                className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass"
                title={showFal ? "Hide" : "Show"}
              >
                {showFal ? "🙈" : "👁"}
              </button>
              <button
                type="button"
                onClick={testFalConnection}
                disabled={falTestStatus === "testing" || !falDraft.trim()}
                className="px-2 py-1 text-xs border border-farm-wood/60 hover:border-farm-grass hover:text-farm-grass disabled:opacity-40 disabled:cursor-not-allowed"
                title="Verify the key against FAL"
              >
                {falTestStatus === "testing" ? "⏳" : "Test"}
              </button>
            </div>
            {falTestStatus !== "idle" && (
              <div
                className={
                  "text-[11px] " +
                  (falTestStatus === "ok"
                    ? "text-farm-grass"
                    : falTestStatus === "fail"
                    ? "text-red-300"
                    : "opacity-70")
                }
              >
                {falTestStatus === "testing" && "Testing…"}
                {falTestStatus === "ok" && `✓ ${falTestMsg}`}
                {falTestStatus === "fail" && `✗ ${falTestMsg}`}
              </div>
            )}
            <p className="text-[11px] opacity-60">
              Get a key at{" "}
              <a
                href="https://fal.ai/dashboard/keys"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-farm-grass"
              >
                fal.ai/dashboard/keys
              </a>
              . Stored in your browser only.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-farm-wood/40">
          <button
            onClick={() => {
              setDraft("");
              setFalDraft("");
              onSave({ openaiKey: "", falKey: "", imageProvider: provider });
            }}
            className="text-xs text-red-300 opacity-70 hover:opacity-100"
            title="Remove all saved keys"
          >
            Clear keys
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm border border-farm-wood/60 hover:border-farm-grass"
            >
              Cancel
            </button>
            <button
              onClick={() => commit()}
              className="px-3 py-1 text-sm border border-farm-grass bg-farm-grass/20 text-farm-grass hover:bg-farm-grass/30"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
