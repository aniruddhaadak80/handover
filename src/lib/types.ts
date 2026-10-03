export const ENGINE_VERSION = "2026.10.1" as const;

export type EntryKind = "dose" | "observation" | "note" | "task" | "handover";
export type EntryStatus = "due" | "given" | "skipped" | "blocked" | "done";

export const ENTRY_KINDS: EntryKind[] = ["dose", "observation", "note", "task", "handover"];
export const ENTRY_STATUSES: EntryStatus[] = ["due", "given", "skipped", "blocked", "done"];

/** A scheduled or completed event on a care board. */
export type CareEntry = {
  id: string;
  boardId: string;
  kind: EntryKind;
  status: EntryStatus;
  title: string;
  detail: string;
  /** Free text: "metformin", "Metformin 500mg", "Sugar 140/9am". */
  medication: string | null;
  strength: string | null;
  doseAmount: string | null;
  route: string | null;
  instructions: string | null;
  /** The caregiver who owns this entry. */
  assignedTo: string | null;
  recordedBy: string;
  /** ISO-8601. When the thing is supposed to happen. */
  scheduledFor: string | null;
  /** ISO-8601. When it actually happened, if it has. */
  occurredAt: string | null;
  source: "manual" | "importer" | "agent";
  createdAt: string;
  updatedAt: string;
};

export type CareBoard = {
  id: string;
  /** Who the board is about. */
  subjectName: string;
  /** One line the next caregiver needs before touching anything. */
  wardNote: string;
  timezone: string;
  /** Caregiver names that appear on the board. */
  caregivers: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AuditType =
  | "board.created"
  | "board.updated"
  | "board.deleted"
  | "entry.created"
  | "entry.updated"
  | "entry.deleted"
  | "handover.sealed";

export type AuditEvent = {
  id: string;
  boardId: string;
  seq: number;
  type: AuditType;
  /** ISO-8601 timestamp recorded with the event. */
  at: string;
  actor: string;
  entryId: string | null;
  payload: Record<string, unknown>;
  prevSeal: string;
  seal: string;
};

/** ---------------------------------------------------------------- live data */

export type SourceStatus = "live" | "cached" | "fallback";

export type SourceMeta = {
  id: string;
  name: string;
  status: SourceStatus;
  url: string;
  fetchedAt: string;
  /** Set when the payload came from the sealed offline shelf. */
  note?: string;
};

export type LabelSeverity = "boxed_warning" | "contraindicated" | "interactions" | "monitoring";

/** Normalized slice of an openFDA drug label. */
export type DrugSafety = {
  /** RxNorm concept id, normalized lowercase rxcui. */
  rxcui: string | null;
  /** The ingredient we searched for, normalized. */
  genericName: string;
  /** The generic name on the label that actually matched. May be a combination product. */
  labelGenericName: string | null;
  brandNames: string[];
  route: string | null;
  schedule: string | null;
  manufacturer: string | null;
  applicationNumber: string | null;
  /** Verbatim label sections, trimmed. Never rendered as HTML. */
  sections: {
    indications: string | null;
    dosage: string | null;
    drugInteractions: string | null;
    contraindications: string | null;
    warnings: string | null;
    monitoring: string | null;
  };
  /** Deterministic flags derived from the label text. */
  flags: {
    hasBoxedWarning: boolean;
    hasContraindications: boolean;
    hasInteractionsSection: boolean;
    /** Monitoring terms that actually appear in the label text. */
    monitoringTerms: string[];
  };
  sources: SourceMeta[];
  /** Sealed sample data used when both upstreams fail. */
  sample: boolean;
};

export type DrugLookup = {
  query: string;
  drug: DrugSafety;
  /** Ingredient tokens used by the duplicate-therapy check. */
  ingredientTokens: string[];
  sources: SourceMeta[];
  status: SourceStatus;
};

/** ------------------------------------------------------------------- engine */

export type FactorKey =
  | "dose_reconciliation"
  | "timing_risk"
  | "duplicate_therapy"
  | "label_safety"
  | "handover_freshness"
  | "documentation";

export type FactorEvidence = {
  kind: string;
  detail: string;
  /** Points lost because of this piece of evidence. 0 = nothing wrong. */
  penalty: number;
  entryId?: string;
  sourceId?: string;
  sourceUrl?: string;
  sourceStatus?: SourceStatus;
  quote?: string;
};

export type FactorResult = {
  key: FactorKey;
  label: string;
  weight: number;
  /** 0-100, 100 = nothing wrong. */
  value: number;
  /** weight * value / sumWeights, rounded to 2dp. */
  contribution: number;
  status: "clear" | "watch" | "blocking";
  summary: string;
  evidence: FactorEvidence[];
};

export type HandoverVerdict = "ready" | "caution" | "hold";

export type HandoverAnalysis = {
  engineVersion: typeof ENGINE_VERSION;
  boardId: string;
  computedAt: string;
  /** Reference moment the analysis is anchored to. */
  asOf: string;
  score: number;
  verdict: HandoverVerdict;
  /** Verdict rule that fired, in plain words. */
  decision: string;
  factors: FactorResult[];
  blocking: FactorKey[];
  openDoses: number;
  blockingIssues: string[];
  /** Board seal at the time of the analysis. */
  seal: string | null;
  sources: SourceMeta[];
  disclaimer: string;
};

/** -------------------------------------------------------------------- seal */

export type IntegrityReport = {
  boardId: string;
  ok: boolean;
  checkedEvents: number;
  firstBrokenSeq: number | null;
  reason: string | null;
  headSeal: string | null;
  replayedAt: string;
};

/** ------------------------------------------------------------------- brief */

export type HandoverBrief = {
  boardId: string;
  subjectName: string;
  generatedAt: string;
  asOf: string;
  score: number;
  verdict: HandoverVerdict;
  decision: string;
  blockingIssues: string[];
  outgoing: CareEntry[];
  incoming: CareEntry[];
  dueNext: CareEntry[];
  analysis: HandoverAnalysis;
  seal: string | null;
  sources: SourceMeta[];
  disclaimer: string;
};

export type SessionInfo = {
  sessionId: string;
  boardCount: number;
};