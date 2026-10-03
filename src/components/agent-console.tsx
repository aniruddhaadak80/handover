"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Play } from "lucide-react";
import { siteConfig } from "@/lib/config";

type ToolSpec = { name: string; title: string; description: string; inputSchema: { required?: string[]; properties?: Record<string, unknown> } };

type Call = { id: number; tool: string; request: unknown; response: unknown; error: string | null; at: string };

type Props = { boards: { id: string; subjectName: string; entryCount: number }[] };

/**
 * A live JSON-RPC console against this deployment's own /api/mcp endpoint.
 * Nothing is mocked: every panel below is a real round trip.
 */
export function AgentConsole({ boards }: Props) {
  const [tools, setTools] = useState<ToolSpec[]>([]);
  const [booted, setBooted] = useState<string | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [note, setNote] = useState(
    "Discharge summary\nContinue Metformin 500 mg PO twice daily with meals.\nLevothyroxine 75 mcg once daily on an empty stomach.",
  );
  const [drugName, setDrugName] = useState("Metformin");

  const rpc = useCallback(async (method: string, params?: unknown) => {
    const response = await fetch("/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    });
    return (await response.json()) as { result?: unknown; error?: { code: number; message: string } };
  }, []);

  const discover = useCallback(async () => {
    setListing(true);
    setLogError(null);
    try {
      const init = await rpc("initialize");
      setBooted(String((init.result as { serverInfo?: { name?: string; version?: string } } | undefined)?.serverInfo?.name ?? "unknown"));
      const listed = await rpc("tools/list");
      const tools = (listed.result as { tools?: ToolSpec[] } | undefined)?.tools ?? [];
      setTools(tools);
    } catch {
      setLogError("The agent endpoint did not answer. Check that /api/mcp is reachable.");
    } finally {
      setListing(false);
    }
  }, [rpc]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const init = await rpc("initialize");
      const listed = await rpc("tools/list");
      if (!active) return;
      const info = init.result as { serverInfo?: { name?: string } } | undefined;
      setBooted(String(info?.serverInfo?.name ?? "unknown"));
      setTools((listed.result as { tools?: ToolSpec[] } | undefined)?.tools ?? []);
      setListing(false);
    };
    void run().catch(() => {
      if (active) {
        setLogError("The agent endpoint did not answer. Check that /api/mcp is reachable.");
        setListing(false);
      }
    });
    return () => {
      active = false;
    };
  }, [rpc]);

  async function run(tool: string, args: unknown) {
    setBusy(true);
    const id = calls.length + 1;
    const request = { jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } };
    try {
      const response = await rpc("tools/call", { name: tool, arguments: args });
      setCalls((current) => [
        {
          id,
          tool,
          request,
          response: response.result ?? response.error,
          error: response.error ? `${response.error.code}: ${response.error.message}` : null,
          at: new Date().toISOString(),
        },
        ...current,
      ]);
    } catch {
      setCalls((current) => [
        { id, tool, request, response: null, error: "The request never reached the server.", at: new Date().toISOString() },
        ...current,
      ]);
    } finally {
      setBusy(false);
    }
  }

  const firstBoard = boards[0];

  const presets: { tool: string; args: () => unknown; label: string; hint: string }[] = [
    {
      tool: "list_boards",
      args: () => ({}),
      label: "list_boards",
      hint: "read-only",
    },
    {
      tool: "get_board",
      args: () => ({ boardId: firstBoard?.id }),
      label: "get_board",
      hint: "read-only",
    },
    {
      tool: "analyze_handover",
      args: () => ({ boardId: firstBoard?.id }),
      label: "analyze_handover",
      hint: "runs the same engine as the UI",
    },
    {
      tool: "lookup_drug",
      args: () => ({ name: drugName || "Metformin" }),
      label: "lookup_drug",
      hint: "live openFDA + RxNorm",
    },
    {
      tool: "extract_care_rows",
      args: () => ({ note }),
      label: "extract_care_rows",
      hint: "deterministic parser",
    },
    {
      tool: "verify_integrity",
      args: () => ({ boardId: firstBoard?.id }),
      label: "verify_integrity",
      hint: "replays the hash chain",
    },
    {
      tool: "log_entry",
      args: () => ({
        boardId: firstBoard?.id,
        kind: "dose",
        status: "due",
        title: `Agent-logged dose at ${new Date().toISOString().slice(11, 16)}`,
        detail: "Written by tools/call through the same service layer as the UI.",
        medication: "Metformin 500 mg",
        doseAmount: "1 tablet",
        instructions: "with food",
        assignedTo: "agent",
        idempotencyKey: "console-demo-key-1",
      }),
      label: "log_entry",
      hint: "mutating, idempotent",
    },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1fr_1fr]">
      <section aria-labelledby="tools">
        <p className="stamp stamp--caution">JSON-RPC 2.0</p>
        <h1 id="tools" className="mt-3 font-display text-3xl tracking-tight text-chalk">
          Agent console
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-chalk-dim">
          Every button below sends a real <code className="font-mono text-lamp-300">tools/call</code> to{" "}
          <code className="font-mono text-lamp-300">{siteConfig.liveUrl}/api/mcp</code>. The mutating tool writes
          through the same service layer and seal chain the browser uses.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void discover()}
            disabled={listing}
            className="inline-flex items-center gap-2 border border-ward-600 px-3 py-2 font-mono text-xs uppercase tracking-[0.14em] text-chalk hover:border-lamp-400 disabled:opacity-60"
          >
            {listing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            initialize + tools/list
          </button>
          <span className="font-mono text-xs text-chalk-faint">
            server: {booted ?? "not initialized"} &middot; tools: {tools.length}
          </span>
        </div>

        {logError ? (
          <p role="alert" className="mt-4 border border-alert-dim bg-alert/10 p-3 text-sm text-alert">
            {logError}
          </p>
        ) : null}

        <div className="mt-4">
          <label className="block text-xs text-chalk-dim">
            Medicine name for <code className="font-mono">lookup_drug</code>
            <input
              value={drugName}
              onChange={(event) => setDrugName(event.target.value)}
              className="mt-1 w-full border border-ward-600 bg-ward-950 px-3 py-2 text-sm text-chalk focus:border-lamp-400 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-4">
          <label className="block text-xs text-chalk-dim">
            Discharge text for <code className="font-mono">extract_care_rows</code>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="mt-1 w-full border border-ward-600 bg-ward-950 px-3 py-2 font-mono text-xs text-chalk focus:border-lamp-400 focus:outline-none"
            />
          </label>
        </div>

        <ul className="mt-5 space-y-2">
          {presets.map((preset) => (
            <li key={preset.tool}>
              <button
                type="button"
                disabled={busy || tools.length === 0}
                onClick={() => void run(preset.tool, preset.args())}
                className="flex w-full items-center justify-between gap-3 border border-ward-700 bg-ward-900 px-3 py-2 text-left hover:border-lamp-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex items-center gap-2 font-mono text-xs text-chalk">
                  <Play className="h-3.5 w-3.5 text-lamp-400" aria-hidden="true" /> {preset.label}
                </span>
                <span className="font-mono text-[11px] text-chalk-faint">{preset.hint}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6 card p-5">
          <p className="stamp stamp--caution">Tool schemas</p>
          <ul className="mt-3 space-y-2">
            {tools.map((tool) => (
              <li key={tool.name} className="text-xs leading-relaxed text-chalk-dim">
                <span className="font-mono text-chalk">{tool.name}</span> &mdash; {tool.title}
                <span className="mt-0.5 block text-chalk-faint">
                  required: {(tool.inputSchema.required ?? []).join(", ") || "none"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="log" aria-live="polite">
        <p className="stamp stamp--hold">Request and response</p>
        <h2 id="log" className="mt-3 font-display text-2xl text-chalk">
          Call log
        </h2>

        {calls.length === 0 ? (
          <div className="card mt-4 p-6 text-center">
            <p className="text-sm text-chalk-dim">
              No calls yet. Press <span className="font-mono text-lamp-300">initialize + tools/list</span> then run
              any tool.
            </p>
          </div>
        ) : (
          <ol className="mt-4 space-y-3">
            {calls.map((call) => (
              <li key={call.id} className="pin p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs text-lamp-300">{call.tool}</span>
                  <span className="font-mono text-[11px] text-chalk-faint">{call.at}</span>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-chalk-dim">
                    request
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto border border-ward-700 bg-ward-950 p-2 font-mono text-[11px] text-chalk-dim">
                    {JSON.stringify(call.request, null, 2)}
                  </pre>
                </details>
                <details open className="mt-2">
                  <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-chalk-dim">
                    response
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto border border-ward-700 bg-ward-950 p-2 font-mono text-[11px] text-chalk-dim">
                    {JSON.stringify(call.response, null, 2)}
                  </pre>
                </details>
                {call.error ? (
                  <p role="alert" className="mt-2 text-xs text-alert">
                    {call.error}
                  </p>
                ) : null}
                <Link
                  href="/verify"
                  className="mt-2 inline-block text-[11px] text-chalk-faint underline underline-offset-2 hover:text-lamp-300"
                >
                  replay the chain after this mutation
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}