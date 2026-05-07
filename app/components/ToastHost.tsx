"use client";

import { useEffect, useState } from "react";

/**
 * Stacked toast notifications, top-right corner. Replaces ad-hoc `alert()`
 * calls — fire one with `toast({ message, kind })` from anywhere. The host
 * is mounted once near the root; toasts auto-dismiss after ~3.5s and can
 * be clicked to dismiss early.
 */

export type ToastKind = "info" | "success" | "error";

export type Toast = {
  id: string;
  message: string;
  kind: ToastKind;
  emoji?: string;
};

type Listener = (t: Toast) => void;
const listeners: Listener[] = [];

const KIND_EMOJI: Record<ToastKind, string> = {
  info: "ℹ️",
  success: "✓",
  error: "⚠",
};

/** Module-level fire-and-forget API. Safe to call from any component. */
export function toast(input: { message: string; kind?: ToastKind; emoji?: string }) {
  const t: Toast = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    message: input.message,
    kind: input.kind ?? "info",
    emoji: input.emoji,
  };
  for (const l of listeners) l(t);
}

const TOAST_TTL_MS = 3500;
const FADE_MS = 220;

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  const [exiting, setExiting] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onAdd: Listener = (t) => setItems((prev) => [...prev, t]);
    listeners.push(onAdd);
    return () => {
      const i = listeners.indexOf(onAdd);
      if (i >= 0) listeners.splice(i, 1);
    };
  }, []);

  function dismiss(id: string) {
    setExiting((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
      setExiting((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, FADE_MS);
  }

  useEffect(() => {
    if (items.length === 0) return;
    const timers = items
      .filter((t) => !exiting.has(t.id))
      .map((t) => window.setTimeout(() => dismiss(t.id), TOAST_TTL_MS));
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [items, exiting]);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => {
        const isExiting = exiting.has(t.id);
        const palette =
          t.kind === "error"
            ? "border-red-400 text-red-200 bg-farm-ink"
            : t.kind === "success"
            ? "border-farm-grass text-farm-grass bg-farm-ink"
            : "border-farm-parchment text-farm-parchment bg-farm-ink";
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto text-left max-w-xs px-3 py-2 border-2 ${palette} text-xs shadow-lg transition-opacity duration-200 ${
              isExiting ? "opacity-0" : "opacity-100"
            }`}
            title="Click to dismiss"
          >
            <span className="mr-1">{t.emoji ?? KIND_EMOJI[t.kind]}</span>
            {t.message}
          </button>
        );
      })}
    </div>
  );
}
