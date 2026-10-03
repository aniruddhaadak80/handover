import { beforeAll, describe, expect, it } from "vitest";

// Zero-config embedded Postgres for the suite. No URL, no container, no key.
process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;

import { replayChain } from "@/lib/seal/chain";
import {
  StoreError,
  createBoard,
  createEntry,
  currentSeal,
  deleteEntry,
  getBoardById,
  listAudit,
  listBoards,
  listEntries,
  updateBoard,
  updateEntry,
} from "@/lib/repo/store";
import { db } from "@/lib/repo/store";
import { ensureSeedBoard } from "@/lib/service";
import { appendExampleEntries } from "@/lib/seed-entries";

const OWNER = "aaaaaaaabbbbccccdddd";
const STRANGER = "11111111222233334444";

let boardId = "";

beforeAll(async () => {
  await db();
});

describe("store: boards and ownership", () => {
  it("creates a board, seals the event and reads it back", async () => {
    const { board, audit } = await createBoard({
      ownerId: OWNER,
      subjectName: "Test subject",
      wardNote: "note",
      timezone: "UTC",
      caregivers: ["Priya"],
      at: "2026-03-02T08:00:00.000Z",
    });
    boardId = board.id;
    expect(board.subjectName).toBe("Test subject");
    expect(board.deletedAt).toBeNull();
    expect(audit.seq).toBe(1);
    expect(audit.seal).toHaveLength(96);
    expect(await currentSeal(boardId)).toBe(audit.seal);
  });

  it("is idempotent for the same seeded id", async () => {
    const first = await createBoard({
      ownerId: OWNER,
      subjectName: "Seed A",
      wardNote: "",
      timezone: "UTC",
      caregivers: [],
      at: "2026-03-02T08:00:00.000Z",
      seeded: true,
    });
    const second = await createBoard({
      ownerId: OWNER,
      subjectName: "Seed B",
      wardNote: "",
      timezone: "UTC",
      caregivers: [],
      at: "2026-03-02T09:00:00.000Z",
      seeded: true,
    });
    expect(second.board.id).toBe(first.board.id);
    expect(second.board.subjectName).toBe("Seed A");
  });

  it("never exposes another session's board", async () => {
    expect(await getBoardById(boardId, STRANGER)).toBeNull();
    expect((await listBoards(STRANGER)).length).toBe(0);
    expect((await listBoards(OWNER)).length).toBeGreaterThan(0);
  });

  it("updates a board and appends a chained event", async () => {
    const before = await listAudit(boardId);
    const result = await updateBoard(boardId, OWNER, { subjectName: "Renamed" }, "you", "2026-03-02T09:00:00.000Z");
    expect(result.board.subjectName).toBe("Renamed");
    expect(result.audit.seq).toBe(before.length + 1);
    expect(result.audit.prevSeal).toBe(before[before.length - 1].seal);
  });

  it("refuses an update from a stranger", async () => {
    await expect(
      updateBoard(boardId, STRANGER, { subjectName: "hijack" }, "you", "2026-03-02T09:30:00.000Z"),
    ).rejects.toBeInstanceOf(StoreError);
    expect((await getBoardById(boardId, OWNER))?.subjectName).toBe("Renamed");
  });
});

describe("store: entries and the audit chain", () => {
  let entryId = "";

  it("creates an entry and seals it in the same statement", async () => {
    const result = await createEntry(
      {
        boardId,
        kind: "dose",
        status: "due",
        title: "Metformin 500 mg",
        detail: "With breakfast.",
        medication: "Metformin 500 mg",
        strength: "500 mg",
        doseAmount: "1 tablet",
        route: "oral",
        instructions: "with food",
        assignedTo: "Priya",
        recordedBy: "Priya",
        scheduledFor: "2026-03-02T09:00:00.000Z",
        occurredAt: null,
        source: "manual",
        at: "2026-03-02T09:00:00.000Z",
      },
      "Priya",
    );
    entryId = result.entry.id;
    expect(result.entry.title).toBe("Metformin 500 mg");
    expect(result.audit.type).toBe("entry.created");
    expect(result.audit.entryId).toBe(entryId);

    const events = await listAudit(boardId);
    expect(events.map((event) => event.type)).toContain("entry.created");
    expect(replayChain(events).ok).toBe(true);
  });

  it("updates an entry and reflects it on read-back", async () => {
    const result = await updateEntry(
      entryId,
      boardId,
      OWNER,
      { status: "given", occurredAt: "2026-03-02T09:10:00.000Z" },
      "Priya",
      "2026-03-02T09:10:00.000Z",
    );
    expect(result.entry.status).toBe("given");

    const entries = await listEntries(boardId);
    expect(entries.find((entry) => entry.id === entryId)?.status).toBe("given");
    expect(replayChain(await listAudit(boardId)).ok).toBe(true);
  });

  it("cannot update an entry on a board the caller does not own", async () => {
    await expect(
      updateEntry(entryId, boardId, STRANGER, { status: "skipped" }, "you", "2026-03-02T09:20:00.000Z"),
    ).rejects.toBeInstanceOf(StoreError);
  });

  it("404s on an unknown entry", async () => {
    await expect(
      updateEntry("ent_missing", boardId, OWNER, { status: "given" }, "you", "2026-03-02T09:30:00.000Z"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("keeps a tombstone after deletion and still replays", async () => {
    const before = await listAudit(boardId);
    const { audit } = await deleteEntry(entryId, boardId, OWNER, "you", "2026-03-02T10:00:00.000Z");
    expect(audit.type).toBe("entry.deleted");

    const entries = await listEntries(boardId);
    expect(entries.find((entry) => entry.id === entryId)?.status).toBe("skipped");

    const after = await listAudit(boardId);
    expect(after.length).toBe(before.length + 1);
    expect(replayChain(after).ok).toBe(true);
  });
});

describe("store: worked example", () => {
  it("seeds once per session and never collides with user boards", async () => {
    // A session that has never been seeded, so the first call really seeds.
    const freshOwner = "99999999888877776666";
    const first = await ensureSeedBoard(freshOwner, new Date("2026-03-02T06:00:00.000Z"));
    expect(first.seeded).toBe(true);
    const count = (await listEntries(first.board.id)).length;

    const second = await ensureSeedBoard(freshOwner, new Date("2026-03-03T06:00:00.000Z"));
    expect(second.seeded).toBe(false);
    expect((await listEntries(second.board.id)).length).toBe(count);

    expect((await listBoards(STRANGER)).length).toBe(0);
    expect((await listBoards(freshOwner)).length).toBe(1);
  });

  it("appends example entries idempotently", async () => {
    const created = await createBoard({
      ownerId: OWNER,
      subjectName: "Example target",
      wardNote: "",
      timezone: "UTC",
      caregivers: [],
      at: "2026-03-02T06:00:00.000Z",
    });
    const first = await appendExampleEntries(created.board.id, new Date("2026-03-02T06:00:00.000Z"));
    const second = await appendExampleEntries(created.board.id, new Date("2026-03-02T06:00:00.000Z"));
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    expect(replayChain(await listAudit(created.board.id)).ok).toBe(true);
  });

  it("detects a tampered audit row", async () => {
    const events = await listAudit(boardId);
    const tampered = events.map((event, index) =>
      index === 1 ? { ...event, payload: { ...event.payload, title: "rewritten" } } : event,
    );
    const report = replayChain(tampered);
    expect(report.ok).toBe(false);
    expect(report.firstBrokenSeq).toBe(2);
  });
});