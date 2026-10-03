"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { FactorKey } from "@/lib/types";

type Settings = {
  weights: Record<FactorKey, number>;
  windowHours: number;
  caregiverName: string;
};

const LABELS: Record<FactorKey, string> = {
  dose_reconciliation: "Dose reconciliation",
  timing_risk: "Timing risk",
  duplicate_therapy: "Duplicate therapy",
  label_safety: "Label safety signals",
  handover_freshness: "Handover freshness",
  documentation: "Documentation",
};

const BLURB: Record<FactorKey, string> = {
  dose_reconciliation: "Scheduled doses against what was actually logged, including overdue and late entries.",
  timing_risk: "Two doses too close together, colliding clock times, and long gaps for the same medicine.",
  duplicate_therapy: "Two entries whose ingredient tokens resolve to the same active substance.",
  label_safety: "Boxed warnings, contraindications and interaction sections found in public label text.",
  handover_freshness: "How stale the board is, and whether every entry has a named owner.",
  documentation: "Whether each entry carries a dose amount and a note a stranger could act on.",
};

/**
 * Weights are part of the product, not a hidden constant: change one and the
 * same engine produces a different, still fully itemized, result.
 */
export function SettingsForm({ initial, defaults }: { initial: Settings; defaults: Settings }) {
  const [weights, setWeights] = useState(initial.weights);
  const [windowHours, setWindowHours] = useState(initial.windowHours);
  const [caregiverName, setCaregiverName] = useState(initial.caregiverName);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const total = (Object.keys(weights) as FactorKey[]).reduce((sum, key) => sum + weights[key], 0);

  async function save() {
    setState("saving");
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weights, windowHours, caregiverName }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!response.ok || !payload.ok) {
        setError(payload.error?.message ?? "The settings were not saved.");
        setState("error");
        return;
      }
      setState("saved");
    } catch {
      setError("The request never reached the server, so nothing was saved.");
      setState("error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="stamp stamp--caution">Method</p>
      <h1 className="mt-3 font-display text-3xl tracking-tight text-chalk">How the score is decided</h1>
      <p className="mt-3 text-sm leading-relaxed text-chalk-dim">
        The engine is a weighted mean of six factor values. Nothing is hidden and nothing is a black box: every
        penalty points at a row on your board or a section of a public label. Weights are stored against this
        browser session, so the same board can be judged two ways on purpose.
      </p>

      <ul className="mt-6 space-y-4">
        {(Object.keys(weights) as FactorKey[]).map((key) => (
          <li key={key} className="card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <label htmlFor={`w-${key}`} className="font-mono text-sm text-chalk">
                {LABELS[key]}
              </label>
              <span className="font-mono text-xs tabular-nums text-lamp-300">{weights[key].toFixed(2)}</span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-chalk-faint">{BLURB[key]}</p>
            <input
              id={`w-${key}`}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={weights[key]}
              onChange={(event) =>
                setWeights({ ...weights, [key]: Number(Number(event.target.value).toFixed(2)) })
              }
              className="mt-3 w-full"
            />
          </li>
        ))}
      </ul>

      <div className="card mt-4 p-5">
        <p className="font-mono text-xs text-chalk-dim">
          total weight: <span className={total > 0 ? "text-mint" : "text-alert"}>{total.toFixed(2)}</span>
          {total === 0 ? " - every factor is at zero, so the score will be meaningless. Raise at least one." : ""}
        </p>

        <label htmlFor="window" className="mt-4 block font-mono text-sm text-chalk">
          Schedule window: {windowHours}h either side of now
        </label>
        <input
          id="window"
          type="range"
          min={1}
          max={168}
          step={1}
          value={windowHours}
          onChange={(event) => setWindowHours(Number(event.target.value))}
          className="mt-3 w-full"
        />

        <label htmlFor="caregiver" className="mt-5 block font-mono text-sm text-chalk">
          Your name on this device
        </label>
        <input
          id="caregiver"
          value={caregiverName}
          maxLength={80}
          onChange={(event) => setCaregiverName(event.target.value)}
          placeholder="Priya"
          className="mt-1 w-full border border-ward-600 bg-ward-950 px-3 py-2 text-sm text-chalk focus:border-lamp-400 focus:outline-none"
        />
        <p className="mt-1 text-xs text-chalk-faint">
          Used as the default owner and as the audit actor. It is never sent anywhere else.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={state === "saving"}
          className="inline-flex items-center gap-2 border border-lamp-400 bg-lamp-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950 hover:bg-lamp-300 disabled:opacity-60"
        >
          {state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Save weights
        </button>
        <button
          type="button"
          onClick={() => {
            setWeights(defaults.weights);
            setWindowHours(defaults.windowHours);
            setCaregiverName(defaults.caregiverName);
            setState("idle");
          }}
          className="border border-ward-600 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk-dim hover:border-chalk hover:text-chalk"
        >
          Reset to defaults
        </button>
        {state === "saved" ? (
          <span role="status" className="text-xs text-mint">
            Saved. New analysis will use these weights.
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}