"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import type { DrugLookup } from "@/lib/types";

type Row = { medication: string; strength: string | null; instructions: string | null; status: string; scheduledFor: string | null };

export function RegimenPanel({
  boardId,
  subjectName,
  rows,
}: {
  boardId: string;
  subjectName: string;
  rows: Row[];
}) {
  const [lookup, setLookup] = useState<DrugLookup | null>(null);
  const [query, setQuery] = useState(rows[0]?.medication ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (name: string) => {
    if (name.trim().length < 2) {
      setError("Type at least two characters of a medicine name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/drugs/${encodeURIComponent(name.trim())}`, { cache: "no-store" });
      const payload = (await response.json()) as { ok: boolean; data?: DrugLookup; error?: { message: string } };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "No label could be retrieved.");
        return;
      }
      setLookup(payload.data);
    } catch {
      setError("The request never reached the server.");
    } finally {
      setBusy(false);
    }
  }, []);

  const firstMedication = rows[0]?.medication ?? "";

  useEffect(() => {
    if (!firstMedication) return;
    let active = true;
    const load = async () => {
      const response = await fetch(`/api/drugs/${encodeURIComponent(firstMedication)}`, { cache: "no-store" });
      const payload = (await response.json()) as { ok: boolean; data?: DrugLookup; error?: { message: string } };
      if (!active) return;
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "No label could be retrieved.");
        setBusy(false);
        return;
      }
      setLookup(payload.data);
      setBusy(false);
    };
    void load().catch(() => {
      if (active) {
        setError("The request never reached the server.");
        setBusy(false);
      }
    });
    return () => {
      active = false;
    };
  }, [firstMedication]);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_1.2fr]">
      <section aria-labelledby="regimen">
        <p className="stamp stamp--caution">Regimen</p>
        <h1 id="regimen" className="mt-3 font-display text-3xl tracking-tight text-chalk">
          Medicines on this board
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
          The list below is read from the board itself. Pick one to pull its public label from openFDA and resolve
          its concept id in NIH RxNorm.
        </p>

        <ul className="mt-5 space-y-2">
          {rows.length === 0 ? (
            <li className="card p-5 text-sm text-chalk-dim">No medicine has been logged on this board yet.</li>
          ) : (
            rows.map((row) => (
              <li key={`${row.medication}-${row.scheduledFor ?? ""}`} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg text-chalk">{row.medication}</p>
                    <p className="mt-1 font-mono text-xs text-chalk-faint">
                      {row.strength ?? "no strength"} &middot; {row.instructions ?? "no instruction"} &middot;{" "}
                      {row.status}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery(row.medication);
                      void run(row.medication);
                    }}
                    className="border border-ward-600 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-chalk-dim hover:border-lamp-400 hover:text-lamp-300"
                  >
                    Look up
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>

        <Link
          href={`/boards/${boardId}`}
          className="mt-5 inline-block text-xs text-chalk-faint underline underline-offset-2 hover:text-lamp-300"
        >
          Back to {subjectName}
        </Link>
      </section>

      <section aria-labelledby="label" aria-live="polite">
        <p className="stamp stamp--hold">Live public label</p>
        <h2 id="label" className="mt-3 font-display text-2xl text-chalk">
          openFDA + RxNorm
        </h2>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(query);
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Medicine name"
            placeholder="Metformin"
            className="flex-1 border border-ward-600 bg-ward-950 px-3 py-2 text-sm text-chalk focus:border-lamp-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 border border-lamp-400 bg-lamp-400 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950 hover:bg-lamp-300 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            Look up
          </button>
        </form>

        {error ? (
          <p role="alert" className="mt-4 border border-alert-dim bg-alert/10 p-3 text-sm text-alert">
            {error}
          </p>
        ) : null}

        {lookup ? (
          <div className="mt-5 space-y-4">
            <div className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-2xl text-chalk">{lookup.drug.genericName || lookup.query}</p>
                  <p className="mt-1 font-mono text-xs text-chalk-faint">
                    RxCUI {lookup.drug.rxcui ?? "unresolved"} &middot; {lookup.drug.route ?? "route unknown"}
                    {lookup.drug.manufacturer ? ` · ${lookup.drug.manufacturer}` : ""}
                  </p>
                  {lookup.drug.labelGenericName &&
                  lookup.drug.labelGenericName.toLowerCase() !== lookup.drug.genericName.toLowerCase() ? (
                    <p className="mt-2 border-l-2 border-lamp-400 pl-2 text-xs leading-relaxed text-lamp-300">
                      The label openFDA returned for this ingredient is{" "}
                      <strong>{lookup.drug.labelGenericName}</strong>, which may be a combination product. Read
                      the label that matches what is actually in the cupboard.
                    </p>
                  ) : null}
                </div>
                <span
                  className={`stamp ${
                    lookup.status === "live" ? "stamp--ready" : lookup.status === "cached" ? "stamp--caution" : "stamp--hold"
                  }`}
                >
                  {lookup.status}
                </span>
              </div>
              {lookup.ingredientTokens.length > 0 ? (
                <p className="mt-3 text-xs text-chalk-dim">
                  Ingredient tokens used by the duplicate check:{" "}
                  {lookup.ingredientTokens.map((token) => (
                    <span key={token} className="stamp mr-1">
                      {token}
                    </span>
                  ))}
                </p>
              ) : null}
              {lookup.drug.sample ? (
                <p className="mt-3 border border-alert-dim bg-alert/10 p-3 text-xs leading-relaxed text-alert">
                  This is the offline shelf. No live label was reachable, so nothing here has been inferred. The
                  engine scores this as unscored rather than safe.
                </p>
              ) : null}
            </div>

            {lookup.drug.flags.hasBoxedWarning || lookup.drug.flags.hasContraindications || lookup.drug.flags.hasInteractionsSection ? (
              <div className="card border-alert-dim p-5">
                <p className="stamp stamp--hold">Label signals present</p>
                <ul className="mt-3 space-y-1 text-sm text-chalk-dim">
                  {lookup.drug.flags.hasBoxedWarning ? <li>boxed warning section present</li> : null}
                  {lookup.drug.flags.hasContraindications ? <li>contraindications section present</li> : null}
                  {lookup.drug.flags.hasInteractionsSection ? <li>drug-interactions section present</li> : null}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-chalk-faint">
                  Presence of a section is not a finding about this person. It means the section is there for a
                  pharmacist to read with you.
                </p>
              </div>
            ) : null}

            {([
              ["Dosage and administration", lookup.drug.sections.dosage],
              ["Drug interactions", lookup.drug.sections.drugInteractions],
              ["Contraindications", lookup.drug.sections.contraindications],
              ["Warnings", lookup.drug.sections.warnings],
            ] as const)
              .filter(([, text]) => Boolean(text))
              .map(([heading, text]) => (
                <details key={heading} className="card p-4">
                  <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.12em] text-lamp-300">
                    {heading}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-chalk-dim">{text}</p>
                </details>
              ))}

            {lookup.drug.flags.monitoringTerms.length > 0 ? (
              <div className="card p-4">
                <p className="stamp stamp--caution">Monitoring terms found in this label</p>
                <p className="mt-3 flex flex-wrap gap-1">
                  {lookup.drug.flags.monitoringTerms.map((term) => (
                    <span key={term} className="stamp">
                      {term}
                    </span>
                  ))}
                </p>
              </div>
            ) : null}

            <div className="card p-4">
              <p className="stamp stamp--caution">Sources</p>
              <ul className="mt-3 space-y-2 text-xs">
                {lookup.sources.map((source) => (
                  <li key={source.id} className="text-chalk-dim">
                    <span
                      className={
                        source.status === "live"
                          ? "text-mint"
                          : source.status === "cached"
                            ? "text-lamp-300"
                            : "text-alert"
                      }
                    >
                      {source.status}
                    </span>{" "}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-ward-600 underline-offset-2 hover:text-lamp-300"
                    >
                      {source.name}
                    </a>
                    <span className="block text-chalk-faint">fetched {source.fetchedAt}</span>
                    {source.note ? <span className="block text-chalk-faint">{source.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs leading-relaxed text-chalk-faint">
              Label text is a verbatim slice of a public regulatory document, not advice. It is truncated for
              display; read the full label with the prescriber or pharmacist.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}