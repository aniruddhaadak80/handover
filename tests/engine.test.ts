import { describe, expect, it } from "vitest";
import { analyzeHandover, DEFAULT_WEIGHTS, DISCLAIMER } from "@/lib/engine/readiness";
import { ingredientTokens, sharesIngredient } from "@/lib/live/ingredients";
import type { CareBoard, CareEntry, DrugLookup } from "@/lib/types";

const BOARD: CareBoard = {
  id: "brd_1",
  subjectName: "Worked example",
  wardNote: "",
  timezone: "UTC",
  caregivers: ["Priya", "Ravi"],
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-02T00:00:00.000Z",
  deletedAt: null,
};

const ASOF = "2026-03-02T12:00:00.000Z";

let counter = 0;
function entry(patch: Partial<CareEntry> = {}): CareEntry {
  counter += 1;
  return {
    id: `ent_${counter}`,
    boardId: BOARD.id,
    kind: "dose",
    status: "due",
    title: "Metformin 500 mg",
    detail: "Taken with breakfast.",
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
    createdAt: "2026-03-02T08:00:00.000Z",
    updatedAt: "2026-03-02T08:00:00.000Z",
    ...patch,
  };
}

function cleanDose(patch: Partial<CareEntry> = {}): CareEntry {
  return entry({
    status: "given",
    occurredAt: patch.scheduledFor ?? "2026-03-02T09:00:00.000Z",
    detail: "Taken as scheduled, no side effects noted.",
    ...patch,
  });
}

function lookup(genericName: string, overrides: Partial<DrugLookup["drug"]> = {}): DrugLookup {
  return {
    query: genericName,
    ingredientTokens: ingredientTokens(genericName),
    status: "live",
    sources: [
      {
        id: "openfda-drug-label",
        name: "openFDA drug label API",
        status: "live",
        url: "https://open.fda.gov/apis/drug/label/",
        fetchedAt: ASOF,
      },
    ],
    drug: {
      rxcui: "6809",
      genericName,
      labelGenericName: genericName,
      brandNames: [],
      route: "ORAL",
      schedule: null,
      manufacturer: "Example",
      applicationNumber: "ANDA000000",
      sections: { indications: null, dosage: null, drugInteractions: null, contraindications: null, warnings: null, monitoring: null },
      flags: { hasBoxedWarning: false, hasContraindications: false, hasInteractionsSection: false, monitoringTerms: [] },
      sources: [],
      sample: false,
      ...overrides,
    },
  };
}

function run(entries: CareEntry[], drugLookups: Record<string, DrugLookup> = {}) {
  return analyzeHandover({ board: BOARD, entries, drugLookups, asOf: ASOF });
}

describe("ingredient normalizer", () => {
  it("strips dose, form and frequency noise", () => {
    expect(ingredientTokens("Metformin 500 mg (Glucophage) 1 tab twice daily with food")).toEqual(["metformin"]);
  });

  it("maps a brand onto its ingredient", () => {
    expect(ingredientTokens("Glucophage 500 mg")).toEqual(["metformin"]);
    expect(ingredientTokens("Novo Rapid pen")).toEqual(["insulin aspart"]);
  });

  it("ignores salt and formulation words", () => {
    expect(ingredientTokens("Levothyroxine sodium 75 mcg")).toEqual(["levothyroxine"]);
  });

  it("detects a shared ingredient between a brand and a generic", () => {
    expect(sharesIngredient("Glucophage 500 mg", "Metformin 500 mg")).toBe("metformin");
    expect(sharesIngredient("Atorvastatin 20 mg", "Metformin 500 mg")).toBeNull();
  });

  it("returns nothing for empty or nonsense input", () => {
    expect(ingredientTokens("")).toEqual([]);
    expect(ingredientTokens("the of and")).toEqual([]);
  });
});

