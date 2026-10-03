import type { NextRequest } from "next/server";
import { created, ok, parseBody, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { handoverSealSchema } from "@/lib/validation";
import { boardSnapshot, buildBrief } from "@/lib/service";
import { StoreError, appendHandover } from "@/lib/repo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Engine result plus the brief, computed by the same function the UI renders. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const url = new URL(request.url);
    const handoverAt = url.searchParams.get("handoverAt") ?? new Date().toISOString();
    const snapshot = await boardSnapshot(sessionId, id, { asOf: url.searchParams.get("asOf") ?? undefined });
    const brief = buildBrief(snapshot, handoverAt);
    return ok({ analysis: snapshot.analysis, brief, seal: snapshot.seal });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * Sealing a handover appends a real, chained audit event. The decision a person
 * made at 3am is exactly the thing that must not be editable afterwards.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const parsed = await parseBody(request, handoverSealSchema);
    if ("error" in parsed) return parsed.error;

    const snapshot = await boardSnapshot(sessionId, id, { asOf: parsed.value.asOf });
    const brief = buildBrief(snapshot, parsed.value.handoverAt);
    const at = new Date().toISOString();

    const result = await appendHandover({
      boardId: id,
      ownerId: sessionId,
      handoverAt: parsed.value.handoverAt,
      note: parsed.value.note,
      score: snapshot.analysis.score,
      verdict: snapshot.analysis.verdict,
      outgoingCount: brief.outgoing.length,
      incomingCount: brief.incoming.length,
      at,
    });

    return created({
      handover: result,
      brief,
      seal: result.audit.seal,
      auditSeq: result.audit.seq,
    });
  } catch (error) {
    if (error instanceof StoreError) return toErrorResponse(error);
    return toErrorResponse(error);
  }
}