import { db, newId } from "./repo/store";
import { GENESIS_SEAL, nextSeal } from "./seal/chain";
import type { CareEntry } from "./types";

type SeedEntry = {
  key: string;
  hour: number;
  minute?: number;
  kind: CareEntry["kind"];
  status: CareEntry["status"];
  title: string;
  detail: string;
  medication?: string;
  strength?: string;
  doseAmount?: string;
  route?: string;
  instructions?: string;
  assignedTo?: string;
  dayOffset?: number;
};

/**
 * Two entries deliberately resolve to one ingredient, so the duplicate-therapy
 * check has something true to catch the moment a stranger opens the board.
 * Everything here is invented example data, labelled as such in the UI.
 */
export const SEED_ENTRIES: SeedEntry[] = [
  {
    key: "metformin-am",
    hour: 8,
    kind: "dose",
    status: "given",
    title: "Metformin 500 mg",
    detail: "Taken with breakfast. No nausea reported afterwards.",
    medication: "Metformin 500 mg",
    strength: "500 mg",
    doseAmount: "1 tablet",
    route: "oral",
    instructions: "with food",
    assignedTo: "Priya",
  },
  {
    key: "levo-am",
    hour: 7,
    minute: 30,
    kind: "dose",
    status: "due",
    title: "Levothyroxine 75 mcg",
    detail: "Full glass of water, 30 minutes before anything to eat.",
    medication: "Levothyroxine 75 mcg",
    strength: "75 mcg",
    doseAmount: "1 tablet",
    route: "oral",
    instructions: "empty stomach",
    assignedTo: "Priya",
  },
  {
    key: "glucophage-pm",
    hour: 20,
    kind: "dose",
    status: "due",
    title: "Glucophage 500 mg (evening)",
    detail: "Branded repeat of the morning metformin. This is the duplicate the check exists to catch.",
    medication: "Glucophage 500 mg",
    strength: "500 mg",
    doseAmount: "1 tablet",
    route: "oral",
    instructions: "with food",
    assignedTo: "Ravi",
  },
  {
    key: "atorvastatin-pm",
    hour: 22,
    kind: "dose",
    status: "due",
    title: "Atorvastatin 20 mg",
    detail: "At bedtime. Course continues until the review date.",
    medication: "Atorvastatin 20 mg",
    strength: "20 mg",
    doseAmount: "1 tablet",
    route: "oral",
    instructions: "at bedtime",
    assignedTo: "Ravi",
  },
  {
    key: "bp-reading",
    hour: 8,
    minute: 15,
    kind: "observation",
    status: "done",
    title: "Blood pressure 128/78",
    detail: "Seated, left arm, after a few minutes of rest.",
    assignedTo: "Priya",
  },
  {
    key: "physio-note",
    hour: 11,
    kind: "note",
    status: "done",
    title: "Physio: stairs twice a day from Friday",
    detail: "Frame is parked by the front door. Steady on the stairs this morning.",
    assignedTo: "Priya",
  },
  {
    key: "blood-test",
    hour: 9,
    kind: "task",
    status: "due",
    title: "Book thyroid blood test before the next dose change",
    detail: "Lab closes at 4pm. Ask for TSH and free T4.",
    assignedTo: "Ravi",
    dayOffset: 1,
  },
  {
    key: "yesterday-walk",
    hour: 17,
    kind: "observation",
    status: "done",
    title: "Walked to the gate and back",
    detail: "Slower than last week but steady, no dizziness.",
    assignedTo: "Priya",
    dayOffset: -1,
  },
];

/** Deterministic ids: re-running never duplicates or renames a seeded row. */
export function seedEntryId(boardId: string, key: string): string {
  let hash = 0;
  const seed = `${boardId}:${key}`;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return `ent_seed_${hash.toString(16).padStart(8, "0")}`;
}

function atLocal(base: Date, hour: number, minute: number, dayOffset = 0): string {
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + dayOffset);
  next.setHours(hour, minute, 0, 0);
  return next.toISOString();
}

/**
 * Insert the worked example onto an existing board and seal each row.
 * Idempotent: the deterministic entry id makes a second call a no-op.
 */
export async function appendExampleEntries(
  boardId: string,
  now: Date = new Date(),
): Promise<number> {
  const client = await db();
  const at = now.toISOString();
  let inserted = 0;

  for (const item of SEED_ENTRIES) {
    const scheduled = atLocal(now, item.hour, item.minute ?? 0, item.dayOffset ?? 0);
    const occurred = item.status === "given" || item.status === "done" ? scheduled : null;
    const id = seedEntryId(boardId, item.key);

    const written = await client.query<{ id: string }>(
      `INSERT INTO care_entries
         (id, board_id, kind, status, title, detail, medication, strength, dose_amount, route,
          instructions, assigned_to, recorded_by, scheduled_for, occurred_at, source, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual',$16,$16)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        id,
        boardId,
        item.kind,
        item.status,
        item.title,
        item.detail,
        item.medication ?? null,
        item.strength ?? null,
        item.doseAmount ?? null,
        item.route ?? null,
        item.instructions ?? null,
        item.assignedTo ?? null,
        item.assignedTo ?? "Priya",
        scheduled,
        occurred,
        at,
      ],
    );
    if (written.rows.length === 0) continue;
    inserted += 1;

    const head = await client.query<{ seq: number; seal: string }>(
      "SELECT seq, seal FROM audit_events WHERE board_id = $1 ORDER BY seq DESC LIMIT 1",
      [boardId],
    );
    const top = head.rows[0];
    const sealed = nextSeal(top?.seal ?? GENESIS_SEAL, (top?.seq ?? 0) + 1, {
      type: "entry.created",
      at: scheduled,
      actor: item.assignedTo ?? "seed",
      entryId: id,
      payload: {
        kind: item.kind,
        status: item.status,
        title: item.title,
        medication: item.medication ?? null,
        scheduledFor: scheduled,
        source: "manual",
        example: true,
      },
    });
    await client.query(
      `INSERT INTO audit_events (id, board_id, seq, type, at, actor, entry_id, payload, prev_seal, seal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [
        newId("aud"),
        boardId,
        sealed.seq,
        "entry.created",
        scheduled,
        sealed.actor,
        id,
        JSON.stringify(sealed.payload),
        sealed.prevSeal,
        sealed.seal,
      ],
    );
  }

  return inserted;
}