import { analyzeHandover, DEFAULT_WEIGHTS, DISCLAIMER, FACTOR_LABELS } from "./engine/readiness";
import { lookupDrug } from "./live/drugs";
import { replayChain } from "./seal/chain";
import { appendExampleEntries } from "./seed-entries";
import { newShareToken } from "./session";
import {
  StoreError,
  createBoard as storeCreateBoard,
  createEntry as storeCreateEntry,
  currentSeal,
  getBoardById,
  listAudit,
  listBoards,
  listEntries,
  db,
  ensureShareToken,
  getBoardByShareToken,
  seededBoardId,
  updateBoard as storeUpdateBoard,
  type BoardPatch,
} from "./repo/store";
import type {
  CareBoard,
  CareEntry,
  DrugLookup,
  FactorKey,
  HandoverAnalysis,
  HandoverBrief,
  IntegrityReport,
} from "./types";

export const SETTINGS_DEFAULTS = { weights: DEFAULT_WEIGHTS as Record<FactorKey, number>, windowHours: 24, caregiverName: "" };

export type Settings = typeof SETTINGS_DEFAULTS;

export async function getSettings(ownerId: string): Promise<Settings> {
  const client = await db();
  const rows = await client.query<{ weights: unknown; window_hours: number; caregiver_name: string | null }>(
    "SELECT weights, window_hours, caregiver_name FROM session_settings WHERE owner_id = $1",
    [ownerId],
  );
  const row = rows.rows[0];
  if (!row) return { ...SETTINGS_DEFAULTS, weights: { ...DEFAULT_WEIGHTS } };
  const stored = (typeof row.weights === "string" ? JSON.parse(row.weights) : row.weights) as Partial<Record<FactorKey, number>>;
  const weights = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as FactorKey[]) {
    const value = stored?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) weights[key] = value;
  }
  return {
    weights,
    windowHours: Number.isFinite(row.window_hours) ? Number(row.window_hours) : 24,
    caregiverName: row.caregiver_name ?? "",
  };
}

export async function saveSettings(
  ownerId: string,
  patch: { weights?: Partial<Record<FactorKey, number>>; windowHours?: number; caregiverName?: string },
  at: string,
): Promise<Settings> {
  const client = await db();
  await client.query(
    `INSERT INTO session_settings (owner_id, weights, window_hours, caregiver_name, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (owner_id) DO UPDATE SET
       weights = session_settings.weights || $2::jsonb,
       window_hours = $3,
       caregiver_name = $4,
       updated_at = $5`,
    [
      ownerId,
      JSON.stringify(patch.weights ?? {}),
      patch.windowHours ?? SETTINGS_DEFAULTS.windowHours,
      patch.caregiverName ?? null,
      at,
    ],
  );
  return getSettings(ownerId);
}

/** ------------------------------------------------------------------- seed */

const SEED_SUBJECT = "Worked example \u2014 recovery at home";
const SEED_NOTE =
  "Every value on this board is invented so a stranger can see a full handover. Nothing here is medical advice.";

export type SeedResult = { board: CareBoard; seeded: boolean };

/**
 * One worked example per browser session. The board id is derived from the
 * owner id and entry ids are deterministic, so seeding is idempotent and can
 * never collide with a board the visitor created themselves.
 */
export async function ensureSeedBoard(ownerId: string, now: Date = new Date()): Promise<SeedResult> {
  const at = now.toISOString();
  const boardId = seededBoardId(ownerId);

  const existing = await getBoardById(boardId, ownerId, { includeDeleted: true });
  if (existing) return { board: existing, seeded: false };

  const { board } = await storeCreateBoard({
    ownerId,
    subjectName: SEED_SUBJECT,
    wardNote: SEED_NOTE,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    caregivers: ["Priya", "Ravi"],
    at,
    seeded: true,
  });

  await appendExampleEntries(board.id, now);
  const refreshed = await getBoardById(boardId, ownerId);
  return { board: refreshed ?? board, seeded: true };
}


/** ---------------------------------------------------------------- analysis */

export type BoardSnapshot = {
  board: CareBoard;
  entries: CareEntry[];
  drugLookups: Record<string, DrugLookup>;
  analysis: HandoverAnalysis;
  seal: string | null;
};

