"use client";

import {
  ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * Hover tooltip with a 600 ms reveal delay and viewport edge clamping.
 * Wraps any element — pointer/focus events fire on a small inline-flex
 * span, so layout in the surrounding flex/grid container is preserved.
 * Uses `aria-describedby` so screen readers announce the label when the
 * trigger receives focus.
 */

const SHOW_DELAY_MS = 600;
const SAFE_PADDING_PX = 8;
const ANCHOR_OFFSET_PX = 6;

type Placement = "top" | "bottom";

export function Tooltip({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    centerX: number;
    topY: number;
    bottomY: number;
  } | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    placement: Placement;
  } | null>(null);
  const tooltipId = useId();

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function scheduleOpen() {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const el = wrapperRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setAnchor({
        centerX: rect.left + rect.width / 2,
        topY: rect.top,
        bottomY: rect.bottom,
      });
      setOpen(true);
    }, SHOW_DELAY_MS);
  }

  function close() {
    clearTimer();
    setOpen(false);
    setAnchor(null);
    setPos(null);
  }

  useEffect(() => () => clearTimer(), []);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const t = tooltipRef.current;
    if (!t) return;
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let placement: Placement = "top";
    if (
      anchor.topY - ANCHOR_OFFSET_PX - th < SAFE_PADDING_PX &&
      anchor.bottomY + ANCHOR_OFFSET_PX + th < vh - SAFE_PADDING_PX
    ) {
      placement = "bottom";
    }
    const top =
      placement === "top"
        ? anchor.topY - ANCHOR_OFFSET_PX - th
        : anchor.bottomY + ANCHOR_OFFSET_PX;
    let left = anchor.centerX - tw / 2;
    left = Math.max(
      SAFE_PADDING_PX,
      Math.min(vw - tw - SAFE_PADDING_PX, left)
    );
    setPos({ left, top, placement });
  }, [open, anchor]);

  return (
    <>
      <span
        ref={wrapperRef}
        className={`inline-flex ${className}`}
        onMouseEnter={scheduleOpen}
        onMouseLeave={close}
        onFocus={scheduleOpen}
        onBlur={close}
        aria-describedby={open ? tooltipId : undefined}
      >
        {children}
      </span>
      {open && anchor && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            visibility: pos ? "visible" : "hidden",
            pointerEvents: "none",
            zIndex: 80,
          }}
          className="px-2 py-1 bg-farm-ink border border-farm-wood text-farm-parchment text-[11px] max-w-[240px] shadow-lg whitespace-pre-line"
        >
          {label}
        </div>
      )}
    </>
  );
}