describe("handover readiness engine", () => {
  it("is ready when every dose is accounted for and labels resolved", () => {
    const result = run(
      [
        cleanDose(),
        cleanDose({
          id: "e2",
          scheduledFor: "2026-03-02T21:00:00.000Z",
          occurredAt: "2026-03-02T21:00:00.000Z",
          medication: "Atorvastatin 20 mg",
          title: "Atorvastatin 20 mg",
          instructions: "at bedtime",
        }),
      ],
      { "Metformin 500 mg": lookup("Metformin"), "Atorvastatin 20 mg": lookup("Atorvastatin") },
    );
    expect(result.verdict).toBe("ready");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.blocking).toEqual([]);
    expect(result.engineVersion).toBe("2026.10.1");
  });

  it("withholds a clean verdict when no public label could be resolved", () => {
    const result = run([cleanDose()]);
    expect(result.verdict).toBe("caution");
    const label = result.factors.find((item) => item.key === "label_safety");
    expect(label?.evidence[0].detail).toContain("No public label");
  });

  it("flags an overdue dose under dose reconciliation", () => {
    const overdue = entry({ scheduledFor: "2026-03-02T07:00:00.000Z", status: "due" });
    const result = run([overdue]);
    const factor = result.factors.find((item) => item.key === "dose_reconciliation");
    expect(factor?.status).toBe("watch");
    expect(factor?.evidence.some((item) => item.entryId === overdue.id)).toBe(true);
    expect(result.verdict).toBe("caution");
  });

  it("holds the handover once enough doses are unconfirmed", () => {
    const result = run([
      entry({ id: "a", scheduledFor: "2026-03-02T07:00:00.000Z", status: "due" }),
      entry({ id: "b", scheduledFor: "2026-03-02T08:00:00.000Z", status: "due", medication: "Atorvastatin 20 mg", title: "Atorvastatin 20 mg" }),
      entry({ id: "c", scheduledFor: "2026-03-02T09:00:00.000Z", status: "due", medication: "Ramipril 5 mg", title: "Ramipril 5 mg" }),
    ]);
    expect(result.factors.find((item) => item.key === "dose_reconciliation")?.status).toBe("blocking");
    expect(result.verdict).toBe("hold");
  });

  it("catches two entries that resolve to one ingredient", () => {
    const result = run([
      cleanDose({ id: "a", medication: "Metformin 500 mg" }),
      cleanDose({ id: "b", scheduledFor: "2026-03-02T20:00:00.000Z", medication: "Glucophage 500 mg", title: "Glucophage 500 mg" }),
    ]);
    const factor = result.factors.find((item) => item.key === "duplicate_therapy");
    expect(factor?.value).toBe(65);
    expect(factor?.evidence[0].detail).toContain("metformin");
  });

  it("ignores a duplicate that was skipped", () => {
    const result = run([
      cleanDose({ id: "a", medication: "Metformin 500 mg" }),
      entry({ id: "b", medication: "Glucophage 500 mg", title: "Glucophage 500 mg", status: "skipped", scheduledFor: "2026-03-02T20:00:00.000Z" }),
    ]);
    const factor = result.factors.find((item) => item.key === "duplicate_therapy");
    expect(factor?.value).toBe(100);
  });

  it("flags a food-timing collision inside an hour", () => {
    const result = run([
      entry({ id: "a", instructions: "with food", scheduledFor: "2026-03-02T07:00:00.000Z", occurredAt: "2026-03-02T07:00:00.000Z", status: "given", medication: "Metformin 500 mg" }),
      entry({ id: "b", instructions: "empty stomach", scheduledFor: "2026-03-02T07:30:00.000Z", medication: "Levothyroxine 75 mcg", title: "Levothyroxine 75 mcg" }),
    ]);
    const factor = result.factors.find((item) => item.key === "timing_risk");
    expect(factor?.value).toBe(70);
    expect(factor?.evidence[0].detail).toContain("empty stomach");
  });

  it("resolves a label lookup through ingredient tokens, not exact strings", () => {
    const result = run(
      [entry({ medication: "Warfarin 5 mg", title: "Warfarin 5 mg" })],
      { Warfarin: lookup("Warfarin", { flags: { hasBoxedWarning: true, hasContraindications: true, hasInteractionsSection: true, monitoringTerms: ["inr"] } }) },
    );
    const factor = result.factors.find((item) => item.key === "label_safety");
    expect(factor?.value).toBe(52);
    expect(result.verdict).toBe("hold");
  });

  it("refuses to treat an offline shelf as safe", () => {
    const result = run([entry({ medication: "Unknownpill 5 mg", title: "Unknownpill 5 mg" })], {
      "Unknownpill 5 mg": { ...lookup("Unknownpill", { sample: true }), status: "fallback", sources: [] },
    });
    const factor = result.factors.find((item) => item.key === "label_safety");
    expect(factor?.evidence[0].detail).toContain("No public label");
  });

  it("punishes thin documentation", () => {
    const result = run([entry({ detail: "", doseAmount: null })]);
    const factor = result.factors.find((item) => item.key === "documentation");
    expect(factor?.value).toBe(82);
  });

  it("treats an empty board as holdable, not as ready", () => {
    const result = run([]);
    expect(result.verdict).toBe("hold");
    expect(result.factors.find((item) => item.key === "documentation")?.evidence).toEqual([]);
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it("survives malformed timestamps without throwing", () => {
    const broken = [entry({ scheduledFor: "not-a-date" }), entry({ id: "e2", scheduledFor: null, occurredAt: null })];
    const result = run(broken);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.factors).toHaveLength(6);
  });

  it("is byte-identical across runs and insensitive to input order", () => {
    const a = [
      cleanDose({ id: "a" }),
      cleanDose({ id: "b", scheduledFor: "2026-03-02T21:00:00.000Z", occurredAt: "2026-03-02T21:00:00.000Z", medication: "Atorvastatin 20 mg", title: "Atorvastatin 20 mg" }),
    ];
    const lookups = { "Metformin 500 mg": lookup("Metformin"), "Atorvastatin 20 mg": lookup("Atorvastatin") };
    const first = JSON.stringify(run(a, lookups));
    const second = JSON.stringify(run([...a].reverse(), lookups));
    const third = JSON.stringify(run(a, lookups));
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("returns contributions that sum to the score within rounding", () => {
    const result = run(
      [
        cleanDose(),
        cleanDose({
          id: "e2",
          scheduledFor: "2026-03-02T21:00:00.000Z",
          occurredAt: "2026-03-02T21:00:00.000Z",
          medication: "Atorvastatin 20 mg",
          title: "Atorvastatin 20 mg",
        }),
      ],
      { "Metformin 500 mg": lookup("Metformin"), "Atorvastatin 20 mg": lookup("Atorvastatin") },
    );
    const summed = result.factors.reduce((total, factor) => total + factor.contribution, 0);
    // Six contributions rounded to 2dp plus one integer score: half a point of slack.
    expect(Math.abs(summed - result.score)).toBeLessThanOrEqual(0.55);
  });

  it("reacts to weights instead of ignoring them", () => {
    const entries = [entry({ scheduledFor: "2026-03-02T07:00:00.000Z", status: "due" })];
    const heavy = analyzeHandover({
      board: BOARD,
      entries,
      drugLookups: {},
      asOf: ASOF,
      weights: { ...DEFAULT_WEIGHTS, handover_freshness: 2, dose_reconciliation: 0.01 },
    });
    const light = analyzeHandover({
      board: BOARD,
      entries,
      drugLookups: {},
      asOf: ASOF,
      weights: { ...DEFAULT_WEIGHTS, handover_freshness: 0.01, dose_reconciliation: 2 },
    });
    expect(heavy.score).toBeGreaterThan(light.score);
  });

  it("attributes upstream label sources once, sorted, and cites them on the evidence", () => {
    const warfarin = entry({ medication: "Warfarin 5 mg", title: "Warfarin 5 mg" });
    const result = run([warfarin], {
      Warfarin: lookup("Warfarin", { flags: { hasBoxedWarning: true, hasContraindications: false, hasInteractionsSection: false, monitoringTerms: ["inr"] } }),
    });
    expect(result.sources.map((source) => source.id)).toEqual(["openfda-drug-label"]);
    const factor = result.factors.find((item) => item.key === "label_safety");
    expect(factor?.evidence[0].sourceId).toBe("openfda-drug-label");
    expect(factor?.evidence[0].sourceStatus).toBe("live");
    expect(factor?.evidence[0].entryId).toBe(warfarin.id);
  });
});