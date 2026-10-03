"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Lock, RotateCcw } from "lucide-react";
import { VerdictStamp } from "./readiness-meter";
import type { CareEntry, HandoverBrief } from "@/lib/types";

type BoardOption = { id: string; subjectName: string; openDoses: number };

const STEP_MINUTES = 15;

function stamp(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

function dayLabel(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * The signature interaction.
 *
 * Drag the handover moment along the shift rail. Entries physically move from
 * the outgoing person's column into the next person's, and the readiness engine
 * re-runs for that exact moment against the real server. Nothing here is
 * decorative: the split you see is the split the brief downloads.
 */
export function HandoverScrubber({ boards, initialNow }: { boards: BoardOption[]; initialNow: string }) {
  const params = useSearchParams();
  const boardId = params.get("board") ?? boards[0]?.id ?? "";
  // Seeded from the server so the server-rendered HTML and the first client
  // render agree; `new Date()` here would be a hydration mismatch.
  const [handoverAt, setHandoverAt] = useState<string>(initialNow);
  const [brief, setBrief] = useState<HandoverBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ seal: string; seq: number } | null>(null);
  const [sealing, setSealing] = useState(false);
  const [dirty, setDirty] = useState(false);

  const window = useMemo(() => {
    const end = new Date(handoverAt).getTime();
    return { from: new Date(end - 24 * 3600_000).toISOString(), to: new Date(end + 24 * 3600_000).toISOString() };
  }, [handoverAt]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!boardId) return;
      const response = await fetch(
        `/api/boards/${boardId}/handover?handoverAt=${encodeURIComponent(handoverAt)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { brief: HandoverBrief };
        error?: { message: string };
      };
      if (!active) return;
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The brief could not be built.");
        setLoading(false);
        return;
      }
      setBrief(payload.data.brief);
      setSealed(null);
      setLoading(false);
    };
    void run().catch(() => {
      if (active) {
        setError("The request never reached the server, so the split shown may be stale.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [boardId, handoverAt]);

  function scrub(deltaMinutes: number) {
    setDirty(true);
    setHandoverAt((current) => new Date(new Date(current).getTime() + deltaMinutes * 60_000).toISOString());
  }

  async function seal() {
    if (!boardId || !brief) return;
    setSealing(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/handover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handoverAt: brief.asOf,
          note: `Scrubbed handover at ${brief.asOf}; readiness ${brief.score}/100 (${brief.verdict}).`,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { seal: string; auditSeq: number };
        error?: { message: string };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The handover was not sealed. Nothing was recorded.");
        return;
      }
      setSealed({ seal: payload.data.seal, seq: payload.data.auditSeq });
      setDirty(false);
    } catch {
      setError("The request never reached the server, so nothing was sealed.");
    } finally {
      setSealing(false);
    }
  }

  if (boards.length === 0) {
    return (
      <div className="card mx-auto mt-10 max-w-2xl p-8 text-center">
        <h2 className="font-display text-2xl text-chalk">No care board yet</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-chalk-dim">
          A handover needs something to hand over. Start a board first, then come back and scrub the shift rail.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block border border-lamp-400 bg-lamp-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950"
        >
          Open the worked example
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="stamp stamp--caution">Shift rail</p>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-chalk sm:text-4xl">
            Scrub the handover moment
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-chalk-dim">
            Move the moment the care changes hands. Every entry slides from the outgoing person to the next one,
            and the readiness engine re-runs for that exact instant on the server.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {boards.map((board) => (
            <Link
              key={board.id}
              href={`/handover?board=${board.id}`}
              aria-current={board.id === boardId ? "true" : undefined}
              className={`stamp ${board.id === boardId ? "text-lamp-300" : "text-chalk-faint hover:text-chalk"}`}
            >
              {board.subjectName.slice(0, 22)}
            </Link>
          ))}
        </div>
      </div>

      <section aria-label="Handover moment" className="card mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="stamp stamp--caution">Handover moment</p>
            <p className="mt-2 font-display text-3xl tabular-nums text-chalk">
              {dayLabel(handoverAt)} <span className="text-lamp-300">{stamp(handoverAt)}</span>
            </p>
            <p className="mt-1 font-mono text-xs text-chalk-faint">{handoverAt}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[-60, -15, 15, 60].map((delta) => (
              <button
                key={delta}
                type="button"
                onClick={() => scrub(delta)}
                className="border border-ward-600 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-chalk-dim hover:border-lamp-400 hover:text-lamp-300"
              >
                {delta > 0 ? `+${delta}` : delta}m
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setDirty(true);
                setHandoverAt(new Date().toISOString());
              }}
              className="inline-flex items-center gap-1.5 border border-ward-600 px-3 py-2 font-mono text-xs uppercase tracking-[0.12em] text-chalk-dim hover:border-lamp-400 hover:text-lamp-300"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Now
            </button>
          </div>
        </div>

        <label className="mt-5 block">
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-chalk-faint">
            Drag along the 24 hours before and after
          </span>
          <input
            type="range"
            className="mt-2 w-full"
            min={new Date(window.from).getTime()}
            max={new Date(window.to).getTime()}
            step={STEP_MINUTES * 60_000}
            value={new Date(handoverAt).getTime()}
            onChange={(event) => {
              setDirty(true);
              setHandoverAt(new Date(Number(event.target.value)).toISOString());
            }}
          />
        </label>

        {loading ? (
          <p className="mt-3 inline-flex items-center gap-2 text-xs text-chalk-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> recomputing for this moment
          </p>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="mt-4 border border-alert-dim bg-alert/10 p-3 text-sm text-alert">
          {error}
        </p>
      ) : null}

      {brief ? (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="card p-5">
              <p className="stamp stamp--ready">Readiness at this moment</p>
              <p className="mt-3 font-display text-4xl tabular-nums text-chalk">{brief.score}</p>
              <div className="mt-2">
                <VerdictStamp verdict={brief.verdict} />
              </div>
              <p className="mt-3 text-xs leading-relaxed text-chalk-dim">{brief.decision}</p>
            </div>
            <div className="card p-5">
              <p className="stamp stamp--caution">Carried by the outgoing person</p>
              <p className="mt-3 font-display text-4xl tabular-nums text-chalk">{brief.outgoing.length}</p>
              <p className="mt-2 text-xs leading-relaxed text-chalk-faint">entries stamped before the handover</p>
            </div>
            <div className="card p-5">
              <p className="stamp stamp--hold">Inherited by the next person</p>
              <p className="mt-3 font-display text-4xl tabular-nums text-chalk">{brief.incoming.length}</p>
              <p className="mt-2 text-xs leading-relaxed text-chalk-faint">entries the next person now owns</p>
            </div>
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Column title="Outgoing" subtitle="already happened or already carried" entries={brief.outgoing} tone="mint" />
            <Column title="Incoming" subtitle="what the next person starts with" entries={brief.incoming} tone="lamp" />
          </section>

          <section className="card mt-6 p-5">
            <p className="stamp stamp--caution">Say out loud before you go</p>
            {brief.blockingIssues.length === 0 ? (
              <p className="mt-3 text-sm text-chalk-dim">Nothing blocking and nothing stale at this moment.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {brief.blockingIssues.map((issue, index) => (
                  <li key={index} className="text-sm leading-relaxed text-chalk-dim">
                    {issue}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={seal}
                disabled={sealing || sealed !== null}
                className="inline-flex items-center gap-2 border border-lamp-400 bg-lamp-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950 hover:bg-lamp-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sealing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                {sealed ? "Handover sealed" : dirty ? "Seal this handover" : "Seal this handover"}
              </button>
              <a
                href={`/api/export/${brief.boardId}?format=markdown&handoverAt=${encodeURIComponent(brief.asOf)}`}
                className="border border-ward-600 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 hover:text-lamp-300"
              >
                Download .md
              </a>
              <a
                href={`/api/export/${brief.boardId}?format=html&handoverAt=${encodeURIComponent(brief.asOf)}`}
                className="border border-ward-600 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 hover:text-lamp-300"
              >
                Download printable .html
              </a>
            </div>
            {sealed ? (
              <p role="status" className="mt-4 border border-mint-dim bg-mint/10 p-3 text-xs leading-relaxed text-mint">
                Sealed as audit event #{sealed.seq}. Seal {sealed.seal}. It cannot be edited afterwards; replay it
                on the verify page.
              </p>
            ) : null}
            <p className="mt-4 text-xs leading-relaxed text-chalk-faint">{brief.disclaimer}</p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Column({
  title,
  subtitle,
  entries,
  tone,
}: {
  title: string;
  subtitle: string;
  entries: CareEntry[];
  tone: "mint" | "lamp";
}) {
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className={`stamp ${tone === "mint" ? "stamp--ready" : "stamp--caution"}`}>{title}</p>
        <span className="font-mono text-xs text-chalk-faint">{entries.length}</span>
      </div>
      <p className="mt-2 text-xs text-chalk-faint">{subtitle}</p>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-chalk-dim">Nothing in this column at this moment.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`border-l-2 bg-ward-850 px-3 py-2 ${
                tone === "mint" ? "border-mint-dim" : "border-lamp-400"
              }`}
            >
              <p className="font-mono text-[11px] text-chalk-faint">
                {stamp(entry.occurredAt ?? entry.scheduledFor ?? entry.createdAt)} &middot; {entry.status} &middot;{" "}
                {entry.assignedTo ?? "no owner"}
              </p>
              <p className="mt-1 text-sm text-chalk">{entry.title}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}