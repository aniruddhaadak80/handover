import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { created, fail, ok, parseBody, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { createBoardSchema } from "@/lib/validation";
import { allBoards, boardSnapshot, mintShareToken, renameBoard, shareLink } from "@/lib/service";
import { createBoard as storeCreateBoard } from "@/lib/repo/store";
import { appendExampleEntries } from "@/lib/seed-entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { sessionId } = await ensureSessionId();
    const boards = await allBoards(sessionId);
    const summaries = await Promise.all(
      boards.map(async (board) => {
        const snapshot = await boardSnapshot(sessionId, board.id, { includeDeleted: true });
        return {
          ...board,
          entryCount: snapshot.entries.length,
          openDoses: snapshot.analysis.openDoses,
          score: snapshot.analysis.score,
          verdict: snapshot.analysis.verdict,
          decision: snapshot.analysis.decision,
          seal: snapshot.seal,
        };
      }),
    );
    return ok({ boards: summaries });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { sessionId } = await ensureSessionId();
    const parsed = await parseBody(request, createBoardSchema);
    if ("error" in parsed) return parsed.error;

    const at = new Date().toISOString();
    const caregiver = request.headers.get("x-caregiver-name")?.slice(0, 80) || "you";
    const { board, audit } = await storeCreateBoard({
      ownerId: sessionId,
      subjectName: parsed.value.subjectName,
      wardNote: parsed.value.wardNote,
      timezone: parsed.value.timezone,
      caregivers: parsed.value.caregivers.length > 0 ? parsed.value.caregivers : [caregiver],
      at,
    });

    const exampleEntries = parsed.value.withExampleEntries ? await appendExampleEntries(board.id) : 0;

    const token = await shareLink(board.id, sessionId, mintShareToken);
    return created({ board, audit: { seq: audit.seq, seal: audit.seal }, exampleEntries, shareToken: token });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => null)) as { id?: string; subjectName?: string; wardNote?: string } | null;
    if (!body?.id) return fail("validation_failed", "A board id is required.", 422);
    const { sessionId } = await ensureSessionId();
    const result = await renameBoard(
      body.id,
      sessionId,
      {
        ...(body.subjectName !== undefined ? { subjectName: String(body.subjectName) } : {}),
        ...(body.wardNote !== undefined ? { wardNote: String(body.wardNote) } : {}),
      },
      "you",
      new Date().toISOString(),
    );
    return ok({ board: result.board, seal: result.audit.seal });
  } catch (error) {
    return toErrorResponse(error);
  }
}