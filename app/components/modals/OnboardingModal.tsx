"use client";

import { useState } from "react";
import { ONBOARDING_STEPS } from "../../constants";

/**
 * First-visit modal — extracted from page.tsx in Phase 15 fire #90.
 * Sequential 4-step walkthrough with progress dots. Click outside the
 * panel or hit ✕ to dismiss; the last step's "Get started" button
 * also closes.
 */
export function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const isLast = step === ONBOARDING_STEPS.length - 1;
  const { title, body } = ONBOARDING_STEPS[step];
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-farm-ink animate-modal-in border-2 border-farm-wood w-full max-w-md p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="font-pixel text-lg text-farm-grass leading-snug">Welcome to Pixel Play</h2>
          <button
            onClick={onClose}
            className="text-farm-parchment/70 hover:text-farm-parchment text-xl leading-none px-2 ml-2 shrink-0"
            title="Dismiss"
          >
            ×
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-farm-parchment">{title}</p>
          <p className="text-sm opacity-80 leading-relaxed">{body}</p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-1">
            {ONBOARDING_STEPS.map((_, i) => (
              <span
                key={i}
                className={`inline-block w-2 h-2 rounded-full ${i === step ? "bg-farm-grass" : "bg-farm-wood"}`}
              />
            ))}
          </div>
          {isLast ? (
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm border border-farm-grass text-farm-grass hover:bg-farm-grass/20 font-pixel"
            >
              Get started
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="px-4 py-1.5 text-sm border border-farm-wood text-farm-parchment hover:border-farm-grass hover:text-farm-grass"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
