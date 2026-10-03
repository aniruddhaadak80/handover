import { ingredientTokens as ingredientTokensOf } from "../live/ingredients";
import {
  ENGINE_VERSION,
  type CareBoard,
  type CareEntry,
  type DrugLookup,
  type FactorKey,
  type FactorResult,
  type HandoverAnalysis,
  type HandoverVerdict,
  type SourceMeta,
} from "../types";

export const DEFAULT_WEIGHTS: Record<FactorKey, number> = {
  dose_reconciliation: 0.24,
  timing_risk: 0.16,
  duplicate_therapy: 0.22,
  label_safety: 0.16,
  handover_freshness: 0.14,
  documentation: 0.1,
};

export const FACTOR_LABELS: Record<FactorKey, string> = {
  dose_reconciliation: "Dose reconciliation",
  timing_risk: "Timing risk",
  duplicate_therapy: "Duplicate therapy",
  label_safety: "Label safety signals",
  handover_freshness: "Handover freshness",
  documentation: "Documentation",
};

export { ENGINE_VERSION };

export const DISCLAIMER =
  "Handover surfaces record-keeping gaps and public label signals. It is not a clinician, does not diagnose, and never tells anyone to start, stop, or change a dose. Decisions belong with the prescriber or pharmacist.";

const HOUR_MS = 3600_000;

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function time(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Stable ordering used everywhere: instant, then id. */
function byInstant(a: CareEntry, b: CareEntry): number {
  const at = time(a.occurredAt ?? a.scheduledFor ?? a.createdAt) ?? 0;
  const bt = time(b.occurredAt ?? b.scheduledFor ?? b.createdAt) ?? 0;
  return at - bt || a.id.localeCompare(b.id);
}

export type ReadinessInput = {
  board: CareBoard;
  entries: CareEntry[];
  /** medication string -> lookup result. Missing keys mean "not looked up". */
  drugLookups: Record<string, DrugLookup>;
  /** Reference moment, ISO-8601. Passed in so the engine stays pure. */
  asOf: string;
  weights?: Partial<Record<FactorKey, number>>;
  /** How far either side of `asOf` the schedule window reaches. */
  windowHours?: number;
  /** Board seal at compute time; echoed back so a brief is verifiable. */
  seal?: string | null;
};

/**
 * Resolve which lookup belongs to a free-text medicine string.
 * Exact matches win; otherwise the ingredient normalizer decides, so
 * "Warfarin 5 mg" still finds the lookup stored under "Warfarin".
 * Iteration order is sorted, so the answer never depends on object key order.
 */
export function findLookupFor(
  medication: string | null,
  drugLookups: Record<string, DrugLookup>,
): DrugLookup | null {
  if (!medication) return null;
  const needle = medication.trim().toLowerCase();
  if (needle.length === 0) return null;

  const keys = Object.keys(drugLookups).sort();
  const entries = keys.map((key) => drugLookups[key]).filter((item): item is DrugLookup => Boolean(item));

  for (const lookup of entries) {
    if (lookup.query.trim().toLowerCase() === needle) return lookup;
    if (lookup.drug.genericName.trim().toLowerCase() === needle) return lookup;
    if (lookup.drug.brandNames.some((brand) => brand.trim().toLowerCase() === needle)) return lookup;
  }

  const needleTokens = ingredientTokensOf(needle);
  if (needleTokens.length === 0) return null;
  for (const lookup of entries) {
    const candidateTokens = new Set([
      ...ingredientTokensOf(lookup.query),
      ...ingredientTokensOf(lookup.drug.genericName),
      ...lookup.ingredientTokens,
      ...lookup.drug.brandNames.flatMap((brand) => ingredientTokensOf(brand)),
    ]);
    if (needleTokens.some((token) => candidateTokens.has(token))) return lookup;
  }
  return null;
}


type Penalty = { detail: string; penalty: number; entryId?: string };

type FactorInput = {
  value: number;
  evidence: Penalty[];
  summary: string;
};

type FactorContext = {
  entriesById: Map<string, CareEntry>;
  drugLookups: Record<string, DrugLookup>;
};

/** Attach the upstream label citation for the medicine an evidence item came from. */
function lookupCitation(medication: string | null, drugLookups: Record<string, DrugLookup>) {
  if (!medication) return {};
  const hit = findLookupFor(medication, drugLookups);
  const source = hit?.sources.find((item) => item.id === "openfda-drug-label") ?? hit?.sources[0];
  if (!source) return {};
  return { sourceId: source.id, sourceUrl: source.url, sourceStatus: source.status };
}

function buildFactor(
  key: FactorKey,
  input: FactorInput,
  weight: number,
  totalWeight: number,
  context: FactorContext,
): FactorResult {
  const score = round1(clamp(input.value));
  return {
    key,
    label: FACTOR_LABELS[key],
    weight: round2(weight),
    value: score,
    contribution: round2((weight * score) / totalWeight),
    status: score >= 85 ? "clear" : score >= 55 ? "watch" : "blocking",
    summary: input.summary,
    evidence: input.evidence.map((item) => {
      const medication = item.entryId ? (context.entriesById.get(item.entryId)?.medication ?? null) : null;
      return {
        kind: key,
        detail: item.detail,
        penalty: item.penalty,
        ...(item.entryId ? { entryId: item.entryId } : {}),
        ...lookupCitation(medication, context.drugLookups),
      };
    }),
  };
}

function factorDoseReconciliation(doses: CareEntry[], asOfMs: number): { value: number; evidence: Penalty[]; summary: string } {
  const evidence: Penalty[] = [];
  if (doses.length === 0) {
    return {
      value: 62,
      evidence: [{ detail: "No medication dose is scheduled in the active window.", penalty: 38 }],
      summary: "Nothing is scheduled, so nothing can be reconciled. Check the schedule before handing over.",
    };
  }

  let penalty = 0;
  let overdue = 0;
  let late = 0;
  for (const dose of doses) {
    const scheduled = time(dose.scheduledFor);
    if (dose.status === "due" && scheduled !== null && scheduled < asOfMs) {
      overdue += 1;
      evidence.push({
        detail: `"${dose.title}" is still marked due but its time has passed.`,
        penalty: 0,
        entryId: dose.id,
      });
    }
    if (dose.status === "given" && time(dose.occurredAt) === null) {
      penalty += 6;
      evidence.push({
        detail: `"${dose.title}" is marked given with no time recorded.`,
        penalty: 6,
        entryId: dose.id,
      });
    }
    if (dose.status === "given" && scheduled !== null && time(dose.occurredAt) !== null && (time(dose.occurredAt) as number) - scheduled > 4 * HOUR_MS) {
      late += 1;
      evidence.push({
        detail: `"${dose.title}" was logged more than 4 hours after its scheduled time.`,
        penalty: 4,
        entryId: dose.id,
      });
    }
  }

  penalty += overdue * 20 + late * 4;
  return {
    value: 100 - penalty,
    evidence,
    summary:
      overdue === 0 && late === 0
        ? `${doses.length} scheduled dose${doses.length === 1 ? "" : "s"} in the window are all accounted for.`
        : `${overdue} dose${overdue === 1 ? " is" : "s are"} unconfirmed and ${late} logged late in the current window.`,
  };
}

function factorTimingRisk(doses: CareEntry[]): { value: number; evidence: Penalty[]; summary: string } {
  const evidence: Penalty[] = [];
  const sorted = [...doses].sort(byInstant);

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const a = time(previous.scheduledFor ?? previous.occurredAt);
    const b = time(current.scheduledFor ?? current.occurredAt);
    if (a === null || b === null) continue;
    const gapMinutes = (b - a) / 60_000;

    if (gapMinutes === 0 && previous.medication !== current.medication) {
      evidence.push({
        detail: `"${previous.title}" and "${current.title}" are scheduled at the same minute.`,
        penalty: 10,
        entryId: current.id,
      });
      continue;
    }

    if (gapMinutes > 0 && gapMinutes <= 60) {
      const apart = gapMinutes < 120 ? `${Math.round(gapMinutes)} minutes` : `${round1(gapMinutes / 60)} hours`;
      const before = previous.instructions ?? "";
      const after = current.instructions ?? "";
      const emptyStomach = /empty stomach|before food|before meals|fasting/i;
      const withFood = /with food|after food|after meals|with meals/i;
      if (emptyStomach.test(after) && withFood.test(before)) {
        evidence.push({
          detail: `"${current.title}" needs an empty stomach while "${previous.title}" is marked with food, and they are ${apart} apart.`,
          penalty: 30,
          entryId: current.id,
        });
      } else if (withFood.test(after) && emptyStomach.test(before)) {
        evidence.push({
          detail: `"${current.title}" is marked with food while "${previous.title}" needs an empty stomach, and they are ${apart} apart.`,
          penalty: 30,
          entryId: current.id,
        });
      }
    }

    if (previous.medication && previous.medication === current.medication && gapMinutes > 12) {
      evidence.push({
        detail: `${round1(gapMinutes / 24)} day gap between two "${previous.medication}" entries.`,
        penalty: 12,
        entryId: current.id,
      });
    }
  }

  const penalty = Math.min(70, evidence.reduce((sum, item) => sum + item.penalty, 0));
  return {
    value: 100 - penalty,
    evidence,
    summary:
      evidence.length === 0
        ? "Scheduled doses do not collide and no food-timing instructions conflict."
        : `${evidence.length} schedule collision${evidence.length === 1 ? "" : "s"} between nearby doses.`,
  };
}

