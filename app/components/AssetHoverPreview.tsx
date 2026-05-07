"use client";

import {
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * 2.5× zoomed asset preview that pops up after a 400 ms hover. Listens
 * on the supplied `targetRef` for pointer/drag events and renders a
 * `position: fixed` portal-style div next to the card. Pointer-events
 * are disabled on the preview so it never steals hovers from the card
 * itself. Suppressed via the `suppressed` flag (select mode, drag in
 * progress).
 */

const SHOW_DELAY_MS = 400;
const SAFE_PADDING_PX = 8;
const ANCHOR_OFFSET_PX = 8;
const SCALE = 2.5;

type Placement = "left" | "right";

export function AssetHoverPreview({
  targetRef,
  src,
  alt,
  isTile = false,
  suppressed = false,
}: {
  targetRef: RefObject<HTMLElement | null>;
  src: string;
  alt: string;
  /** Tile assets render as a 3×3 repeated background, matching the card
   *  preview, so users can judge seamless tiling at zoom. */
  isTile?: boolean;
  suppressed?: boolean;
}) {
  const timerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  } | null>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    function clearTimer() {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
    function close() {
      clearTimer();
      setOpen(false);
      setAnchor(null);
      setPos(null);
    }
    function onEnter() {
      if (suppressed) return;
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        const t = targetRef.current;
        if (!t) return;
        const r = t.getBoundingClientRect();
        setAnchor({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        });
        setOpen(true);
      }, SHOW_DELAY_MS);
    }

    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", close);
    el.addEventListener("dragstart", close);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", close);
      el.removeEventListener("dragstart", close);
      clearTimer();
    };
  }, [targetRef, suppressed]);

  // Flipping suppressed on while open should retract the preview.
  useEffect(() => {
    if (!suppressed) return;
    setOpen(false);
    setAnchor(null);
    setPos(null);
  }, [suppressed]);

  // Close on any scroll while open — fixed-position preview would
  // otherwise drift away from the card as the gallery scrolls.
  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
      setAnchor(null);
      setPos(null);
    }
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const previewW = anchor.width * SCALE;
    const previewH = anchor.height * SCALE;

    let placement: Placement = "right";
    if (anchor.right + ANCHOR_OFFSET_PX + previewW > vw - SAFE_PADDING_PX) {
      placement = "left";
    }
    let left =
      placement === "right"
        ? anchor.right + ANCHOR_OFFSET_PX
        : anchor.left - ANCHOR_OFFSET_PX - previewW;
    left = Math.max(
      SAFE_PADDING_PX,
      Math.min(vw - previewW - SAFE_PADDING_PX, left)
    );
    let top = anchor.top + (anchor.height - previewH) / 2;
    top = Math.max(
      SAFE_PADDING_PX,
      Math.min(vh - previewH - SAFE_PADDING_PX, top)
    );
    setPos({ left, top, width: previewW, height: previewH });
  }, [open, anchor]);

  if (!open || !pos) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        height: pos.height,
        pointerEvents: "none",
        zIndex: 78,
      }}
      className="bg-farm-ink border-2 border-farm-wood shadow-2xl p-1"
    >
      {isTile ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            backgroundImage: `url(${src})`,
            backgroundSize: "33.333% 33.333%",
            backgroundRepeat: "repeat",
            imageRendering: "pixelated",
          }}
        />
      ) : (
        <div className="w-full h-full bg-checker flex items-center justify-center overflow-hidden">
          <img
            src={src}
            alt={alt}
            className="pixelated max-w-full max-h-full"
          />
        </div>
      )}
    </div>
  );
}
