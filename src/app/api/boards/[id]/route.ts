import type { NextRequest } from "next/server";
import { fail, ok, parseBody, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { updateBoardSchema } from "@/lib/validation";
import { boardSnapshot, mintShareToken, renameBoard, shareLink, softDeleteBoard } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const asOf = new URL(_request.url).searchParams.get("asOf") ?? undefined;
    const snapshot = await boardSnapshot(sessionId, id, { asOf });
    return ok(snapshot);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const parsed = await parseBody(request, updateBoardSchema);
    if ("error" in parsed) return parsed.error;
    const result = await renameBoard(id, sessionId, parsed.value, "you", new Date().toISOString());
    return ok({ board: result.board, seal: result.audit.seal });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Destructive operation guard: a board only goes away when the caller sends its
 * id back as `confirm`. The board is soft-deleted so its seal chain stays
 * replayable and a tombstone remains in the audit log.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const url = new URL(request.url);
    const confirm = url.searchParams.get("confirm");
    if (confirm !== id) {
      return fail(
        "confirmation_required",
        "Deleting a care board requires confirm=<boardId>. Nothing was changed.",
        428,
      );
    }
    const at = new Date().toISOString();
    const result = await softDeleteBoard(id, sessionId, "you", at);
    return ok({
      deleted: true,
      boardId: id,
      tombstone: { deletedAt: at, seal: result.audit.seal, auditSeq: result.audit.seq },
      note: "The board is soft-deleted. Its audit chain is retained so the seal still replays.",
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const url = new URL(request.url);
    if (url.searchParams.get("action") !== "share") {
      return fail("unknown_action", "Only action=share is supported on this endpoint.", 400);
    }
    const token = await shareLink(id, sessionId, mintShareToken);
    return ok({ shareToken: token, path: `/share/${token}` });
  } catch (error) {
    return toErrorResponse(error);
  }
}