function factorDuplicateTherapy(doses: CareEntry[]): { value: number; evidence: Penalty[]; summary: string } {
  const evidence: Penalty[] = [];
  const active = doses.filter((dose) => dose.status !== "skipped" && Boolean(dose.medication));
  const seen = new Map<string, CareEntry>();

  for (const dose of [...active].sort(byInstant)) {
    const medication = dose.medication as string;
    const tokens = ingredientTokensOf(medication);
    if (tokens.length === 0) continue;
    for (const token of tokens) {
      const previous = seen.get(token);
      if (previous && previous.id !== dose.id) {
        evidence.push({
          detail: `"${previous.title}" and "${dose.title}" both resolve to the ingredient "${token}". Two entries for one ingredient is the classic duplicate-therapy record.`,
          penalty: 35,
          entryId: dose.id,
        });
        break;
      }
    }
    for (const token of tokens) {
      if (!seen.has(token)) seen.set(token, dose);
    }
  }

  const penalty = Math.min(70, evidence.reduce((sum, item) => sum + item.penalty, 0));
  return {
    value: 100 - penalty,
    evidence,
    summary:
      evidence.length === 0
        ? "No two scheduled entries resolve to the same active ingredient."
        : `${evidence.length} ingredient overlap${evidence.length === 1 ? "" : "s"} between entries on this board.`,
  };
}

