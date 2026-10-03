import { z } from "zod";
import { ENTRY_KINDS, ENTRY_STATUSES } from "./types";

const iso = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Must be an ISO-8601 timestamp." });

const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value.length === 0 ? null : value));

export const createBoardSchema = z.object({
  subjectName: shortText(120),
  wardNote: z.string().trim().max(600).default(""),
  timezone: z.string().trim().min(1).max(64).default("UTC"),
  caregivers: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  /** Creates the bundled worked example instead of an empty board. */
  withExampleEntries: z.boolean().default(false),
});

export const updateBoardSchema = z
  .object({
    subjectName: shortText(120).optional(),
    wardNote: z.string().trim().max(600).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    caregivers: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." });

export const createEntrySchema = z.object({
  kind: z.enum(ENTRY_KINDS as [string, ...string[]]).default("dose"),
  status: z.enum(ENTRY_STATUSES as [string, ...string[]]).default("due"),
  title: shortText(160),
  detail: z.string().trim().max(2000).default(""),
  medication: optionalText(120),
  strength: optionalText(60),
  doseAmount: optionalText(60),
  route: optionalText(60),
  instructions: optionalText(300),
  assignedTo: optionalText(80),
  recordedBy: z.string().trim().max(80).default("anonymous"),
  scheduledFor: iso.nullish(),
  occurredAt: iso.nullish(),
});

export const updateEntrySchema = z
  .object({
    status: z.enum(ENTRY_STATUSES as [string, ...string[]]).optional(),
    title: shortText(160).optional(),
    detail: z.string().trim().max(2000).optional(),
    doseAmount: optionalText(60),
    instructions: optionalText(300),
    assignedTo: optionalText(80),
    scheduledFor: iso.nullish(),
    occurredAt: iso.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update." });

export const settingsSchema = z.object({
  weights: z
    .object({
      dose_reconciliation: z.number().min(0).max(1).optional(),
      timing_risk: z.number().min(0).max(1).optional(),
      duplicate_therapy: z.number().min(0).max(1).optional(),
      label_safety: z.number().min(0).max(1).optional(),
      handover_freshness: z.number().min(0).max(1).optional(),
      documentation: z.number().min(0).max(1).optional(),
    })
    .optional(),
  windowHours: z.number().int().min(1).max(168).optional(),
  caregiverName: z.string().trim().max(80).optional(),
});

export const handoverSealSchema = z.object({
  handoverAt: iso,
  asOf: iso.optional(),
  note: z.string().trim().max(400).default(""),
});

export const noteImportSchema = z.object({
  note: z.string().trim().min(20).max(8000),
  boardId: z.string().trim().max(64).optional(),
  /** Persist the extracted rows onto the board. */
  commit: z.boolean().default(false),
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type NoteImportInput = z.infer<typeof noteImportSchema>;

/** Draft rows a discharge note yields. Deterministic extraction, no model. */
export const extractedRowSchema = z.object({
  title: z.string(),
  medication: z.string().nullable(),
  strength: z.string().nullable(),
  doseAmount: z.string().nullable(),
  route: z.string().nullable(),
  instructions: z.string().nullable(),
  scheduledFor: z.string().nullable(),
  confidence: z.number(),
  evidence: z.string(),
});

export type ExtractedRow = z.infer<typeof extractedRowSchema>;