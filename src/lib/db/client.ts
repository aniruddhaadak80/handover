import { neon } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync } from "node:fs";
import { SCHEMA_SQL } from "./schema";

export type QueryRows<T> = { rows: T[]; rowCount: number };

export interface SqlClient {
  readonly driver: "pglite" | "neon";
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<QueryRows<T>>;
  /** Runs a multi-statement script. PGlite needs `exec`; Neon needs splitting. */
  exec(script: string): Promise<void>;
  /** Human-readable target, safe to show in the health endpoint. Never a secret. */
  target(): string;
}

type NeonClient = ReturnType<typeof neon>;

type PgliteInstance = {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
};

const globalRef = globalThis as unknown as {
  __handoverSql?: Promise<SqlClient>;
  __handoverPglite?: PgliteInstance;
};

function dataDirOf(): string {
  return process.env.PGLITE_DATA_DIR ?? ".data/pglite";
}

/** Neon in production. Zero-config fallback is PGlite, never Neon. */
function createNeonClient(url: string): SqlClient {
  const client = neon(url) as NeonClient;
  return {
    driver: "neon",
    async query<T>(text: string, params: readonly unknown[] = []) {
      // The HTTP driver can return array mode depending on options; ask for
      // object rows explicitly and normalize both shapes.
      const result = (await client.query(text, [...params])) as unknown;
      const rows = Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
      return { rows, rowCount: rows.length };
    },
    async exec(script: string) {
      for (const statement of splitStatements(script)) {
        await client.query(statement, []);
      }
    },
    target: () => "neon-postgres",
  };
}

/** Split a DDL script on semicolons that are not inside a string literal. */
function splitStatements(script: string): string[] {
  const out: string[] = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < script.length; i++) {
    const char = script[i];
    if (char === "'") {
      const escaped = i > 0 && script[i - 1] === "\\";
      if (!escaped) inString = !inString;
    }
    if (char === ";" && !inString) {
      const statement = current.trim();
      if (statement.length > 0) out.push(statement);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Embedded Postgres for local development and tests. Never selected in production. */
function createPgliteClient(): SqlClient {
  const dir = dataDirOf();
  const memory = dir === "memory://";
  if (!memory) {
    // PGlite creates its own directory only one level deep, so do it here.
    mkdirSync(dir, { recursive: true });
  }
  const pglite =
    globalRef.__handoverPglite ??
    (new PGlite(memory ? undefined : dir) as unknown as PgliteInstance);
  globalRef.__handoverPglite = pglite;
  return {
    driver: "pglite",
    async query<T>(text: string, params: readonly unknown[] = []) {
      try {
        const result = await pglite.query<T>(text, params);
        return { rows: result.rows ?? [], rowCount: result.rows?.length ?? 0 };
      } catch (error) {
        // A half-initialised instance would keep failing forever; drop it so the
        // next request boots a clean one.
        globalRef.__handoverPglite = undefined;
        throw error;
      }
    },
    async exec(script: string) {
      try {
        await pglite.exec(script);
      } catch (error) {
        globalRef.__handoverPglite = undefined;
        throw error;
      }
    },
    target: () => (memory ? "pglite-in-memory" : "pglite-embedded-file"),
  };
}

export function databaseUrl(): string | null {
  return (
    process.env.DATABASE_URL ??
    process.env.NEON_DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.PG_URL ??
    null
  );
}

export type ClientResolution =
  | { ok: true; client: SqlClient }
  | { ok: false; reason: string; driver: "pglite" | "neon" };

/**
 * Resolve the active client.
 *
 * Production without a hosted URL is a hard error: it must never silently fall
 * back to an embedded database that the next redeploy would erase.
 */
export async function getSql(): Promise<ClientResolution> {
  const url = databaseUrl();

  if (url) {
    const cached = globalRef.__handoverSql;
    if (cached) return { ok: true, client: await cached };
    const promise = Promise.resolve(createNeonClient(url)).catch((error) => {
      globalRef.__handoverSql = undefined;
      throw error;
    });
    globalRef.__handoverSql = promise;
    try {
      const client = await promise;
      return { ok: true, client };
    } catch (error) {
      return {
        ok: false,
        driver: "neon",
        reason: error instanceof Error ? error.message : "neon client failed",
      };
    }
  }

  if (process.env.NODE_ENV === "production" && process.env.HANDOVER_ALLOW_EMBEDDED !== "1") {
    return {
      ok: false,
      driver: "pglite",
      reason:
        "No hosted Postgres URL is configured (DATABASE_URL). Refusing to fall back to an embedded database in production. Set HANDOVER_ALLOW_EMBEDDED=1 only to rehearse a production build locally.",
    };
  }

  return { ok: true, client: createPgliteClient() };
}

export async function applySchema(client: SqlClient): Promise<void> {
  await client.exec(SCHEMA_SQL);
}