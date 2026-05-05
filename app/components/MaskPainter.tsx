"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Brush-paint an inpainting mask over a reference image. The output mask is
 * a same-sized PNG where painted pixels are TRANSPARENT (alpha=0). OpenAI's
 * edits endpoint will only redraw transparent regions of the mask.
 *
 * Sizing: the mask matches the reference image's natural dimensions, so the
 * server forwards it directly without resampling.
 */
export function MaskPainter({
  imageUrl,
  onMaskChange,
}: {
  imageUrl: string;
  /** Called with a data URL whenever the painted mask changes. null = empty mask. */
  onMaskChange: (maskDataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [brushSize, setBrushSize] = useState(48);
  const [isPainting, setIsPainting] = useState(false);
  const [hasPaint, setHasPaint] = useState(false);
  const [scale, setScale] = useState(1);

  // Load image and size the canvas to its natural dimensions.
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      // Clear (transparent default).
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasPaint(false);
      onMaskChange(null);
      updateScale();
    };
    img.src = imageUrl;
  }, [imageUrl, onMaskChange]);

  function updateScale() {
    const c = containerRef.current;
    const img = imageRef.current;
    if (!c || !img) return;
    const containerW = c.clientWidth;
    const ratio = containerW / img.naturalWidth;
    setScale(ratio);
  }

  useEffect(() => {
    const handler = () => updateScale();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  function pointToCanvas(e: React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function paintAt(x: number, y: number) {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(255, 80, 80, 0.7)";
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsPainting(true);
    const { x, y } = pointToCanvas(e);
    paintAt(x, y);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!isPainting) return;
    const { x, y } = pointToCanvas(e);
    paintAt(x, y);
  }

  function onPointerUp(e: React.PointerEvent) {
    setIsPainting(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    emitMask();
  }

  function emitMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Build the OpenAI mask: painted areas → fully transparent (alpha=0,
    // edit here), unpainted areas → opaque (keep as-is).
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const mctx = maskCanvas.getContext("2d")!;
    const out = mctx.createImageData(canvas.width, canvas.height);
    let painted = 0;
    for (let i = 0; i < data.data.length; i += 4) {
      const isPainted = data.data[i + 3] > 0;
      if (isPainted) {
        // Transparent in the mask → OpenAI will edit this pixel.
        out.data[i + 3] = 0;
        painted++;
      } else {
        out.data[i] = 255;
        out.data[i + 1] = 255;
        out.data[i + 2] = 255;
        out.data[i + 3] = 255;
      }
    }
    mctx.putImageData(out, 0, 0);

    if (painted === 0) {
      setHasPaint(false);
      onMaskChange(null);
    } else {
      setHasPaint(true);
      onMaskChange(maskCanvas.toDataURL("image/png"));
    }
  }

  function clearMask() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasPaint(false);
    onMaskChange(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span>Brush:</span>
          <input
            type="range"
            min={8}
            max={200}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="accent-farm-grass"
          />
          <span className="w-10 text-right">{brushSize}px</span>
        </label>
        <button
          type="button"
          onClick={clearMask}
          disabled={!hasPaint}
          className="px-2 py-0.5 border border-farm-wood/60 hover:border-red-700 hover:text-red-300 disabled:opacity-30"
        >
          Clear
        </button>
        <span className="opacity-70 ml-auto">
          {hasPaint ? "Painted area will be edited" : "Paint over the area to change"}
        </span>
      </div>
      <div
        ref={containerRef}
        className="relative border-2 border-farm-grass/50 bg-checker"
        style={{ touchAction: "none" }}
      >
        <img
          src={imageUrl}
          alt="reference"
          className="pixelated block w-full h-auto"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute inset-0 w-full h-full cursor-crosshair pixelated"
          style={{ imageRendering: "pixelated" }}
        />
        {/* Brush size cursor indicator could go here */}
        <div className="sr-only">scale: {scale.toFixed(2)}</div>
      </div>
    </div>
  );
}
