"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { ReadinessMeter } from "./readiness-meter";
import type { CareBoard, CareEntry, HandoverAnalysis, SourceMeta } from "@/lib/types";

type Snapshot = { board: CareBoard; entries: CareEntry[]; analysis: HandoverAnalysis; seal: string | null };

const KINDS = ["dose", "observation", "note", "task"] as const;
const STATUSES = ["due", "given", "skipped", "blocked", "done"] as const;

const clock = (value: string | null) => (value ? new Date(value).toISOString().slice(11, 16) : "--:--");

export function BoardPanel({ boardId, initial }: { boardId: string; initial: Snapshot }) {
  const router = useRouter();
  const params = useSearchParams();
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const kind = params.get("kind") ?? "all";
  const status = params.get("status") ?? "all";

  const filtered = useMemo(
    () =>
      snapshot.entries.filter(
        (entry) => (kind === "all" || entry.kind === kind) && (status === "all" || entry.status === status),
      ),
    [snapshot.entries, kind, status],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}`, { cache: "no-store" });
      const payload = (await response.json()) as { ok: boolean; data?: Snapshot; error?: { message: string } };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The board could not be loaded.");
        return;
      }
      setSnapshot(payload.data);
    } catch {
      setError("The request never reached the server.");
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const response = await fetch(`/api/boards/${boardId}`, { cache: "no-store" });
      const payload = (await response.json()) as { ok: boolean; data?: Snapshot; error?: { message: string } };
      if (!active) return;
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The board could not be loaded.");
        setLoading(false);
        return;
      }
      setSnapshot(payload.data);
      setLoading(false);
    };
    void run().catch(() => {
      if (active) {
        setError("The request never reached the server.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [boardId]);

  function setFilter(key: "kind" | "status", value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete(key);
    else next.set(key, value);
    router.replace(`/boards/${boardId}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  }

  async function decide(entry: CareEntry, nextStatus: string) {
    setNotice(null);
    setError(null);
    const previous = snapshot.entries;
    // Optimistic: the rollback below is what makes this honest.
    setSnapshot({
      ...snapshot,
      entries: previous.map((item) =>
        item.id === entry.id
          ? { ...item, status: nextStatus as CareEntry["status"], occurredAt: nextStatus === "given" ? new Date().toISOString() : item.occurredAt }
          : item,
      ),
    });
    try {
      const response = await fetch(`/api/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boardId, status: nextStatus }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!response.ok || !payload.ok) {
        setSnapshot({ ...snapshot, entries: previous });
        setError(payload.error?.message ?? "The change was rejected and has been rolled back.");
        return;
      }
      setNotice(`${entry.title} marked ${nextStatus}. A sealed audit event was appended.`);
      await refresh();
    } catch {
      setSnapshot({ ...snapshot, entries: previous });
      setError("The request never reached the server, so the change was rolled back.");
    }
  }

  async function remove(entry: CareEntry) {
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/entries/${entry.id}?boardId=${boardId}&confirm=${entry.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!response.ok || !payload.ok) {
        setError(payload.error?.message ?? "The entry was not deleted.");
        return;
      }
      setNotice(`${entry.title} is now a tombstone. Its seal chain still replays.`);
      await refresh();
    } catch {
      setError("The request never reached the server, so nothing was deleted.");
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_360px]">
      <section aria-labelledby="board-title" className="order-2 lg:order-1">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 id="board-title" className="font-display text-3xl tracking-tight text-chalk">
              {snapshot.board.subjectName}
            </h1>
            {snapshot.board.wardNote ? (
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-chalk-dim">{snapshot.board.wardNote}</p>
            ) : null}
            <p className="mt-3 font-mono text-xs text-chalk-faint">
              caregivers: {snapshot.board.caregivers.join(", ") || "nobody named yet"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setComposing((value) => !value)}
              aria-expanded={composing}
              className="inline-flex items-center gap-2 border border-lamp-400 bg-lamp-400 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950 hover:bg-lamp-300"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Log an entry
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex items-center gap-2 border border-ward-600 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Refresh
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {["all", ...KINDS].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter("kind", option)}
              aria-pressed={kind === option}
              className={`stamp ${kind === option ? "text-lamp-300" : "text-chalk-faint hover:text-chalk"}`}
            >
              {option}
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-ward-700" aria-hidden="true" />
          {["all", ...STATUSES].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter("status", option)}
              aria-pressed={status === option}
              className={`stamp ${status === option ? "text-lamp-300" : "text-chalk-faint hover:text-chalk"}`}
            >
              {option}
            </button>
          ))}
        </div>

        {error ? (
          <p role="alert" data-testid="board-feedback" className="mt-4 border border-alert-dim bg-alert/10 p-3 text-sm text-alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" data-testid="board-feedback" className="mt-4 border border-mint-dim bg-mint/10 p-3 text-sm text-mint">
            {notice}
          </p>
        ) : null}

        {composing ? (
          <NewEntryForm
            boardId={boardId}
            onCreated={async (created) => {
              setComposing(false);
              setNotice(`Logged "${created.title}". Seal ${created.seal?.slice(0, 12)}...`);
              await refresh();
            }}
            onCancel={() => setComposing(false)}
          />
        ) : null}

        {filtered.length === 0 ? (
          <div className="card mt-6 p-8 text-center">
            <p className="font-display text-xl text-chalk">Nothing matches this filter</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-chalk-dim">
              {snapshot.entries.length === 0
                ? "This board has no entries yet. Log the first dose or observation to make it handable."
                : `The board holds ${snapshot.entries.length} entries, but none match kind "${kind}" and status "${status}".`}
            </p>
          </div>
        ) : (
          <ol className="mt-6 space-y-3">
            {filtered.map((entry) => (
              <li key={entry.id} className="pin p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-chalk-faint">
                      {clock(entry.occurredAt ?? entry.scheduledFor)} &middot; {entry.kind} &middot;{" "}
                      {entry.assignedTo ? `owner ${entry.assignedTo}` : "no owner"}
                    </p>
                    <p className="mt-1 font-display text-lg leading-snug text-chalk">{entry.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-chalk-dim">{entry.detail}</p>
                    <p className="mt-2 flex flex-wrap gap-2 text-xs text-chalk-faint">
                      {entry.doseAmount ? <span className="stamp">dose {entry.doseAmount}</span> : null}
                      {entry.route ? <span className="stamp">route {entry.route}</span> : null}
                      {entry.instructions ? <span className="stamp stamp--caution">{entry.instructions}</span> : null}
                      {entry.source !== "manual" ? <span className="stamp">via {entry.source}</span> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span
                      className={`stamp ${
                        entry.status === "given" || entry.status === "done"
                          ? "stamp--ready"
                          : entry.status === "skipped" || entry.status === "blocked"
                            ? "stamp--hold"
                            : "stamp--caution"
                      }`}
                    >
                      {entry.status}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void decide(entry, "given")}
                        aria-label={`Mark "${entry.title}" as given`}
                        className="border border-ward-600 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-chalk-dim hover:border-mint hover:text-mint"
                      >
                        given
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(entry, "blocked")}
                        aria-label={`Mark "${entry.title}" as blocked`}
                        className="border border-ward-600 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-chalk-dim hover:border-alert hover:text-alert"
                      >
                        blocked
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(entry)}
                        aria-label={`Delete ${entry.title}`}
                        className="border border-ward-600 px-2 py-1 text-chalk-dim hover:border-alert hover:text-alert"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="order-1 space-y-4 lg:order-2">
        <ReadinessMeter analysis={snapshot.analysis} />
        <div className="card p-5">
          <p className="stamp stamp--caution">Seal</p>
          <p className="mt-3 break-all font-mono text-[11px] leading-relaxed text-chalk-dim">
            {snapshot.seal ?? "no events sealed yet"}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <a
              href={`/handover?board=${snapshot.board.id}`}
              className="border border-ward-600 px-3 py-2 text-center font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 hover:text-lamp-300"
            >
              Run the handover
            </a>
            <a
              href={`/boards/${snapshot.board.id}/regimen`}
              className="border border-ward-600 px-3 py-2 text-center font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 hover:text-lamp-300"
            >
              Medicines and labels
            </a>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-chalk-faint">{snapshot.analysis.disclaimer}</p>
        </div>
        <SourceList sources={snapshot.analysis.sources} />
      </aside>
    </div>
  );
}

function SourceList({ sources }: { sources: SourceMeta[] }) {
  if (sources.length === 0) {
    return (
      <div className="card p-5">
        <p className="stamp stamp--hold">Sources</p>
        <p className="mt-3 text-xs leading-relaxed text-chalk-dim">
          No external label was reachable for this board, so the label factor is unscored rather than assumed
          safe.
        </p>
      </div>
    );
  }
  return (
    <div className="card p-5">
      <p className="stamp stamp--caution">Sources used</p>
      <ul className="mt-3 space-y-2">
        {sources.map((source) => (
          <li key={source.id} className="text-xs leading-relaxed text-chalk-dim">
            <span className={source.status === "live" ? "text-mint" : source.status === "cached" ? "text-lamp-300" : "text-alert"}>
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
  );
}

function NewEntryForm({
  boardId,
  onCreated,
  onCancel,
}: {
  boardId: string;
  onCreated: (created: { title: string; seal: string }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    kind: "dose",
    title: "",
    detail: "",
    medication: "",
    doseAmount: "",
    instructions: "",
    assignedTo: "",
    scheduledFor: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/entries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : null,
          recordedBy: form.assignedTo || "you",
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { entry: { title: string }; seal: string };
        error?: { message: string; details?: { message: string }[] };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The entry was not saved.");
        setBusy(false);
        return;
      }
      onCreated({ title: payload.data.entry.title, seal: payload.data.seal });
    } catch {
      setError("The request never reached the server. Nothing was saved.");
      setBusy(false);
    }
  }

  const field = "mt-1 w-full border border-ward-600 bg-ward-950 px-3 py-2 text-sm text-chalk placeholder:text-chalk-faint focus:border-lamp-400 focus:outline-none";

  return (
    <form onSubmit={submit} className="card mt-6 space-y-3 p-5">
      <p className="stamp stamp--caution">New entry</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-chalk-dim">
          Kind
          <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })} className={field}>
            {KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-chalk-dim">
          Scheduled for
          <input
            type="datetime-local"
            value={form.scheduledFor}
            onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })}
            className={field}
          />
        </label>
      </div>
      <label className="block text-xs text-chalk-dim">
        Title
        <input
          required
          maxLength={160}
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="Metformin 500 mg"
          className={field}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs text-chalk-dim">
          Medicine
          <input value={form.medication} onChange={(event) => setForm({ ...form, medication: event.target.value })} className={field} />
        </label>
        <label className="block text-xs text-chalk-dim">
          Dose
          <input value={form.doseAmount} onChange={(event) => setForm({ ...form, doseAmount: event.target.value })} placeholder="1 tablet" className={field} />
        </label>
        <label className="block text-xs text-chalk-dim">
          Owner
          <input value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })} placeholder="Priya" className={field} />
        </label>
      </div>
      <label className="block text-xs text-chalk-dim">
        Instructions
        <input
          value={form.instructions}
          onChange={(event) => setForm({ ...form, instructions: event.target.value })}
          placeholder="with food"
          className={field}
        />
      </label>
      <label className="block text-xs text-chalk-dim">
        Note
        <textarea
          value={form.detail}
          onChange={(event) => setForm({ ...form, detail: event.target.value })}
          rows={2}
          placeholder="What actually happened"
          className={field}
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="border border-lamp-400 bg-lamp-400 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-ward-950 hover:bg-lamp-300 disabled:opacity-60"
        >
          {busy ? "Saving" : "Save and seal"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-ward-600 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk-dim hover:border-chalk"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}