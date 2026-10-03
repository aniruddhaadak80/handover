import { randomUUID } from "node:crypto";
import { applySchema, getSql, type SqlClient } from "../db/client";
import { GENESIS_SEAL, nextSeal, type ChainInput } from "../seal/chain";
import type { AuditEvent, AuditType, CareBoard, CareEntry, EntryKind, EntryStatus } from "../types";

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

let schemaPromise: Promise<SqlClient> | null = null;

export async function db(): Promise<SqlClient> {
  const resolution = await getSql();
  if (!resolution.ok) {
    throw new StoreError(resolution.reason, 503, "store_unavailable");
  }
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await applySchema(resolution.client);
      return resolution.client;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** ------------------------------------------------------------- row mapping */

type BoardRow = {
  id: string;
  owner_id: string;
  subject_name: string;
  ward_note: string;
  timezone: string;
  caregivers: unknown;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type EntryRow = {
  id: string;
  board_id: string;
  kind: string;
  status: string;
  title: string;
  detail: string;
  medication: string | null;
  strength: string | null;
  dose_amount: string | null;
  route: string | null;
  instructions: string | null;
  assigned_to: string | null;
  recorded_by: string;
  scheduled_for: string | null;
  occurred_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};

type AuditRow = {
  id: string;
  board_id: string;
  seq: number;
  type: string;
  at: string;
  actor: string;
  entry_id: string | null;
  payload: unknown;
  prev_seal: string;
  seal: string;
};

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function mapBoard(row: BoardRow): CareBoard {
  return {
    id: row.id,
    subjectName: row.subject_name,
    wardNote: row.ward_note,
    timezone: row.timezone,
    caregivers: asArray(row.caregivers),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapEntry(row: EntryRow): CareEntry {
  return {
    id: row.id,
    boardId: row.board_id,
    kind: row.kind as EntryKind,
    status: row.status as EntryStatus,
    title: row.title,
    detail: row.detail ?? "",
    medication: row.medication,
    strength: row.strength,
    doseAmount: row.dose_amount,
    route: row.route,
    instructions: row.instructions,
    assignedTo: row.assigned_to,
    recordedBy: row.recorded_by,
    scheduledFor: row.scheduled_for,
    occurredAt: row.occurred_at,
    source: row.source as CareEntry["source"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    boardId: row.board_id,
    seq: row.seq,
    type: row.type as AuditType,
    at: row.at,
    actor: row.actor,
    entryId: row.entry_id,
    payload: asRecord(row.payload),
    prevSeal: row.prev_seal,
    seal: row.seal,
  };
}

/** ------------------------------------------------------------- seal chain */

type Head = { seq: number; seal: string };

async function headOf(client: SqlClient, boardId: string): Promise<Head> {
  const rows = await client.query<{ seq: number; seal: string }>(
    "SELECT seq, seal FROM audit_events WHERE board_id = $1 ORDER BY seq DESC LIMIT 1",
    [boardId],
  );
  const top = rows.rows[0];
  return top ? { seq: Number(top.seq), seal: top.seal } : { seq: 0, seal: GENESIS_SEAL };
}

/**
 * Build the next sealed row. Kept separate from the write so callers can seal
 * first and then insert the domain row and its audit event in one statement.
 */
export async function planAudit(
  client: SqlClient,
  boardId: string,
  event: ChainInput,
): Promise<AuditEvent> {
  const head = await headOf(client, boardId);
  const sealed = nextSeal(head.seal, head.seq + 1, event);
  return {
    id: newId("aud"),
    boardId,
    seq: sealed.seq,
    type: sealed.type as AuditType,
    at: sealed.at,
    actor: sealed.actor,
    entryId: sealed.entryId,
    payload: sealed.payload,
    prevSeal: sealed.prevSeal,
    seal: sealed.seal,
  };
}

export async function currentSeal(boardId: string): Promise<string | null> {
  const client = await db();
  const head = await headOf(client, boardId);
  return head.seq === 0 ? null : head.seal;
}

export async function listAudit(boardId: string): Promise<AuditEvent[]> {
  const client = await db();
  const rows = await client.query<AuditRow>(
    "SELECT id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal FROM audit_events WHERE board_id = $1 ORDER BY seq ASC",
    [boardId],
  );
  return rows.rows.map(mapAudit);
}

export async function insertAuditRow(sql: string, params: readonly unknown[]): Promise<void> {
  const client = await db();
  await client.query(sql, params);
}

/** ------------------------------------------------------------------ boards */

export type BoardInsert = {
  ownerId: string;
  subjectName: string;
  wardNote: string;
  timezone: string;
  caregivers: string[];
  at: string;
  seeded?: boolean;
};

export async function createBoard(input: BoardInsert): Promise<{ board: CareBoard; audit: AuditEvent }> {
  const client = await db();
  const boardId = input.seeded ? seededBoardId(input.ownerId) : newId("brd");
  const audit = await planAudit(client, boardId, {
    type: "board.created",
    at: input.at,
    actor: input.ownerId === "seed" ? "seed" : "you",
    entryId: null,
    payload: { subjectName: input.subjectName, timezone: input.timezone, seeded: Boolean(input.seeded) },
  });

  const rows = await client.query<{ written: number }>(
    `WITH inserted AS (
       INSERT INTO care_boards (id, owner_id, subject_name, ward_note, timezone, caregivers, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
       ON CONFLICT (id) DO NOTHING
       RETURNING *
     )
     INSERT INTO audit_events (id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal)
     SELECT $8, id, $9, 'board.created', $7, $10, NULL, $11::jsonb, $12, $13
     FROM inserted
     RETURNING (SELECT COUNT(*) FROM inserted) AS written`,
    [
      boardId,
      input.ownerId,
      input.subjectName.slice(0, 120),
      input.wardNote.slice(0, 600),
      input.timezone.slice(0, 64),
      JSON.stringify(input.caregivers.slice(0, 12)),
      input.at,
      audit.id,
      audit.seq,
      audit.actor,
      JSON.stringify(audit.payload),
      audit.prevSeal,
      audit.seal,
    ],
  );

  if (Number(rows.rows[0]?.written ?? 0) === 0) {
    const existing = await getBoardById(boardId, input.ownerId, { includeDeleted: true });
    if (existing) return { board: existing, audit: await firstAudit(boardId) };
  }

  const board = await getBoardById(boardId, input.ownerId);
  if (!board) throw new StoreError("board could not be read back after insert", 500, "write_failed");
  return { board, audit };
}

async function firstAudit(boardId: string): Promise<AuditEvent> {
  const events = await listAudit(boardId);
  return events[0];
}

/** Deterministic per-session seed id, so seeding never creates duplicates. */
export function seededBoardId(ownerId: string): string {
  let hash = 0;
  for (let i = 0; i < ownerId.length; i++) hash = (hash * 31 + ownerId.charCodeAt(i)) >>> 0;
  return `brd_seed_${hash.toString(16).padStart(8, "0")}`;
}

export async function listBoards(ownerId: string, includeDeleted = false): Promise<CareBoard[]> {
  const client = await db();
  const rows = await client.query<BoardRow>(
    `SELECT id, owner_id, subject_name, ward_note, timezone, caregivers, share_token, created_at, updated_at, deleted_at
       FROM care_boards
      WHERE owner_id = $1 ${includeDeleted ? "" : "AND deleted_at IS NULL"}
      ORDER BY deleted_at NULLS FIRST, updated_at DESC`,
    [ownerId],
  );
  return rows.rows.map(mapBoard);
}

export async function getBoardById(
  id: string,
  ownerId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<CareBoard | null> {
  const client = await db();
  const rows = await client.query<BoardRow>(
    `SELECT id, owner_id, subject_name, ward_note, timezone, caregivers, share_token, created_at, updated_at, deleted_at
       FROM care_boards
      WHERE id = $1 AND owner_id = $2 ${options.includeDeleted ? "" : "AND deleted_at IS NULL"}`,
    [id, ownerId],
  );
  const row = rows.rows[0];
  return row ? mapBoard(row) : null;
}

export async function getBoardByShareToken(token: string): Promise<CareBoard | null> {
  const client = await db();
  const rows = await client.query<BoardRow>(
    `SELECT id, owner_id, subject_name, ward_note, timezone, caregivers, share_token, created_at, updated_at, deleted_at
       FROM care_boards
      WHERE share_token = $1 AND deleted_at IS NULL`,
    [token],
  );
  const row = rows.rows[0];
  return row ? mapBoard(row) : null;
}

export async function ensureShareToken(boardId: string, token: string): Promise<string> {
  const client = await db();
  const rows = await client.query<{ share_token: string | null }>(
    "UPDATE care_boards SET share_token = COALESCE(share_token, $2) WHERE id = $1 RETURNING share_token",
    [boardId, token],
  );
  const value = rows.rows[0]?.share_token;
  if (!value) throw new StoreError("board not found while minting a share link", 404, "not_found");
  return value;
}

export type BoardPatch = {
  subjectName?: string;
  wardNote?: string;
  timezone?: string;
  caregivers?: string[];
  deletedAt?: string | null;
};

export async function updateBoard(
  boardId: string,
  ownerId: string,
  patch: BoardPatch,
  actor: string,
  at: string,
): Promise<{ board: CareBoard; audit: AuditEvent }> {
  const client = await db();
  const existing = await getBoardById(boardId, ownerId, { includeDeleted: true });
  if (!existing) throw new StoreError("board not found", 404, "not_found");
  if (existing.deletedAt && patch.deletedAt === undefined) {
    throw new StoreError("board is deleted", 409, "deleted");
  }

  const type: AuditType = patch.deletedAt ? "board.deleted" : "board.updated";
  const audit = await planAudit(client, boardId, {
    type,
    at,
    actor,
    entryId: null,
    payload: { ...patch },
  });

  const rows = await client.query<{ written: number }>(
    `WITH updated AS (
       UPDATE care_boards SET
         subject_name = COALESCE($3, subject_name),
         ward_note = COALESCE($4, ward_note),
         timezone = COALESCE($5, timezone),
         caregivers = COALESCE($6::jsonb, caregivers),
         deleted_at = COALESCE($7, deleted_at),
         updated_at = $8
       WHERE id = $1 AND owner_id = $2
       RETURNING *
     )
     INSERT INTO audit_events (id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal)
     SELECT $9, id, $10, $11, $8, $12, NULL, $13::jsonb, $14, $15
     FROM updated
     RETURNING (SELECT COUNT(*) FROM updated) AS written`,
    [
      boardId,
      ownerId,
      patch.subjectName?.slice(0, 120) ?? null,
      patch.wardNote?.slice(0, 600) ?? null,
      patch.timezone?.slice(0, 64) ?? null,
      patch.caregivers ? JSON.stringify(patch.caregivers.slice(0, 12)) : null,
      patch.deletedAt ?? null,
      at,
      audit.id,
      audit.seq,
      type,
      actor,
      JSON.stringify(audit.payload),
      audit.prevSeal,
      audit.seal,
    ],
  );

  if (Number(rows.rows[0]?.written ?? 0) === 0) {
    throw new StoreError("board not found", 404, "not_found");
  }
  const board = await getBoardById(boardId, ownerId, { includeDeleted: true });
  if (!board) throw new StoreError("board could not be read back after update", 500, "write_failed");
  return { board, audit };
}

/** ----------------------------------------------------------------- entries */

export async function listEntries(boardId: string, limit = 200): Promise<CareEntry[]> {
  const client = await db();
  const rows = await client.query<EntryRow>(
    `SELECT id, board_id, kind, status, title, detail, medication, strength, dose_amount, route,
            instructions, assigned_to, recorded_by, scheduled_for, occurred_at, source, created_at, updated_at
       FROM care_entries
      WHERE board_id = $1
      ORDER BY COALESCE(occurred_at, scheduled_for, created_at) ASC, id ASC
      LIMIT $2`,
    [boardId, Math.min(500, Math.max(1, limit))],
  );
  return rows.rows.map(mapEntry);
}

export type EntryInsert = {
  boardId: string;
  kind: EntryKind;
  status: EntryStatus;
  title: string;
  detail: string;
  medication: string | null;
  strength: string | null;
  doseAmount: string | null;
  route: string | null;
  instructions: string | null;
  assignedTo: string | null;
  recordedBy: string;
  scheduledFor: string | null;
  occurredAt: string | null;
  source: CareEntry["source"];
  at: string;
};

export async function createEntry(input: EntryInsert, actor: string): Promise<{ entry: CareEntry; audit: AuditEvent }> {
  const client = await db();
  const entryId = newId("ent");
  const audit = await planAudit(client, input.boardId, {
    type: "entry.created",
    at: input.at,
    actor,
    entryId,
    payload: {
      kind: input.kind,
      status: input.status,
      title: input.title.slice(0, 160),
      medication: input.medication,
      scheduledFor: input.scheduledFor,
      source: input.source,
    },
  });

  await client.query<EntryRow>(
    `WITH inserted AS (
       INSERT INTO care_entries
         (id, board_id, kind, status, title, detail, medication, strength, dose_amount, route,
          instructions, assigned_to, recorded_by, scheduled_for, occurred_at, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
       RETURNING id
     )
     INSERT INTO audit_events (id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal)
     SELECT $18, $2, $19, 'entry.created', $17, $20, $1, $21::jsonb, $22, $23
     FROM inserted
     RETURNING id`,
    [
      entryId,
      input.boardId,
      input.kind,
      input.status,
      input.title.slice(0, 160),
      input.detail.slice(0, 2000),
      input.medication,
      input.strength,
      input.doseAmount,
      input.route,
      input.instructions?.slice(0, 300) ?? null,
      input.assignedTo?.slice(0, 80) ?? null,
      input.recordedBy.slice(0, 80),
      input.scheduledFor,
      input.occurredAt,
      input.source,
      input.at,
      audit.id,
      audit.seq,
      actor,
      JSON.stringify(audit.payload),
      audit.prevSeal,
      audit.seal,
    ],
  );

  const stored = await client.query<EntryRow>("SELECT * FROM care_entries WHERE id = $1", [entryId]);
  const row = stored.rows[0];
  if (!row) throw new StoreError("entry could not be read back after insert", 500, "write_failed");
  return { entry: mapEntry(row), audit };
}

export type EntryPatch = {
  status?: EntryStatus;
  title?: string;
  detail?: string;
  doseAmount?: string | null;
  instructions?: string | null;
  assignedTo?: string | null;
  scheduledFor?: string | null;
  occurredAt?: string | null;
};

export async function updateEntry(
  entryId: string,
  boardId: string,
  ownerId: string,
  patch: EntryPatch,
  actor: string,
  at: string,
): Promise<{ entry: CareEntry; audit: AuditEvent }> {
  const client = await db();
  const board = await getBoardById(boardId, ownerId);
  if (!board) throw new StoreError("board not found", 404, "not_found");

  const before = await client.query<EntryRow>("SELECT * FROM care_entries WHERE id = $1 AND board_id = $2", [
    entryId,
    boardId,
  ]);
  const current = before.rows[0];
  if (!current) throw new StoreError("entry not found", 404, "not_found");

  const audit = await planAudit(client, boardId, {
    type: "entry.updated",
    at,
    actor,
    entryId,
    payload: {
      entryId,
      from: { status: current.status, assignedTo: current.assigned_to, occurredAt: current.occurred_at },
      patch,
    },
  });

  await client.query<EntryRow>(
    `WITH updated AS (
       UPDATE care_entries SET
         status = COALESCE($3, status),
         title = COALESCE($4, title),
         detail = COALESCE($5, detail),
         dose_amount = COALESCE($6, dose_amount),
         instructions = COALESCE($7, instructions),
         assigned_to = COALESCE($8, assigned_to),
         scheduled_for = COALESCE($9, scheduled_for),
         occurred_at = COALESCE($10, occurred_at),
         updated_at = $11
       WHERE id = $1 AND board_id = $2
       RETURNING id
     )
     INSERT INTO audit_events (id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal)
     SELECT $12, $2, $13, 'entry.updated', $11, $14, $1, $15::jsonb, $16, $17
     FROM updated
     RETURNING id`,
    [
      entryId,
      boardId,
      patch.status ?? null,
      patch.title?.slice(0, 160) ?? null,
      patch.detail?.slice(0, 2000) ?? null,
      patch.doseAmount ?? null,
      patch.instructions?.slice(0, 300) ?? null,
      patch.assignedTo?.slice(0, 80) ?? null,
      patch.scheduledFor ?? null,
      patch.occurredAt ?? null,
      at,
      audit.id,
      audit.seq,
      actor,
      JSON.stringify(audit.payload),
      audit.prevSeal,
      audit.seal,
    ],
  );

  const stored = await client.query<EntryRow>("SELECT * FROM care_entries WHERE id = $1", [entryId]);
  const row = stored.rows[0];
  if (!row) throw new StoreError("entry not found", 404, "not_found");
  return { entry: mapEntry(row), audit };
}

/**
 * Soft delete: the row is retained so the seal chain stays replayable, and a
 * tombstone entry is visible to readers.
 */
export async function deleteEntry(
  entryId: string,
  boardId: string,
  ownerId: string,
  actor: string,
  at: string,
): Promise<{ audit: AuditEvent }> {
  const client = await db();
  const board = await getBoardById(boardId, ownerId, { includeDeleted: true });
  if (!board) throw new StoreError("board not found", 404, "not_found");
  const found = await client.query<{ id: string; title: string }>(
    "SELECT id, title FROM care_entries WHERE id = $1 AND board_id = $2",
    [entryId, boardId],
  );
  const current = found.rows[0];
  if (!current) throw new StoreError("entry not found", 404, "not_found");

  const audit = await planAudit(client, boardId, {
    type: "entry.deleted",
    at,
    actor,
    entryId,
    payload: { entryId, title: current.title, tombstone: true },
  });

  const rows = await client.query<{ id: string }>(
    `WITH removed AS (
       UPDATE care_entries SET status = 'skipped', updated_at = $4
       WHERE id = $1 AND board_id = $2
       RETURNING id
     )
     INSERT INTO audit_events (id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal)
     SELECT $5, $2, $6, 'entry.deleted', $4, $3, $1, $7::jsonb, $8, $9
     FROM removed
     RETURNING id`,
    [entryId, boardId, actor, at, audit.id, audit.seq, JSON.stringify(audit.payload), audit.prevSeal, audit.seal],
  );

  if (rows.rows.length === 0) throw new StoreError("entry not found", 404, "not_found");
  return { audit };
}

/** --------------------------------------------------------------- handover */

export type HandoverSealInput = {
  boardId: string;
  ownerId: string;
  handoverAt: string;
  note: string;
  score: number;
  verdict: string;
  outgoingCount: number;
  incomingCount: number;
  at: string;
};

/**
 * Records a sealed handover: a `handover` entry plus the chained audit event
 * that makes it irreversible. Same write path as any other entry, so replay
 * covers it without special cases.
 */
export async function appendHandover(input: HandoverSealInput): Promise<{
  entry: CareEntry;
  audit: AuditEvent;
}> {
  const client = await db();
  const board = await getBoardById(input.boardId, input.ownerId, { includeDeleted: true });
  if (!board) throw new StoreError("board not found", 404, "not_found");
  if (board.deletedAt) throw new StoreError("board is deleted", 409, "deleted");

  const entryId = newId("ent");
  const title = `Handover sealed - readiness ${input.score}/100 (${input.verdict})`;
  const detail = input.note.trim().length > 0 ? input.note.trim() : "No spoken warning recorded.";

  const audit = await planAudit(client, input.boardId, {
    type: "handover.sealed",
    at: input.at,
    actor: "you",
    entryId,
    payload: {
      handoverAt: input.handoverAt,
      score: input.score,
      verdict: input.verdict,
      outgoingCount: input.outgoingCount,
      incomingCount: input.incomingCount,
      note: detail,
    },
  });

  await client.query(
    `WITH inserted AS (
       INSERT INTO care_entries
         (id, board_id, kind, status, title, detail, medication, strength, dose_amount, route,
          instructions, assigned_to, recorded_by, scheduled_for, occurred_at, source, created_at, updated_at)
       VALUES ($1,$2,'handover','done',$3,$4,NULL,NULL,NULL,NULL,$5,$6,'you',$7,$7,'manual',$8,$8)
       RETURNING id
     )
     INSERT INTO audit_events (id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal)
     SELECT $9, $2, $10, 'handover.sealed', $8, 'you', $1, $11::jsonb, $12, $13
     FROM inserted
     RETURNING id`,
    [
      entryId,
      input.boardId,
      title.slice(0, 160),
      detail.slice(0, 2000),
      `handover at ${input.handoverAt}; ${input.outgoingCount} carried, ${input.incomingCount} inherited`,
      board.caregivers[0] ?? "you",
      input.handoverAt,
      input.at,
      audit.id,
      audit.seq,
      JSON.stringify(audit.payload),
      audit.prevSeal,
      audit.seal,
    ],
  );

  const stored = await client.query<EntryRow>("SELECT * FROM care_entries WHERE id = $1", [entryId]);
  const row = stored.rows[0];
  if (!row) throw new StoreError("handover could not be read back after insert", 500, "write_failed");
  return { entry: mapEntry(row), audit };
}

/** --------------------------------------------------------- idempotency keys */

export async function claimIdempotencyKey(key: string, scope: string, at: string): Promise<boolean> {
  const client = await db();
  const rows = await client.query<{ key: string }>(
    "INSERT INTO idempotency_keys (key, scope, created_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING RETURNING key",
    [key, scope, at],
  );
  return rows.rows.length > 0;
}

export async function storeIdempotentResult(key: string, result: unknown): Promise<void> {
  const client = await db();
  await client.query("UPDATE idempotency_keys SET result = $2::jsonb WHERE key = $1", [key, JSON.stringify(result)]);
}

export async function readIdempotentResult<T>(key: string): Promise<T | null> {
  const client = await db();
  const rows = await client.query<{ result: unknown }>("SELECT result FROM idempotency_keys WHERE key = $1", [key]);
  const value = rows.rows[0]?.result;
  return value ? (value as T) : null;
}