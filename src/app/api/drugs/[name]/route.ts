import type { NextRequest } from "next/server";
import { ok, toErrorResponse } from "@/lib/http";
import { lookupDrug } from "@/lib/live/drugs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

/**
 * Live public label lookup: NIH RxNorm for the concept id, openFDA for the
 * label sections. The response always carries source metadata and says
 * explicitly whether it is live, cached, or the offline shelf.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { name } = await params;
    const lookup = await lookupDrug(decodeURIComponent(name));
    return ok(lookup);
  } catch (error) {
    return toErrorResponse(error);
  }
}