function factorLabelSafety(
  doses: CareEntry[],
  drugLookups: Record<string, DrugLookup>,
): { value: number; evidence: Penalty[]; summary: string } {
  const evidence: Penalty[] = [];
  const medications = [...new Set(doses.map((dose) => dose.medication).filter((item): item is string => Boolean(item)))].sort();
  let looked = 0;

  for (const medication of medications) {
    const lookup = findLookupFor(medication, drugLookups);
    const sampleEntry = doses.find((dose) => dose.medication === medication);
    if (!lookup || lookup.drug.sample) {
      evidence.push({
        detail: `No public label was available for "${medication}", so its label signals were not scored.`,
        penalty: 18,
        ...(sampleEntry ? { entryId: sampleEntry.id } : {}),
      });
      continue;
    }
    looked += 1;
    const flags = lookup.drug.flags;
    if (flags.hasBoxedWarning) {
      evidence.push({
        detail: `The openFDA label for ${lookup.drug.genericName} carries a boxed warning section. Confirm the prescriber has discussed it before handing over.`,
        penalty: 30,
        ...(sampleEntry ? { entryId: sampleEntry.id } : {}),
      });
    }
    if (flags.hasContraindications) {
      evidence.push({
        detail: `${lookup.drug.genericName} has a contraindications section in its label.`,
        penalty: 12,
        ...(sampleEntry ? { entryId: sampleEntry.id } : {}),
      });
    }
    if (flags.hasInteractionsSection) {
      evidence.push({
        detail: `${lookup.drug.genericName} has a drug-interactions section; a pharmacist check is the safe route.`,
        penalty: 6,
        ...(sampleEntry ? { entryId: sampleEntry.id } : {}),
      });
    }
  }

  const penalty = Math.min(70, evidence.reduce((sum, item) => sum + item.penalty, 0));
  return {
    value: 100 - penalty,
    evidence,
    summary:
      looked === 0
        ? "No live label was retrieved, so label signals are unscored rather than assumed safe."
        : `${looked} medicine${looked === 1 ? "" : "s"} checked against public label sections.`,
  };
}

