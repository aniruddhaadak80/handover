import { describe, expect, it } from "vitest";
import { extractCareNote, extractCareRows } from "@/lib/engine/note-extract";

const BASE = new Date("2026-03-02T00:00:00.000Z");

const DISCHARGE = `Discharge summary — 02/03/2026
Continue Metformin 500 mg PO twice daily with meals.
Levothyroxine 75 mcg PO once daily on an empty stomach, 30 minutes before breakfast.
- Atorvastatin 20 mg at bedtime
Blood pressure 128/78, no swelling reported.
Avoid ibuprofen while on the current course.
Appointment: GP review on 12/03/2026.`;

describe("discharge-note extractor", () => {
  const rows = extractCareRows(DISCHARGE, BASE);

  it("finds the three medicines and ignores the prose", () => {
    const names = rows.map((row) => row.medication).join(" | ");
    expect(names).toContain("Metformin");
    expect(names).toContain("Levothyroxine");
    expect(names).toContain("Atorvastatin");
    expect(names.length).toBeLessThan(120);
  });

  it("extracts strength, route and food instruction", () => {
    const levo = rows.find((row) => row.medication?.startsWith("Levothyroxine"));
    expect(levo?.strength).toBe("75mcg");
    expect(levo?.route).toBe("oral");
    expect(levo?.instructions).toContain("empty stomach");
    expect(levo?.doseAmount).toBe("75mcg");
  });

  it("anchors twice-daily rows to a concrete clock time on the anchored day", () => {
    const metformin = rows.find((row) => row.medication?.startsWith("Metformin"));
    const expected = new Date(BASE.getTime());
    expected.setHours(9, 0, 0, 0);
    expect(metformin?.scheduledFor).toBe(expected.toISOString());
  });

  it("gives higher confidence to a full line than a bare mention", () => {
    const full = rows.find((row) => row.medication?.startsWith("Metformin"));
    const partial = rows.find((row) => row.medication?.startsWith("Atorvastatin"));
    expect(full!.confidence).toBeGreaterThan(partial!.confidence);
    expect(full!.confidence).toBeLessThanOrEqual(0.98);
  });

  it("skips stop instructions", () => {
    expect(rows.some((row) => (row.medication ?? "").toLowerCase().includes("ibuprofen"))).toBe(false);
  });

  it("keeps the source line as evidence", () => {
    const metformin = rows.find((row) => row.medication?.startsWith("Metformin"));
    expect(metformin?.evidence).toContain("Metformin");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(extractCareRows(DISCHARGE, BASE))).toBe(JSON.stringify(extractCareRows(DISCHARGE, BASE)));
  });

  it("returns an honest empty result for text with no medicines", () => {
    const result = extractCareNote("Patient is mobilising well and walked to the garden today.", BASE);
    expect(result.rows).toEqual([]);
    expect(result.method).toBe("deterministic");
    expect(result.notes[0]).toMatch(/No medicine-like lines/);
  });

  it("handles a transcript with run-on sentences", () => {
    const rows = extractCareRows("okay so give her the Ramipril 5 mg once daily in the morning; and bisoprolol 2.5 mg once daily also in the morning", BASE);
    expect(rows.map((row) => row.medication?.toLowerCase()).join(" ")).toContain("ramipril");
    expect(rows.map((row) => row.medication?.toLowerCase()).join(" ")).toContain("bisoprolol");
  });

  it("does not explode on empty input", () => {
    expect(extractCareRows("", BASE)).toEqual([]);
    expect(extractCareRows("   \n\n  ", BASE)).toEqual([]);
  });

  it("reports how many lines it skipped", () => {
    const result = extractCareNote(DISCHARGE, BASE);
    expect(result.matchedLines).toBe(3);
    expect(result.skippedLines).toBeGreaterThan(0);
  });
});