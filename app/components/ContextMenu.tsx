"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Right-click menu pinned to the cursor with viewport edge clamping.
 * Dismisses on outside click, Escape, or a menu-item click. Styled to
 * match the existing modal palette (farm-ink / farm-wood / farm-grass).
 */

const SAFE_PADDING_PX = 8;

export type ContextMenuItem = {
  label: string;
  emoji?: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(
      SAFE_PADDING_PX,
      Math.min(vw - mw - SAFE_PADDING_PX, x)
    );
    const top = Math.max(
      SAFE_PADDING_PX,
      Math.min(vh - mh - SAFE_PADDING_PX, y)
    );
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    function onPointer(e: PointerEvent) {
      const el = menuRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKey);
    // Listen on capture so we close before the next mouse interaction
    // hits a different target (e.g. another asset card right-click).
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? "visible" : "hidden",
        zIndex: 75,
      }}
      className="bg-farm-ink border-2 border-farm-wood shadow-lg min-w-[160px] py-1"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.disabled ? null : (
          <button
            key={i}
            type="button"
            role="menuitem"
            onClick={() => {
              it.onSelect();
              onClose();
            }}
            className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-farm-grass/15 ${
              it.destructive
                ? "text-red-300 hover:text-red-200"
                : "text-farm-parchment hover:text-farm-grass"
            }`}
          >
            {it.emoji ? <span className="mr-2">{it.emoji}</span> : null}
            {it.label}
          </button>
        )
      )}
    </div>
  );
}