function factorFreshness(entries: CareEntry[], asOfMs: number): { value: number; evidence: Penalty[]; summary: string } {
  const evidence: Penalty[] = [];
  if (entries.length === 0) {
    return {
      value: 60,
      evidence: [{ detail: "The board has no entries yet, so nothing has been handed over.", penalty: 40 }],
      summary: "An empty board cannot be handed over safely.",
    };
  }

  const latest = [...entries].sort(byInstant).pop() as CareEntry;
  const latestMs = time(latest.occurredAt ?? latest.scheduledFor ?? latest.createdAt) ?? asOfMs;
  const hoursSince = (asOfMs - latestMs) / HOUR_MS;
  let penalty = 0;
  if (hoursSince > 24) {
    penalty += 30;
    evidence.push({ detail: `The newest entry on this board is ${round1(hoursSince / 24)} days old.`, penalty: 30 });
  } else if (hoursSince > 12) {
    penalty += 18;
    evidence.push({ detail: `Nothing has been recorded for ${round1(hoursSince)} hours.`, penalty: 18 });
  } else if (hoursSince > 6) {
    penalty += 8;
    evidence.push({ detail: `Nothing has been recorded for ${round1(hoursSince)} hours.`, penalty: 8 });
  }

  const unassigned = entries.filter((entry) => entry.assignedTo === null || entry.assignedTo.trim().length === 0);
  if (unassigned.length > 0) {
    const share = Math.min(30, unassigned.length * 10);
    penalty += share;
    evidence.push({
      detail: `${unassigned.length} entr${unassigned.length === 1 ? "y has" : "ies have"} no named caregiver, so nobody knows who owns it.`,
      penalty: share,
    });
  }

  return {
    value: 100 - penalty,
    evidence,
    summary:
      penalty === 0
        ? `Last recorded ${round1(hoursSince)}h ago and every entry has an owner.`
        : `Handover is stale or unowned: ${evidence.length} issue${evidence.length === 1 ? "" : "s"}.`,
  };
}

function factorDocumentation(entries: CareEntry[]): { value: number; evidence: Penalty[]; summary: string } {
  const evidence: Penalty[] = [];
  let penalty = 0;

  for (const entry of entries) {
    if (entry.kind === "dose" && (!entry.doseAmount || entry.doseAmount.trim().length === 0)) {
      penalty += 12;
      evidence.push({ detail: `"${entry.title}" has no dose amount written down.`, penalty: 12, entryId: entry.id });
    }
    if (entry.detail.trim().length < 8) {
      penalty += 6;
      evidence.push({ detail: `"${entry.title}" has no usable note.`, penalty: 6, entryId: entry.id });
    }
  }
  penalty = Math.min(60, penalty);
  return {
    value: 100 - penalty,
    evidence,
    summary:
      penalty === 0
        ? "Every entry carries a dose amount and a usable note."
        : `${evidence.length} entr${evidence.length === 1 ? "y is" : "ies are"} too thin for the next person to trust.`,
  };
}


