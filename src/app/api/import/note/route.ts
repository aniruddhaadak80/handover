import type { NextRequest } from "next/server";
import { created, ok, parseBody, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { noteImportSchema } from "@/lib/validation";
import { EXTRACTOR_VERSION, extractCareNote } from "@/lib/engine/note-extract";
import { StoreError, createEntry, getBoardById } from "@/lib/repo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turns pasted discharge text into reviewable draft rows.
 * The server path is deterministic on purpose: a draft regimen a stranger
 * cannot reproduce is a draft nobody should trust with a parent's medication.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await ensureSessionId();
    const parsed = await parseBody(request, noteImportSchema);
    if ("error" in parsed) return parsed.error;

    const extracted = extractCareNote(parsed.value.note);
    if (!parsed.value.commit) {
      return ok({
        ...extracted,
        extractorVersion: EXTRACTOR_VERSION,
        committed: false,
        note: "Nothing was saved. Review the rows, then send commit=true with a boardId to write them.",
      });
    }

    const boardId = parsed.value.boardId;
    if (!boardId) {
      return toErrorResponse(new StoreError("boardId is required when commit=true", 422, "validation_failed"));
    }
    const board = await getBoardById(boardId, sessionId, { includeDeleted: true });
    if (!board) throw new StoreError("board not found", 404, "not_found");
    if (board.deletedAt) throw new StoreError("board is deleted", 409, "deleted");

    const at = new Date().toISOString();
    const saved: { id: string; title: string; seal: string }[] = [];
    let seal: string | null = null;
    for (const row of extracted.rows) {
      const result = await createEntry(
        {
          boardId,
          kind: "dose",
          status: "due",
          title: row.title,
          detail: `Imported from a discharge note: ${row.evidence}`,
          medication: row.medication,
          strength: row.strength,
          doseAmount: row.doseAmount,
          route: row.route,
          instructions: row.instructions,
          assignedTo: board.caregivers[0] ?? "you",
          recordedBy: "importer",
          scheduledFor: row.scheduledFor,
          occurredAt: null,
          source: "importer",
          at,
        },
        "importer",
      );
      saved.push({ id: result.entry.id, title: row.title, seal: result.audit.seal });
      seal = result.audit.seal;
    }

    return created({ ...extracted, extractorVersion: EXTRACTOR_VERSION, committed: true, saved, seal });
  } catch (error) {
    return toErrorResponse(error);
  }
}