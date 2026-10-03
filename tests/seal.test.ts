import { describe, expect, it } from "vitest";
import {
  GENESIS_SEAL,
  canonicalJson,
  nextSeal,
  replayChain,
  sealChain,
  sealHash,
} from "@/lib/seal/chain";

const EVENT_A = {
  type: "entry.created",
  at: "2026-03-01T08:00:00.000Z",
  actor: "Priya",
  entryId: "ent_1",
  payload: { title: "Metformin 500 mg", kind: "dose", status: "due" },
};

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("keeps array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("produces the same bytes regardless of key insertion order", () => {
    const first = canonicalJson({ z: 1, a: { y: 2, b: 3 } });
    const second = canonicalJson({ a: { b: 3, y: 2 }, z: 1 });
    expect(first).toBe(second);
  });

  it("drops undefined and keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("escapes control characters the JSON way", () => {
    expect(canonicalJson({ a: "line\nbreak" })).toBe('{"a":"line\\nbreak"}');
  });
});

describe("seal chain", () => {
  it("starts from the fixed genesis seal", () => {
    const first = nextSeal(GENESIS_SEAL, 1, EVENT_A);
    expect(first.prevSeal).toBe(GENESIS_SEAL);
    expect(first.seal).toHaveLength(96);
  });

  it("treats an empty previous seal as genesis", () => {
    expect(nextSeal("", 1, EVENT_A).seal).toBe(nextSeal(GENESIS_SEAL, 1, EVENT_A).seal);
  });

  it("matches pinned SHA-384 vectors", () => {
    // Vectors generated once and pinned here so a refactor cannot silently
    // change what "already happened". Recompute with scripts/print-vectors.ts.
    expect(canonicalJson(EVENT_A)).toBe(
      '{"actor":"Priya","at":"2026-03-01T08:00:00.000Z","entryId":"ent_1","payload":{"kind":"dose","status":"due","title":"Metformin 500 mg"},"type":"entry.created"}',
    );
    expect(sealHash(GENESIS_SEAL, EVENT_A)).toBe(
      "46baad335ca388c69b8c2813b07484584d75713f687b74d40a61d7c12225e52f12312c6ef0d0f99b0fba1ef6536c532e",
    );
expect(nextSeal(GENESIS_SEAL, 1, EVENT_A).seal).toBe(
      "46baad335ca388c69b8c2813b07484584d75713f687b74d40a61d7c12225e52f12312c6ef0d0f99b0fba1ef6536c532e",
    );
    const second = nextSeal(nextSeal(GENESIS_SEAL, 1, EVENT_A).seal, 2, {
      ...EVENT_A,
      type: "handover.sealed",
      actor: "Ravi",
      entryId: null,
      payload: { score: 71, verdict: "caution" },
    });
    expect(second.seal).toBe(
      "416879ba5469f7f39288b7a9655464e715646edb79897a06145e4803b464ddd18cbb9447e3c579324764700389caa0ee",
    );
  });

  it("changes the seal when any hashed field changes", () => {
    const base = nextSeal(GENESIS_SEAL, 1, EVENT_A).seal;
    const other = nextSeal(GENESIS_SEAL, 1, { ...EVENT_A, actor: "Ravi" }).seal;
    expect(other).not.toBe(base);
  });

  it("links each event to its predecessor", () => {
    const chain = sealChain([
      EVENT_A,
      { ...EVENT_A, entryId: "ent_2", type: "entry.updated" },
      { ...EVENT_A, entryId: "ent_3", type: "handover.sealed" },
    ]);
    expect(chain.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(chain[1].prevSeal).toBe(chain[0].seal);
    expect(chain[2].prevSeal).toBe(chain[1].seal);
  });
});

describe("replayChain", () => {
  const events = sealChain([
    EVENT_A,
    { ...EVENT_A, entryId: "ent_2", type: "entry.updated" },
  ]);
  const three = sealChain([
    EVENT_A,
    { ...EVENT_A, entryId: "ent_2", type: "entry.updated" },
    { ...EVENT_A, entryId: null, type: "handover.sealed" },
  ]);

  it("passes on an untouched chain", () => {
    const report = replayChain(events);
    expect(report.ok).toBe(true);
    expect(report.checkedEvents).toBe(2);
    expect(report.firstBrokenSeq).toBeNull();
    expect(report.headSeal).toBe(events[1].seal);
  });

  it("passes on an empty chain", () => {
    const report = replayChain([]);
    expect(report.ok).toBe(true);
    expect(report.headSeal).toBeNull();
  });

  it("detects a rewritten payload at the first broken seq", () => {
    const tampered = [{ ...events[0], payload: { ...events[0].payload, title: "Warfarin 5 mg" } }, events[1]];
    const report = replayChain(tampered);
    expect(report.ok).toBe(false);
    expect(report.firstBrokenSeq).toBe(1);
    expect(report.reason).toMatch(/seal mismatch/);
  });

  it("detects a removed middle event", () => {
    const report = replayChain([three[0], three[2]]);
    expect(report.ok).toBe(false);
    expect(report.firstBrokenSeq).toBe(3);
    expect(report.reason).toMatch(/sequence gap/);
  });

  it("detects a swapped prevSeal link", () => {
    const broken = [events[0], { ...events[1], prevSeal: GENESIS_SEAL }];
    const report = replayChain(broken);
    expect(report.ok).toBe(false);
    expect(report.reason).toMatch(/previous-seal mismatch/);
  });

  it("is order-insensitive on input but strict on sequence numbers", () => {
    const shuffled = [events[1], events[0]];
    expect(replayChain(shuffled).ok).toBe(true);
    const duplicated = [events[0], events[0], events[1]];
    expect(replayChain(duplicated).ok).toBe(false);
  });
});