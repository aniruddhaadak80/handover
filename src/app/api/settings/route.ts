import type { NextRequest } from "next/server";
import { ok, parseBody, toErrorResponse } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";
import { settingsSchema } from "@/lib/validation";
import { getSettings, saveSettings } from "@/lib/service";
import { DEFAULT_WEIGHTS } from "@/lib/engine/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sessionId } = await ensureSessionId();
    return ok({ settings: await getSettings(sessionId), defaults: DEFAULT_WEIGHTS });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { sessionId } = await ensureSessionId();
    const parsed = await parseBody(request, settingsSchema);
    if ("error" in parsed) return parsed.error;
    const settings = await saveSettings(sessionId, parsed.value, new Date().toISOString());
    return ok({ settings, defaults: DEFAULT_WEIGHTS });
  } catch (error) {
    return toErrorResponse(error);
  }
}