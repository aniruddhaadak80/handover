import type { ExtractedRow } from "../validation";

/**
 * Deterministic discharge-note / voice-memo extractor.
 *
 * No model, no network: the same text always yields the same draft rows, which
 * is what makes an imported regimen reviewable before it touches a board. The
 * optional on-device model in the UI refines rows a human has already chosen;
 * it never invents a medicine out of nothing.
 */

const DOSAGE_FORMS =
  "tablet|tab|tabs|capsule|cap|caps|patch|suppository|supp|sachets?|solution|injection|inj";

const ROUTES: Record<string, string> = {
  po: "oral",
  "p.o": "oral",
  "p.o.": "oral",
  "by mouth": "oral",
  oral: "oral",
  iv: "intravenous",
  intravenous: "intravenous",
  im: "intramuscular",
  intramuscular: "intramuscular",
  subq: "subcutaneous",
  sc: "subcutaneous",
  subcutaneous: "subcutaneous",
  topical: "topical",
  sublingual: "sublingual",
  sl: "sublingual",
  pr: "rectal",
  rectal: "rectal",
  inhaled: "inhaled",
};

const FREQUENCIES: { pattern: RegExp; times: string[]; label: string }[] = [
  { pattern: /\b(every\s*8\s*hours|q8h|8\s*hourly)\b/i, times: ["08:00", "16:00", "00:00"], label: "every 8 hours" },
  { pattern: /\b(every\s*6\s*hours|q6h|6\s*hourly)\b/i, times: ["08:00", "14:00", "20:00"], label: "every 6 hours" },
  { pattern: /\b(three\s*times?\s*(daily|a\s*day)|tid|three\s*x)\b/i, times: ["08:00", "14:00", "20:00"], label: "three times daily" },
  { pattern: /\b(twice\s*(daily|a\s*day)|bid|twice\s*x)\b/i, times: ["09:00", "21:00"], label: "twice daily" },
  { pattern: /\b(at\s*bedtime|hs\b|qhs|nightly|at\s*night)\b/i, times: ["22:00"], label: "at bedtime" },
  { pattern: /\b(morning\s*only|qam|in\s*the\s*morning)\b/i, times: ["08:00"], label: "in the morning" },
  { pattern: /\b(once\s*(daily|a\s*day)|daily|qd|od|every\s*day)\b/i, times: ["09:00"], label: "once daily" },
  { pattern: /\b(weekly|once\s*a\s*week)\b/i, times: ["09:00"], label: "weekly" },
  { pattern: /\b(as\s*needed|prn)\b/i, times: [], label: "as needed" },
];

const FOOD_HINTS: { pattern: RegExp; label: string }[] = [
  { pattern: /empty\s*stomach|before\s*food|before\s*meals|before\s*breakfast|fasting/i, label: "empty stomach" },
  { pattern: /with\s*(food|meals|breakfast|lunch|dinner)|after\s*(food|meals)/i, label: "with food" },
  { pattern: /at\s*bedtime|at\s*night/i, label: "at bedtime" },
];

/** Words that can never be a medicine name. */
const NOT_A_NAME = new Set([
  "take", "continue", "start", "give", "hold", "stop", "discontinue", "the", "and", "also",
  "now", "then", "with", "without", "daily", "twice", "once", "three", "each", "per", "as",
  "needed", "patient", "dose", "dosage", "medication", "medicines", "tablet", "tab", "tabs",
  "capsule", "cap", "caps", "patch", "suppository", "sachet", "sachets", "solution", "injection",
  "before", "after", "meals", "meal", "food", "breakfast", "lunch", "dinner", "bedtime",
  "night", "morning", "evening", "nightly", "hours", "hour", "review", "appointment", "discharge",
  "summary", "blood", "pressure", "weight", "swelling", "pain", "slept", "walked", "showered",
  "minutes", "minute", "water", "glass", "swallow", "swallowed", "reported", "reports", "fine",
  "good", "okay", "she", "her", "him", "his", "today", "yesterday", "tomorrow", "days", "day",
  "weeks", "week", "month", "nurse", "doctor", "gp", "hospital", "discharged", "home", "course",
  "since", "plus", "plus", "please", "remember", "note", "notes",
]);

const STRENGTH_PATTERN = /\b(\d+(?:\.\d+)?)\s*(mg|mcg|ug|g|ml|iu|units?)\b/i;
const STRENGTH_TAIL = "\\d+(?:\\.\\d+)?\\s*(?:mg|mcg|ug|g|ml|iu|units?)\\b";
const FORM_TAIL = new RegExp(`\\d+\\s+(?:${DOSAGE_FORMS})\\b`, "i");

function isoAt(base: Date, time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(base.getTime());
  next.setHours(hours, minutes, 0, 0);
  return next.toISOString();
}

function normalizeRoute(text: string): string | null {
  const lower = ` ${text.toLowerCase()} `;
  let best: string | null = null;
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const [needle, canonical] of Object.entries(ROUTES)) {
    const index = lower.indexOf(` ${needle} `);
    if (index >= 0 && index < bestIndex) {
      bestIndex = index;
      best = canonical;
    }
  }
  return best;
}

