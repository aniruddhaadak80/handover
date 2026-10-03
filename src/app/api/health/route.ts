import { NextResponse } from "next/server";
import { databaseUrl } from "@/lib/db/client";
import { db } from "@/lib/repo/store";
import { ENGINE_VERSION } from "@/lib/engine/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proves the production persistence path actually answers. A static success
 * object would be a lie, so this runs a real write-and-read-back every time.
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  const configured = Boolean(databaseUrl());

  let client;
  try {
    client = await db();
  } catch (error) {
    // Structural check: the same class can exist twice in a bundled runtime.
    const typed =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string; message?: string })
        : null;
    const reason = typed?.message ?? "the store could not be reached";
    console.error("[handover] health store failure:", error instanceof Error ? error.stack ?? error.message : error);
    return NextResponse.json(
      {
        ok: false,
        status: "degraded",
        error: reason,
        code: typed?.code ?? "store_unavailable",
        persistence: { configured, reachable: false, writeReadback: false },
        engineVersion: ENGINE_VERSION,
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  let reachable = false;
  let writeReadback = false;
  let error: string | null = null;

  try {
    await client.query("SELECT 1 AS ok");
    reachable = true;
    const probe = await client.query<{ key: string }>(
      `INSERT INTO idempotency_keys (key, scope, created_at)
       VALUES ($1, 'health', $2)
       ON CONFLICT (key) DO UPDATE SET created_at = EXCLUDED.created_at
       RETURNING key`,
      [`health_${Date.now().toString(36)}`, new Date().toISOString()],
    );
    writeReadback = probe.rows.length === 1;
    if (probe.rows[0]) {
      await client.query("DELETE FROM idempotency_keys WHERE key = $1", [probe.rows[0].key]);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "unknown database error";
  }

  return NextResponse.json(
    {
      ok: reachable && writeReadback,
      status: reachable && writeReadback ? "pass" : "degraded",
      persistence: {
        configured,
        driver: client.driver,
        target: client.target(),
        reachable,
        writeReadback,
      },
      engineVersion: ENGINE_VERSION,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    },
    { status: reachable && writeReadback ? 200 : 503 },
  );
}