"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

type Props = { withExampleEntries: boolean; label: string; variant?: "primary" | "quiet" };

export function StartBoard({ withExampleEntries, label, variant = "primary" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/boards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectName: withExampleEntries ? "Worked example - recovery at home" : "New care board",
          wardNote: withExampleEntries
            ? "Every value on this board is invented so a stranger can see a full handover. Nothing here is medical advice."
            : "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          withExampleEntries,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: { board: { id: string } };
        error?: { message: string };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error?.message ?? "The board could not be created. Nothing was saved.");
        setBusy(false);
        return;
      }
      router.push(`/boards/${payload.data.board.id}`);
    } catch {
      setError("The request never reached the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  const styles =
    variant === "primary"
      ? "bg-lamp-400 text-ward-950 hover:bg-lamp-300 border border-lamp-400"
      : "border border-ward-600 text-chalk hover:border-lamp-400 hover:text-lamp-300";

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={`inline-flex items-center justify-center gap-2 px-5 py-3 font-mono text-xs uppercase tracking-[0.16em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${styles}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {busy ? "Creating the board" : label}
      </button>
      {error ? (
        <p role="alert" className="max-w-xs text-xs leading-relaxed text-alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}