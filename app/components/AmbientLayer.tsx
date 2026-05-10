"use client";

import { useEffect, useState } from "react";

/**
 * Ambient context particles for Play mode.
 *
 * Renders 8 CSS-only drifting shapes tied to the scene's parsed context
 * (derived here from the `autoBackgroundColor` set at compose-time):
 *  - interior  → soft warm-white dust motes drifting via slow Brownian sway
 *  - exterior  → green/yellow leaves drifting diagonally across the canvas
 *  - aerial    → small white clouds drifting eastward
 *
 * Mounted by ScenePlayer above tile layers and below items so the
 * particles read as atmosphere, not as game props. Pure DOM/CSS — no
 * images, no canvas, no animation library. Animations are gated behind
 * `prefers-reduced-motion` (the user's request also disables the
 * particles entirely).
 *
 * Particle positions / delays are deterministic functions of index so
 * the layer hydrates cleanly without server/client mismatch flicker.
 */
type Context = "interior" | "exterior" | "aerial" | "none";

function colorToContext(color: string | undefined): Context {
  if (!color) return "none";
  const c = color.toLowerCase();
  if (c === "#c9a779") return "interior";
  if (c === "#7cb86b") return "exterior";
  if (c === "#d6c08a") return "aerial";
  return "none";
}

const PARTICLE_COUNT = 8;

export function AmbientLayer({
  autoBackgroundColor,
}: {
  autoBackgroundColor?: string;
}) {
  // SSR-safe reduced-motion gate. We start optimistic (false) so the layer
  // can render server-side; the effect mirrors the actual media query and
  // tears down on the next paint if the user has reduce-motion on.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mql.matches);
    const onChange = () => setReduceMotion(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const ctx = colorToContext(autoBackgroundColor);
  if (ctx === "none" || reduceMotion) return null;

  const particles = Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
    // Deterministic pseudo-random scatter from index — no Math.random()
    // so SSR + hydration produce identical markup.
    const r1 = ((i * 41) % 100) / 100;
    const r2 = ((i * 73 + 7) % 100) / 100;
    return { i, r1, r2 };
  });

  if (ctx === "interior") {
    return (
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ zIndex: 1 }}
      >
        {particles.map(({ i, r1, r2 }) => (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${r1 * 100}%`,
              top: `${r2 * 100}%`,
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "rgba(255, 240, 210, 0.55)",
              boxShadow: "0 0 4px rgba(255, 240, 210, 0.4)",
              animation: `pwf-dust-mote ${10 + (i % 4)}s ${i * 0.7}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  if (ctx === "exterior") {
    const leafColors = ["#a3c46e", "#c9b962", "#7da353", "#d4b73c"];
    return (
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ zIndex: 1 }}
      >
        {particles.map(({ i, r1 }) => (
          <span
            key={i}
            style={{
              position: "absolute",
              // Spread starting points across the canvas; particles fall
              // off the bottom-right and re-enter at top-left via the
              // looping keyframe.
              left: `${r1 * 80 - 10}%`,
              top: "-5%",
              width: 3 + (i % 2),
              height: 3 + (i % 2),
              background: leafColors[i % leafColors.length],
              // Asymmetric border-radius gives a leaf-ish silhouette.
              borderRadius: "30% 70% 30% 70%",
              opacity: 0.8,
              animation: `pwf-leaf-drift ${14 + (i % 5)}s ${i * 1.5}s linear infinite`,
            }}
          />
        ))}
      </div>
    );
  }

  // aerial → drifting clouds
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 1 }}
    >
      {particles.map(({ i, r2 }) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: "-10%",
            top: `${r2 * 80}%`,
            width: 12 + (i % 3) * 4,
            height: 6 + (i % 2) * 2,
            background: "rgba(255, 255, 255, 0.7)",
            borderRadius: "50%",
            filter: "blur(1px)",
            animation: `pwf-cloud-drift ${20 + (i % 6) * 2}s ${i * 2.5}s linear infinite`,
          }}
        />
      ))}
    </div>
  );
}
