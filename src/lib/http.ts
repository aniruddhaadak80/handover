import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export type ErrorEnvelope = {
  error: { code: string; message: string; details?: unknown };
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function created<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 201 });
}

export function fail(code: string, message: string, status: number, details?: unknown): NextResponse {
  const body: ErrorEnvelope = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, { status });
}

export function fromZod(error: ZodError): NextResponse {
  return fail(
    "validation_failed",
    "The request body did not pass validation.",
    422,
    error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  );
}

export async function readJson(request: Request): Promise<{ value: unknown } | { error: NextResponse }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { error: fail("unsupported_media_type", "Send application/json.", 415) };
  }
  try {
    const raw = await request.text();
    if (raw.length > 64_000) {
      return { error: fail("payload_too_large", "Request body exceeds 64 kB.", 413) };
    }
    return { value: raw.length === 0 ? {} : JSON.parse(raw) };
  } catch {
    return { error: fail("invalid_json", "Request body is not valid JSON.", 400) };
  }
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<{ value: T } | { error: NextResponse }> {
  const read = await readJson(request);
  if ("error" in read) return read;
  try {
    return { value: schema.parse(read.value) };
  } catch (error) {
    if (error instanceof ZodError) return { error: fromZod(error) };
    throw error;
  }
}

/** Never leak a stack trace or an env var through an API response. */
export function toErrorResponse(error: unknown): NextResponse {
  // Structural check: a bundled runtime can hold two copies of the class, so
  // `instanceof` is not reliable here.
  if (error && typeof error === "object" && "status" in error && "code" in error) {
    const typed = error as { status: number; code: string; message: string };
    return fail(typed.code, typed.message, typed.status);
  }
  if (error instanceof Error && /duplicate key|unique constraint/i.test(error.message)) {
    return fail("conflict", "Another write landed first. Reload and try again.", 409);
  }
  // Server-side only: the client never sees this, but the deploy logs do.
  console.error("[handover] unhandled api error:", error instanceof Error ? error.stack ?? error.message : error);
  return fail("internal_error", "Something failed on the server. Nothing was changed.", 500);
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}