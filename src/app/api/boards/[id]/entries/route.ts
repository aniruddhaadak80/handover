import type { NextRequest } from "next/server";
import { created, ok, parseBody, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { createEntrySchema } from "@/lib/validation";
import { boardSnapshot } from "@/lib/service";
import { StoreError, createEntry, getBoardById } from "@/lib/repo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "200");
    const snapshot = await boardSnapshot(sessionId, id, {
      includeDeleted: true,
      skipDrugs: true,
    });
    return ok({ board: snapshot.board, entries: snapshot.entries.slice(0, Number.isFinite(limit) ? limit : 200) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const parsed = await parseBody(request, createEntrySchema);
    if ("error" in parsed) return parsed.error;

    const board = await getBoardById(id, sessionId, { includeDeleted: true });
    if (!board) throw new StoreError("board not found", 404, "not_found");
    if (board.deletedAt) throw new StoreError("board is deleted", 409, "deleted");

    const at = new Date().toISOString();
    const value = parsed.value;
    const result = await createEntry(
      {
        boardId: id,
        kind: value.kind as never,
        status: value.status as never,
        title: value.title,
        detail: value.detail,
        medication: value.medication,
        strength: value.strength,
        doseAmount: value.doseAmount,
        route: value.route,
        instructions: value.instructions,
        assignedTo: value.assignedTo,
        recordedBy: value.recordedBy,
        scheduledFor: value.scheduledFor ?? null,
        occurredAt: value.occurredAt ?? null,
        source: "manual",
        at,
      },
      value.recordedBy,
    );

    return created({ entry: result.entry, seal: result.audit.seal, auditSeq: result.audit.seq });
  } catch (error) {
    return toErrorResponse(error);
  }
}