function splitLines(note: string): string[] {
  const bullet = new RegExp("^[\\s\\-\\u2022*\\u2013\\u2014]+");
  return note
    .split(/\r?\n|;\s*(?=[A-Za-z])/)
    .map((line) => line.replace(bullet, "").trim())
    .filter((line) => line.length >= 3);
}

/**
 * Pick the medicine name from a line.
 *
 * Scores every word on what follows it, because a real medicine line almost
 * always puts a dose, a form or a frequency right after the name. That beats
 * "first capitalised word", which happily returns "Discharge" or "Okay".
 */
function pickName(words: string[]): { name: string; weight: number } | null {
  let best: { name: string; weight: number } | null = null;

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const word = raw.replace(/[^A-Za-z'\-]/g, "");
    if (word.length < 4) continue;
    if (NOT_A_NAME.has(word.toLowerCase())) continue;
    if (FREQUENCIES.some((entry) => new RegExp(`^(?:${entry.label.split(" ")[0]})$`, "i").test(word))) continue;

    const tail = words.slice(i + 1, i + 4).join(" ");
    const remainder = words.slice(i + 1, i + 7).join(" ");

    let weight = 0;
    if (new RegExp(`^\\s*${STRENGTH_TAIL}`, "i").test(tail)) weight += 3;
    else if (new RegExp(`^\\s*${FORM_TAIL.source}`, "i").test(tail)) weight += 2;
    if (FREQUENCIES.some((entry) => entry.pattern.test(remainder))) weight += 1;
    if (/^[A-Z]/.test(raw)) weight += 1;
    if (weight < 2) continue;
    if (!best || weight > best.weight) best = { name: word, weight };
  }

  return best;
}

/**
 * @param note  Raw discharge summary or memo transcript.
 * @param baseDate  Day the schedule is anchored to. Injected so tests are deterministic.
 */
export function extractCareRows(note: string, baseDate: Date = new Date()): ExtractedRow[] {
  const rows: ExtractedRow[] = [];
  const seen = new Set<string>();

  for (const line of splitLines(note)) {
    if (/\b(avoid|do not take|stop taking|discontinue|hold)\b/i.test(line)) continue;

    const words = line.split(/\s+/);
    const picked = pickName(words);
    if (!picked) continue;

    const strength = line.match(STRENGTH_PATTERN);
    const formMatch = line.match(new RegExp(`\\b(\\d+\\s+(?:${DOSAGE_FORMS}))\\b`, "i"));
    const route = normalizeRoute(line);
    const frequency = FREQUENCIES.find((entry) => entry.pattern.test(line));
    const food = FOOD_HINTS.find((entry) => entry.pattern.test(line));

    const key = `${picked.name.toLowerCase()}|${strength?.[0] ?? ""}|${frequency?.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const instructionParts: string[] = [];
    if (frequency) instructionParts.push(frequency.label);
    if (food && food.label !== frequency?.label) instructionParts.push(food.label);

    const confidence = Math.min(
      0.98,
      0.45 + (strength ? 0.22 : 0) + (frequency ? 0.18 : 0) + (route ? 0.08 : 0) + (formMatch ? 0.05 : 0),
    );

    const doseText = strength ? `${strength[1]}${strength[2]}` : (formMatch ? formMatch[1] : null);

    rows.push({
      title: doseText ? `${picked.name} ${doseText}` : picked.name,
      medication: picked.name,
      strength: strength ? `${strength[1]}${strength[2]}` : null,
      doseAmount: doseText,
      route,
      instructions: instructionParts.length > 0 ? instructionParts.join(", ") : null,
      scheduledFor: frequency?.times[0] ? isoAt(baseDate, frequency.times[0]) : null,
      confidence: Math.round(confidence * 100) / 100,
      evidence: line.length > 200 ? `${line.slice(0, 199)}\u2026` : line,
    });
  }

  return rows;
}

export type ExtractResult = {
  rows: ExtractedRow[];
  /** How the rows came to exist. Always explicit, never implied. */
  method: "deterministic";
  engineVersion: string;
  notes: string[];
  matchedLines: number;
  skippedLines: number;
};

export const EXTRACTOR_VERSION = "1.2.0";

export function extractCareNote(note: string, baseDate: Date = new Date()): ExtractResult {
  const lines = splitLines(note);
  const rows = extractCareRows(note, baseDate);
  const notes: string[] = [];
  if (rows.length === 0) {
    notes.push("No medicine-like lines were found. Check the text pasted from the discharge summary.");
  }
  const lowConfidence = rows.filter((row) => row.confidence < 0.7).length;
  if (lowConfidence > 0) {
    notes.push(
      `${lowConfidence} row${lowConfidence === 1 ? "" : "s"} below 0.70 confidence. Confirm against the paper before saving.`,
    );
  }
  return {
    rows,
    method: "deterministic",
    engineVersion: EXTRACTOR_VERSION,
    notes,
    matchedLines: rows.length,
    skippedLines: Math.max(0, lines.length - rows.length),
  };
}