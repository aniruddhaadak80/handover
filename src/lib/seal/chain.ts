import { createHash } from "node:crypto";

/**
 * Canonical JSON: object keys sorted recursively, arrays keep their order,
 * undefined dropped, numbers and strings via JSON semantics. Stable across
 * Node versions and platforms, which is what makes the seal reproducible.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") return Number.isFinite(value as number) ? JSON.stringify(value) : "null";
  if (t === "boolean") return (value as boolean) ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (t === "undefined") return "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return "null";
}

/** 96 hex characters: SHA-384 over UTF-8, lowercased. */
export function sealHash(previousSeal: string, event: unknown): string {
  return createHash("sha384")
    .update(Buffer.from(previousSeal, "utf8"))
    .update(Buffer.from(canonicalJson(event), "utf8"))
    .digest("hex");
}

/** Genesis previous-seal for an empty chain. Fixed forever. */
export const GENESIS_SEAL = "0".repeat(96);

export type ChainInput = {
  type: string;
  at: string;
  actor: string;
  entryId: string | null;
  payload: Record<string, unknown>;
};

export type SealedEvent = ChainInput & {
  seq: number;
  prevSeal: string;
  seal: string;
};

/**
 * The only body of a seal. `seq` is deliberately outside the hashed body so a
 * re-order is caught by prevSeal linkage rather than by the digest itself.
 */
function sealBody(event: ChainInput): ChainInput {
  return {
    type: event.type,
    at: event.at,
    actor: event.actor,
    entryId: event.entryId,
    payload: event.payload,
  };
}

/** Append one event to an existing chain, returning the sealed row. */
export function nextSeal(previousSeal: string, seq: number, event: ChainInput): SealedEvent {
  const prevSeal = previousSeal === "" ? GENESIS_SEAL : previousSeal;
  const seal = sealHash(prevSeal, sealBody(event));
  return { ...event, seq, prevSeal, seal };
}

/** Rebuild a whole chain from ordered, unsealed events. */
export function sealChain(events: ChainInput[]): SealedEvent[] {
  const out: SealedEvent[] = [];
  let prev = GENESIS_SEAL;
  events.forEach((event, index) => {
    const sealed = nextSeal(prev, index + 1, event);
    out.push(sealed);
    prev = sealed.seal;
  });
  return out;
}

export type ReplayResult = {
  ok: boolean;
  checkedEvents: number;
  firstBrokenSeq: number | null;
  reason: string | null;
  headSeal: string | null;
};

export type StoredEvent = {
  seq: number;
  type: string;
  at: string;
  actor: string;
  entryId: string | null;
  payload: Record<string, unknown>;
  prevSeal: string;
  seal: string;
};

/** Walk stored rows in order and report the first link that does not hold. */
export function replayChain(rows: StoredEvent[]): ReplayResult {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_SEAL;

  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i];
    const expectedSeq = i + 1;
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        checkedEvents: i,
        firstBrokenSeq: row.seq,
        reason: `sequence gap: expected seq ${expectedSeq} but stored row has seq ${row.seq}`,
        headSeal: prev,
      };
    }
    if (row.prevSeal !== prev) {
      return {
        ok: false,
        checkedEvents: i,
        firstBrokenSeq: row.seq,
        reason: `previous-seal mismatch at seq ${row.seq}`,
        headSeal: prev,
      };
    }
    const expected = sealHash(prev, sealBody(row));
    if (expected !== row.seal) {
      return {
        ok: false,
        checkedEvents: i,
        firstBrokenSeq: row.seq,
        reason: `seal mismatch at seq ${row.seq}`,
        headSeal: prev,
      };
    }
    prev = row.seal;
  }

  return {
    ok: true,
    checkedEvents: ordered.length,
    firstBrokenSeq: null,
    reason: null,
    headSeal: ordered.length > 0 ? prev : null,
  };
}