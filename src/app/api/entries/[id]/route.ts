import type { NextRequest } from "next/server";
import { ok, readJson, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { updateEntrySchema } from "@/lib/validation";
import { StoreError, deleteEntry, getBoardById, updateEntry } from "@/lib/repo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Single-entry mutation. The board id arrives in the body alongside the patch,
 * and the body is read exactly once.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const read = await readJson(request);
    if ("error" in read) return read.error;

    const raw = read.value as Record<string, unknown>;
    const boardId = typeof raw.boardId === "string" ? raw.boardId : "";
    if (!boardId) throw new StoreError("boardId is required to update an entry", 422, "validation_failed");

    const { sessionId } = await ensureSessionId();
    const owner = await getBoardById(boardId, sessionId, { includeDeleted: true });
    if (!owner) throw new StoreError("board not found", 404, "not_found");

    const parsed = updateEntrySchema.safeParse(raw);
    if (!parsed.success) {
      return toErrorResponse(
        new StoreError(
          parsed.error.issues[0]?.message ?? "The patch did not pass validation.",
          422,
          "validation_failed",
        ),
      );
    }

    const at = new Date().toISOString();
    const result = await updateEntry(id, boardId, sessionId, parsed.data as never, "you", at);
    return ok({ entry: result.entry, seal: result.audit.seal, auditSeq: result.audit.seq });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const boardId = url.searchParams.get("boardId");
    if (!boardId) throw new StoreError("boardId is required to delete an entry", 422, "validation_failed");
    if (url.searchParams.get("confirm") !== id) {
      throw new StoreError(
        "Deleting an entry requires confirm=<entryId>. Nothing was changed.",
        428,
        "confirmation_required",
      );
    }

    const { sessionId } = await ensureSessionId();
    const at = new Date().toISOString();
    const result = await deleteEntry(id, boardId, sessionId, "you", at);
    return ok({
      deleted: true,
      entryId: id,
      tombstone: { seal: result.audit.seal, auditSeq: result.audit.seq },
      note: "The entry is retained as a tombstone so the seal chain still replays end to end.",
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}