function decideVerdict(score: number, factors: FactorResult[]): { verdict: HandoverVerdict; decision: string } {
  const blocking = factors.filter((factor) => factor.status === "blocking");
  if (blocking.length > 0) {
    return {
      verdict: "hold",
      decision: `Hold the handover: ${blocking.map((factor) => factor.label.toLowerCase()).join(", ")} need a person, not a checklist.`,
    };
  }
  const watch = factors.filter((factor) => factor.status === "watch");
  if (score < 70 || watch.length > 0) {
    return {
      verdict: "caution",
      decision:
        watch.length > 0
          ? `Hand over with a spoken warning: ${watch.map((factor) => factor.label.toLowerCase()).join(", ")}.`
          : "Hand over, but read the open items out loud first.",
    };
  }
  return { verdict: "ready", decision: "Clean handover: nothing blocking, nothing stale." };
}

/**
 * Handover readiness, version ${ENGINE_VERSION}.
 *
 * score = weighted mean of the six factor values. Every penalty is itemized in
 * `evidence` with the entry or the upstream label section that caused it, so
 * the number can always be read back to a source.
 */
export function analyzeHandover(input: ReadinessInput): HandoverAnalysis {
  const { board, entries, drugLookups, asOf } = input;
  const asOfMs = time(asOf) ?? 0;
  const windowHours = input.windowHours ?? 24;
  const weights = { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) };
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;

  const entriesById = new Map<string, CareEntry>();
  for (const item of entries) entriesById.set(item.id, item);
  const context: FactorContext = { entriesById, drugLookups };

  const doses = entries
    .filter((entry) => entry.kind === "dose")
    .filter((entry) => {
      const stamp = time(entry.scheduledFor ?? entry.occurredAt);
      if (stamp === null) return false;
      return Math.abs(stamp - asOfMs) <= windowHours * HOUR_MS;
    })
    .sort(byInstant);

  const sources: SourceMeta[] = [];
  for (const lookup of Object.values(drugLookups)) {
    for (const source of lookup.sources) {
      if (!sources.some((item) => item.id === source.id)) sources.push(source);
    }
  }
  sources.sort((a, b) => a.id.localeCompare(b.id));

  const reconciliation = factorDoseReconciliation(doses, asOfMs);
  const timing = factorTimingRisk(doses);
  const duplicates = factorDuplicateTherapy(doses);
  const label = factorLabelSafety(doses, drugLookups);
  const freshness = factorFreshness(entries, asOfMs);
  const documentation = factorDocumentation(entries);

  const factors: FactorResult[] = [
    buildFactor("dose_reconciliation", reconciliation, weights.dose_reconciliation, totalWeight, context),
    buildFactor("timing_risk", timing, weights.timing_risk, totalWeight, context),
    buildFactor("duplicate_therapy", duplicates, weights.duplicate_therapy, totalWeight, context),
    buildFactor("label_safety", label, weights.label_safety, totalWeight, context),
    buildFactor("handover_freshness", freshness, weights.handover_freshness, totalWeight, context),
    buildFactor("documentation", documentation, weights.documentation, totalWeight, context),
  ];

  const weighted = factors.reduce((sum, factor) => sum + factor.weight * factor.value, 0) / totalWeight;
  const score = Math.round(weighted);
  const decided = decideVerdict(score, factors);
  const verdict: HandoverVerdict = entries.length === 0 ? "hold" : decided.verdict;
  const decision =
    entries.length === 0
      ? "Hold the handover: this board is empty, so there is nothing to hand over yet."
      : decided.decision;
  const blocking = (
    entries.length === 0
      ? [...factors.filter((factor) => factor.status !== "clear").map((factor) => factor.key), "dose_reconciliation" as FactorKey]
      : factors.filter((factor) => factor.status === "blocking").map((factor) => factor.key)
  )
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort();

  const blockingIssues = factors
    .flatMap((factor) => factor.evidence.filter((item) => item.penalty > 0).map((item) => item.detail))
    .slice(0, 12);

  return {
    engineVersion: ENGINE_VERSION,
    boardId: board.id,
    computedAt: asOf,
    asOf,
    score,
    verdict,
    decision,
    factors,
    blocking,
    openDoses: doses.filter((dose) => dose.status === "due" || dose.status === "blocked").length,
    blockingIssues,
    seal: input.seal ?? null,
    sources,
    disclaimer: DISCLAIMER,
  };
}