/** Look up every distinct medicine on the board, bounded and stable in order. */
async function loadDrugs(entries: CareEntry[], limit = 6): Promise<Record<string, DrugLookup>> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const medication = entry.medication?.trim();
    if (!medication) continue;
    counts.set(medication, (counts.get(medication) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  const results = await Promise.all(ordered.map(([medication]) => lookupDrug(medication)));
  const map: Record<string, DrugLookup> = {};
  ordered.forEach(([medication], index) => {
    map[medication] = results[index];
  });
  return map;
}

export async function boardSnapshot(
  ownerId: string,
  boardId: string,
  options: { asOf?: string; includeDeleted?: boolean; skipDrugs?: boolean } = {},
): Promise<BoardSnapshot> {
  const board = await getBoardById(boardId, ownerId, { includeDeleted: options.includeDeleted });
  if (!board) throw new StoreError("board not found", 404, "not_found");
  const entries = await listEntries(boardId);
  const asOf = options.asOf ?? new Date().toISOString();
  const [seal, drugLookups] = await Promise.all([
    currentSeal(boardId),
    options.skipDrugs ? Promise.resolve({} as Record<string, DrugLookup>) : loadDrugs(entries),
  ]);
  const settings = await getSettings(ownerId);
  const analysis = analyzeHandover({
    board,
    entries,
    drugLookups,
    asOf,
    weights: settings.weights,
    windowHours: settings.windowHours,
    seal,
  });
  return { board, entries, drugLookups, analysis, seal };
}

/** ------------------------------------------------------------------ brief */

function stamp(value: string | null, fallback: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Date.parse(fallback) : parsed;
}

/** Split the board at a handover moment: what the outgoing person carried, what the next person inherits. */
export function splitAtHandover(entries: CareEntry[], handoverAt: string): { outgoing: CareEntry[]; incoming: CareEntry[] } {
  const cut = Date.parse(handoverAt);
  const outgoing: CareEntry[] = [];
  const incoming: CareEntry[] = [];
  for (const entry of entries) {
    const when = stamp(entry.occurredAt ?? entry.scheduledFor ?? entry.createdAt, handoverAt);
    if (when < cut) outgoing.push(entry);
    else incoming.push(entry);
  }
  return {
    outgoing: outgoing.sort((a, b) => stamp(a.occurredAt ?? a.scheduledFor ?? a.createdAt, handoverAt) - stamp(b.occurredAt ?? b.scheduledFor ?? b.createdAt, handoverAt)),
    incoming: incoming.sort((a, b) => stamp(a.occurredAt ?? a.scheduledFor ?? a.createdAt, handoverAt) - stamp(b.occurredAt ?? b.scheduledFor ?? b.createdAt, handoverAt)),
  };
}

export function buildBrief(snapshot: BoardSnapshot, handoverAt: string): HandoverBrief {
  const { outgoing, incoming } = splitAtHandover(snapshot.entries, handoverAt);
  const now = new Date();
  return {
    boardId: snapshot.board.id,
    subjectName: snapshot.board.subjectName,
    generatedAt: now.toISOString(),
    asOf: handoverAt,
    score: snapshot.analysis.score,
    verdict: snapshot.analysis.verdict,
    decision: snapshot.analysis.decision,
    blockingIssues: snapshot.analysis.blockingIssues,
    outgoing: outgoing.slice(-12),
    incoming: incoming.slice(0, 12),
    dueNext: incoming.filter((entry) => entry.kind === "dose" && (entry.status === "due" || entry.status === "blocked")).slice(0, 8),
    analysis: snapshot.analysis,
    seal: snapshot.seal,
    sources: snapshot.analysis.sources,
    disclaimer: DISCLAIMER,
  };
}

/** ---------------------------------------------------------------- integrity */

export async function verifyBoard(boardId: string, ownerId: string, replayedAt = new Date().toISOString()): Promise<IntegrityReport> {
  const board = await getBoardById(boardId, ownerId, { includeDeleted: true });
  if (!board) throw new StoreError("board not found", 404, "not_found");
  const events = await listAudit(boardId);
  const result = replayChain(events);
  return { boardId, replayedAt, ...result };
}

/** -------------------------------------------------------------- mutations */

export async function renameBoard(boardId: string, ownerId: string, patch: BoardPatch, actor: string, at: string) {
  return storeUpdateBoard(boardId, ownerId, patch, actor, at);
}

export async function softDeleteBoard(boardId: string, ownerId: string, actor: string, at: string) {
  return storeUpdateBoard(boardId, ownerId, { deletedAt: at }, actor, at);
}

export async function shareLink(boardId: string, ownerId: string, mint: (id: string) => string): Promise<string> {
  const board = await getBoardById(boardId, ownerId);
  if (!board) throw new StoreError("board not found", 404, "not_found");
  return ensureShareToken(boardId, mint(boardId));
}

export function mintShareToken(): string {
  return newShareToken();
}

export async function publicBrief(token: string, handoverAt: string) {
  const board = await getBoardByShareToken(token);
  if (!board) throw new StoreError("share link not found", 404, "not_found");
  const entries = await listEntries(board.id);
  const asOf = handoverAt;
  const drugLookups = await loadDrugs(entries);
  const seal = await currentSeal(board.id);
  const analysis = analyzeHandover({ board, entries, drugLookups, asOf, seal });
  return buildBrief({ board, entries, drugLookups, analysis, seal }, asOf);
}

export { FACTOR_LABELS, DEFAULT_WEIGHTS };
export async function allBoards(ownerId: string): Promise<CareBoard[]> {
  return listBoards(ownerId);
}

export { storeCreateEntry as appendEntry };
export type { CareEntry, CareBoard };