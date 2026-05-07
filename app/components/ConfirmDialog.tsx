"use client";

import { useEffect, useState } from "react";

/**
 * Promise-returning confirm dialog. Replaces browser `confirm()` in
 * destructive flows. Mount <ConfirmHost /> once near the root, then call
 * `confirm({...})` from anywhere — same module-level event-bus pattern as
 * ToastHost.
 */

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & {
  id: string;
  resolve: (ok: boolean) => void;
};

type Listener = (p: Pending) => void;
const listeners: Listener[] = [];

/** Returns a promise that resolves to true on confirm, false on cancel/dismiss. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const p: Pending = {
      ...opts,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      resolve,
    };
    if (listeners.length === 0) {
      // No host mounted — fall back to the browser dialog so call sites
      // never silently no-op during early SSR/hydration.
      resolve(typeof window !== "undefined" ? window.confirm(opts.body ? `${opts.title}\n\n${opts.body}` : opts.title) : false);
      return;
    }
    for (const l of listeners) l(p);
  });
}

/** Hook form — same shape as the module function, kept for ergonomic call sites. */
export function useConfirm() {
  return confirm;
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    const onAsk: Listener = (p) => setPending(p);
    listeners.push(onAsk);
    return () => {
      const i = listeners.indexOf(onAsk);
      if (i >= 0) listeners.splice(i, 1);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        resolve(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function resolve(ok: boolean) {
    if (!pending) return;
    pending.resolve(ok);
    setPending(null);
  }

  if (!pending) return null;

  const destructive = pending.destructive ?? true;
  const confirmLabel = pending.confirmLabel ?? (destructive ? "Delete" : "OK");
  const cancelLabel = pending.cancelLabel ?? "Cancel";
  const confirmClass = destructive
    ? "border-red-700 text-red-300 hover:bg-red-700/20"
    : "border-farm-grass text-farm-grass hover:bg-farm-grass/10";

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
      onClick={() => resolve(false)}
    >
      <div
        className="bg-farm-ink border-2 border-farm-wood w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-pixel text-lg text-farm-parchment">{pending.title}</h2>
          <button
            onClick={() => resolve(false)}
            className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2"
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {pending.body && (
          <p className="text-sm opacity-80 leading-relaxed whitespace-pre-line">
            {pending.body}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-farm-wood/40">
          <button
            type="button"
            onClick={() => resolve(false)}
            className="text-xs px-3 py-1 border border-farm-wood/60 hover:border-farm-parchment hover:text-farm-parchment"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => resolve(true)}
            className={`text-xs px-3 py-1 border ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
