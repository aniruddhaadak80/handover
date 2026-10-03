import type { NextRequest } from "next/server";
import { ok, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { verifyBoard } from "@/lib/service";
import { listAudit } from "@/lib/repo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const { sessionId } = await ensureSessionId();
    const url = new URL(request.url);
    const withLog = url.searchParams.get("log") === "1";
    const report = await verifyBoard(id, sessionId);
    const events = withLog ? await listAudit(id) : [];
    return ok({ report, events });
  } catch (error) {
    return toErrorResponse(error);
  }
}