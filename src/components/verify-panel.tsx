"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { AuditEvent, IntegrityReport } from "@/lib/types";

type Props = { boards: { id: string; subjectName: string }[] };

export function VerifyPanel({ boards }: Props) {
  const params = useSearchParams();
  const boardId = params.get("board") ?? boards[0]?.id ?? "";
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replay = useCallback(async () => {
    if (!boardId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/integrity?log=1`, { cache: "no-store" });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { report: IntegrityReport; events: AuditEvent[] };
        error?: { message: string };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The chain could not be replayed.");
        return;
      }
      setReport(payload.data.report);
      setEvents(payload.data.events);
    } catch {
      setError("The request never reached the server.");
    } finally {
      setBusy(false);
    }
  }, [boardId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!boardId) return;
      const response = await fetch(`/api/boards/${boardId}/integrity?log=1`, { cache: "no-store" });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { report: IntegrityReport; events: AuditEvent[] };
        error?: { message: string };
      };
      if (!active) return;
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The chain could not be replayed.");
        setBusy(false);
        return;
      }
      setReport(payload.data.report);
      setEvents(payload.data.events);
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
  }, [boardId]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="stamp stamp--hold">Append-only</p>
      <h1 className="mt-3 font-display text-3xl tracking-tight text-chalk">Replay the seal chain</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-chalk-dim">
        Every create, update, decision and sealed handover appends one row. Each row stores{" "}
        <code className="font-mono text-lamp-300">SHA-384(previousSeal || canonicalJson(event))</code>, so a
        rewritten row breaks the link at a known sequence number instead of quietly changing the past.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <select
          value={boardId}
          onChange={(event) => {
            const next = new URLSearchParams(params.toString());
            next.set("board", event.target.value);
            window.history.replaceState(null, "", `?${next}`);
            void replay();
          }}
          className="border border-ward-600 bg-ward-950 px-3 py-2 font-mono text-xs text-chalk focus:border-lamp-400 focus:outline-none"
          aria-label="Board to verify"
        >
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.subjectName}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void replay()}
          disabled={busy}
          className="inline-flex items-center gap-2 border border-lamp-400 bg-lamp-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950 hover:bg-lamp-300 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Replay now
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 border border-alert-dim bg-alert/10 p-3 text-sm text-alert">
          {error}
        </p>
      ) : null}

      {report ? (
        <section
          className={`card mt-6 p-5 ${report.ok ? "border-mint-dim" : "border-alert-dim"}`}
          aria-live="polite"
        >
          <p className={`stamp ${report.ok ? "stamp--ready" : "stamp--hold"}`}>
            {report.ok ? "chain intact" : "chain broken"}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-chalk-dim">
            {report.ok
              ? `${report.checkedEvents} events replayed with no broken link. Head seal below.`
              : `First broken link at seq ${report.firstBrokenSeq}: ${report.reason}`}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="stamp stamp--caution">Events</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-chalk">{report.checkedEvents}</dd>
            </div>
            <div>
              <dt className="stamp stamp--caution">First broken</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums text-chalk">
                {report.firstBrokenSeq ?? "none"}
              </dd>
            </div>
            <div className="sm:col-span-1">
              <dt className="stamp stamp--caution">Head seal</dt>
              <dd className="mt-1 break-all font-mono text-[11px] text-chalk-dim">
                {report.headSeal ?? "empty chain"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="mt-6">
          <p className="stamp stamp--caution">Event log</p>
          <ol className="mt-3 space-y-2">
            {events.map((event) => (
              <li key={event.id} className="border border-ward-700 bg-ward-900 p-3">
                <p className="font-mono text-xs text-chalk-faint">
                  seq {event.seq} &middot; {event.at} &middot; actor {event.actor}
                </p>
                <p className="mt-1 text-sm text-chalk">{event.type}</p>
                <p className="mt-1 break-all font-mono text-[11px] text-chalk-faint">
                  {event.prevSeal.slice(0, 16)}... &rarr; {event.seal.slice(0, 16)}...
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}