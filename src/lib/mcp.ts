import { z } from "zod";
import { extractCareNote } from "./engine/note-extract";
import { ENGINE_VERSION } from "./engine/readiness";
import { lookupDrug } from "./live/drugs";
import { DISCLAIMER } from "./engine/readiness";
import { boardSnapshot, buildBrief, verifyBoard } from "./service";
import {
  StoreError,
  claimIdempotencyKey,
  createEntry,
  readIdempotentResult,
  storeIdempotentResult,
} from "./repo/store";

export const PROTOCOL_VERSION = "2026-10-01";
export const SERVER_NAME = "handover-care-board";
export const SERVER_VERSION = "1.0.0";

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

const stringArray = z.array(z.string()).default([]);

const toolDefs = [
  {
    name: "list_boards",
    title: "List care boards",
    description: "Every care board owned by the calling session. Read-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_board",
    title: "Read one care board",
    description: "Full board with entries, live label lookups and the current readiness analysis. Read-only.",
    inputSchema: {
      type: "object",
      properties: { boardId: { type: "string", description: "Board id from list_boards." } },
      required: ["boardId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "analyze_handover",
    title: "Run the handover-readiness engine",
    description: `Deterministic ${ENGINE_VERSION} scoring with itemized evidence, weights and a recommendation. Same function the UI uses.`,
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string" },
        asOf: { type: "string", description: "Optional ISO-8601 reference moment. Defaults to now." },
      },
      required: ["boardId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "lookup_drug",
    title: "Look up a public drug label",
    description: "NIH RxNorm concept id plus normalized openFDA label sections, with live/fallback source status.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Medicine name, generic or brand." } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "extract_care_rows",
    title: "Draft rows from a discharge note",
    description: "Deterministic extractor over pasted discharge text. Returns reviewable rows, never saves anything.",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string", description: "Discharge summary or memo transcript." } },
      required: ["note"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "verify_integrity",
    title: "Replay the seal chain",
    description: "Rebuilds every SHA-384 link on a board and reports the first broken seq. Read-only.",
    inputSchema: {
      type: "object",
      properties: { boardId: { type: "string" } },
      required: ["boardId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "log_entry",
    title: "Log a care entry",
    description:
      "Creates a dose, observation, note or task through the same service layer the UI uses. Supports idempotencyKey so a retry cannot double-log.",
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string" },
        kind: { type: "string", enum: ["dose", "observation", "note", "task"] },
        status: { type: "string", enum: ["due", "given", "skipped", "blocked", "done"] },
        title: { type: "string" },
        detail: { type: "string" },
        medication: { type: ["string", "null"] },
        doseAmount: { type: ["string", "null"] },
        route: { type: ["string", "null"] },
        instructions: { type: ["string", "null"] },
        assignedTo: { type: ["string", "null"] },
        scheduledFor: { type: ["string", "null"] },
        occurredAt: { type: ["string", "null"] },
        idempotencyKey: { type: ["string", "null"], description: "Reuse to make a retry safe." },
      },
      required: ["boardId", "kind", "title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "update_entry_status",
    title: "Decide an entry",
    description: "Marks an entry given, skipped, blocked or done and appends a sealed audit event. Idempotent per status.",
    inputSchema: {
      type: "object",
      properties: {
        entryId: { type: "string" },
        boardId: { type: "string" },
        status: { type: "string", enum: ["due", "given", "skipped", "blocked", "done"] },
        note: { type: ["string", "null"] },
        occurredAt: { type: ["string", "null"] },
        idempotencyKey: { type: ["string", "null"] },
      },
      required: ["entryId", "boardId", "status"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "seal_handover",
    title: "Seal a handover",
    description: "Records the decision a caregiver actually made at a handover moment. Irreversible by design.",
    inputSchema: {
      type: "object",
      properties: {
        boardId: { type: "string" },
        handoverAt: { type: "string" },
        note: { type: "string" },
        idempotencyKey: { type: ["string", "null"] },
      },
      required: ["boardId", "handoverAt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
] as const;

export const TOOL_NAMES = toolDefs.map((tool) => tool.name);

const listBoardsInput = z.object({}).passthrough();
const boardInput = z.object({ boardId: z.string().min(1) }).passthrough();
const analyzeInput = z.object({ boardId: z.string().min(1), asOf: z.string().optional() }).passthrough();
const drugInput = z.object({ name: z.string().min(2) }).passthrough();
const noteInput = z.object({ note: z.string().min(10) }).passthrough();
const logInput = z
  .object({
    boardId: z.string().min(1),
    kind: z.enum(["dose", "observation", "note", "task"]).default("dose"),
    status: z.enum(["due", "given", "skipped", "blocked", "done"]).default("due"),
    title: z.string().min(1).max(160),
    detail: z.string().max(2000).default(""),
    medication: z.string().max(120).nullish(),
    doseAmount: z.string().max(60).nullish(),
    route: z.string().max(60).nullish(),
    instructions: z.string().max(300).nullish(),
    assignedTo: z.string().max(80).nullish(),
    scheduledFor: z.string().nullish(),
    occurredAt: z.string().nullish(),
    idempotencyKey: z.string().max(120).nullish(),
  })
  .passthrough();
const statusInput = z
  .object({
    entryId: z.string().min(1),
    boardId: z.string().min(1),
    status: z.enum(["due", "given", "skipped", "blocked", "done"]),
    note: z.string().max(2000).nullish(),
    occurredAt: z.string().nullish(),
    idempotencyKey: z.string().max(120).nullish(),
  })
  .passthrough();
const sealInput = z
  .object({
    boardId: z.string().min(1),
    handoverAt: z.string().min(4),
    note: z.string().max(400).default(""),
    idempotencyKey: z.string().max(120).nullish(),
  })
  .passthrough();

async function withIdempotency<T>(
  key: string | null | undefined,
  scope: string,
  at: string,
  run: () => Promise<T>,
): Promise<{ result: T; idempotentReplay: boolean }> {
  if (!key) return { result: await run(), idempotentReplay: false };
  const claimed = await claimIdempotencyKey(key, scope, at);
  if (!claimed) {
    const stored = await readIdempotentResult<T>(key);
    if (stored) return { result: stored, idempotentReplay: true };
  }
  const result = await run();
  await storeIdempotentResult(key, result);
  return { result, idempotentReplay: false };
}

export type ToolContext = { sessionId: string };

export async function callTool(name: string, rawArgs: unknown, context: ToolContext): Promise<unknown> {
  const at = new Date().toISOString();

  switch (name) {
    case "list_boards": {
      listBoardsInput.parse(rawArgs ?? {});
      const { allBoards } = await import("./service");
      return { boards: await allBoards(context.sessionId) };
    }

    case "get_board": {
      const args = boardInput.parse(rawArgs);
      const snapshot = await boardSnapshot(context.sessionId, args.boardId);
      return {
        board: snapshot.board,
        entries: snapshot.entries,
        analysis: snapshot.analysis,
        seal: snapshot.seal,
        sources: snapshot.analysis.sources,
      };
    }

    case "analyze_handover": {
      const args = analyzeInput.parse(rawArgs);
      const snapshot = await boardSnapshot(context.sessionId, args.boardId, { asOf: args.asOf });
      return {
        engineVersion: snapshot.analysis.engineVersion,
        score: snapshot.analysis.score,
        verdict: snapshot.analysis.verdict,
        decision: snapshot.analysis.decision,
        factors: snapshot.analysis.factors,
        seal: snapshot.seal,
        disclaimer: DISCLAIMER,
      };
    }

    case "lookup_drug": {
      const args = drugInput.parse(rawArgs);
      return await lookupDrug(args.name);
    }

    case "extract_care_rows": {
      const args = noteInput.parse(rawArgs);
      return extractCareNote(args.note);
    }

    case "verify_integrity": {
      const args = boardInput.parse(rawArgs);
      return await verifyBoard(args.boardId, context.sessionId);
    }

    case "log_entry": {
      const args = logInput.parse(rawArgs);
      const { result, idempotentReplay } = await withIdempotency(args.idempotencyKey, "log_entry", at, async () => {
        const written = await createEntry(
          {
            boardId: args.boardId,
            kind: args.kind,
            status: args.status,
            title: args.title,
            detail: args.detail,
            medication: args.medication ?? null,
            strength: null,
            doseAmount: args.doseAmount ?? null,
            route: args.route ?? null,
            instructions: args.instructions ?? null,
            assignedTo: args.assignedTo ?? null,
            recordedBy: "agent",
            scheduledFor: args.scheduledFor ?? null,
            occurredAt: args.occurredAt ?? null,
            source: "agent",
            at,
          },
          "agent",
        );
        return {
          entryId: written.entry.id,
          title: written.entry.title,
          status: written.entry.status,
          seal: written.audit.seal,
          auditSeq: written.audit.seq,
        };
      });
      return { ...result, idempotentReplay };
    }

    case "update_entry_status": {
      const args = statusInput.parse(rawArgs);
      const { result, idempotentReplay } = await withIdempotency(args.idempotencyKey, "update_entry_status", at, async () => {
        const { updateEntry } = await import("./repo/store");
        const written = await updateEntry(
          args.entryId,
          args.boardId,
          context.sessionId,
          {
            status: args.status,
            ...(args.note ? { detail: args.note } : {}),
            occurredAt: args.occurredAt ?? (args.status === "given" ? at : null),
          },
          "agent",
          at,
        );
        return {
          entryId: written.entry.id,
          status: written.entry.status,
          occurredAt: written.entry.occurredAt,
          seal: written.audit.seal,
          auditSeq: written.audit.seq,
        };
      });
      return { ...result, idempotentReplay };
    }

    case "seal_handover": {
      const args = sealInput.parse(rawArgs);
      const { result, idempotentReplay } = await withIdempotency(args.idempotencyKey, "seal_handover", at, async () => {
        const snapshot = await boardSnapshot(context.sessionId, args.boardId);
        const brief = buildBrief(snapshot, args.handoverAt);
        const { appendHandover } = await import("./repo/store");
        const written = await appendHandover({
          boardId: args.boardId,
          ownerId: context.sessionId,
          handoverAt: args.handoverAt,
          note: args.note,
          score: snapshot.analysis.score,
          verdict: snapshot.analysis.verdict,
          outgoingCount: brief.outgoing.length,
          incomingCount: brief.incoming.length,
          at,
        });
        return {
          entryId: written.entry.id,
          score: snapshot.analysis.score,
          verdict: snapshot.analysis.verdict,
          outgoingCount: brief.outgoing.length,
          incomingCount: brief.incoming.length,
          seal: written.audit.seal,
          auditSeq: written.audit.seq,
        };
      });
      return { ...result, idempotentReplay };
    }

    default:
      throw new RpcError(-32601, `Unknown tool: ${name}`);
  }
}

export function listTools() {
  return toolDefs.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

export { stringArray };

/** Handle a single JSON-RPC request object. */
export async function handleRpc(request: JsonRpcRequest, context: ToolContext): Promise<unknown> {
  const hasId = request.id !== undefined && request.id !== null;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: request.id ?? null, result });
  const failWith = (code: number, message: string, data?: unknown) => ({
    jsonrpc: "2.0",
    id: request.id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });

  if (request.jsonrpc !== "2.0") {
    return hasId ? failWith(-32600, "jsonrpc must be exactly \"2.0\".") : null;
  }
  if (typeof request.method !== "string") {
    return hasId ? failWith(-32600, "method must be a string.") : null;
  }

  try {
    switch (request.method) {
      case "initialize":
        return reply({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: `Handover exposes one person's care board over ${PROTOCOL_VERSION}. Mutations go through the same service layer as the web UI and are sealed in a SHA-384 chain. ${DISCLAIMER}`,
        });

      case "notifications/initialized":
      case "initialized":
        return hasId ? reply({ ok: true }) : null;

      case "ping":
        return reply({ ok: true });

      case "tools/list":
        return reply({ tools: listTools() });

      case "tools/call": {
        const params = request.params as { name?: unknown; arguments?: unknown } | undefined;
        const name = typeof params?.name === "string" ? params.name : null;
        if (!name) return failWith(-32602, "tools/call requires a tool name.");
        const known = TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number]);
        if (!known) return failWith(-32602, `Unknown tool: ${name}`, { available: TOOL_NAMES });
        try {
          const result = await callTool(name, params?.arguments ?? {}, context);
          return reply({
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false,
          });
        } catch (error) {
          if (error instanceof z.ZodError) {
            return reply({
              content: [{ type: "text", text: JSON.stringify({ code: "validation_failed", issues: error.issues }) }],
              isError: true,
            });
          }
          if (error instanceof StoreError) {
            return reply({
              content: [{ type: "text", text: JSON.stringify({ code: error.code, message: error.message }) }],
              isError: true,
            });
          }
          return failWith(-32603, "Tool execution failed.", { tool: name });
        }
      }

      default:
        return hasId ? failWith(-32601, `Method not found: ${request.method}`) : null;
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return failWith(-32602, "Invalid arguments.", { issues: error.issues });
    }
    if (error instanceof StoreError) {
      return failWith(error.status === 404 ? -32602 : -32000, error.message, { code: error.code });
    }
    return failWith(-32603, "Internal error.");
  }
}