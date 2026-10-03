#!/usr/bin/env node
/**
 * Live end-to-end verifier.
 *
 * Usage:
 *   npm run verify:live                      # uses NEXT_PUBLIC_SITE_URL or http://localhost:3000
 *   BASE_URL=https://handover.vercel.app npm run verify:live
 *
 * Every check is a real HTTP request against a running deployment. Nothing is
 * mocked and no secret is read from the repository.
 */

const BASE = (process.env.BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const REPO_URL = process.env.REPO_URL ?? "https://github.com/aniruddhaadak80/handover";
const CHECK_REPO = process.env.CHECK_REPO !== "0";

let passed = 0;
let failed = 0;
const failures = [];
const cookies = new Map();

function record(ok, label, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    failures.push(`${label}${detail ? ` -> ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
  return ok;
}

function section(title) {
  console.log(`\n${title}`);
}

async function request(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  if (cookies.size > 0) {
    headers.cookie = [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  const response = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const [pair] = raw.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text();
  return { status: response.status, body, headers: response.headers };
}

async function rpc(method, params, id = Date.now()) {
  const { body } = await request("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return body;
}

/** Cold starts can answer 5xx while a serverless instance boots; retry once. */
async function requestStable(path, init = {}, attempts = 2) {
  let response = await request(path, init);
  for (let attempt = 1; attempt < attempts && response.status >= 500; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    response = await request(path, init);
  }
  return response;
}

const isJson = (body) => body && typeof body === "object" && "ok" in body;
const unwrap = (body) => (isJson(body) ? body.data : undefined);

async function main() {
  console.log(`Verifying ${BASE}`);
  const startedAt = Date.now();

  section("1. Public surface");
  const home = await request("/");
  record(home.status === 200, "GET / returns 200", `got ${home.status}`);
  const html = typeof home.body === "string" ? home.body : "";

  for (const route of ["/boards", "/handover", "/agent", "/verify", "/settings", "/mcp.json"]) {
    const page = await requestStable(route);
    record(page.status === 200, `GET ${route} returns 200`, `got ${page.status}`);
  }

  section("2. Repository access");
  const navHasRepo = html.includes(REPO_URL);
  record(navHasRepo, `rendered / contains the repository URL ${REPO_URL}`);
  const navOccurrences = html.split(REPO_URL).length - 1;
  record(navOccurrences >= 2, `repository URL appears at least twice (nav + footer)`, `found ${navOccurrences}`);
  if (CHECK_REPO) {
    const repo = await fetch(REPO_URL, { headers: { "user-agent": "handover-verifier" } });
    record(repo.status === 200, `repository URL returns 200`, `got ${repo.status}`);
  }

  section("3. Health and persistence");
  const health = await request("/api/health");
  const healthData = health.body;
  record(health.status === 200, "GET /api/health returns 200", `got ${health.status}`);
  record(
    healthData?.persistence?.reachable === true && healthData?.persistence?.writeReadback === true,
    "health proves the store answers a real write and read-back",
    JSON.stringify(healthData?.persistence ?? {}),
  );
  record(
    String(healthData?.persistence?.driver) === "neon" || process.env.EXPECT_DRIVER === "pglite",
    `persistence driver is the expected one (${healthData?.persistence?.driver})`,
  );

  section("4. Live public data");
  const drug = await request("/api/drugs/Metformin");
  const drugData = unwrap(drug.body);
  record(drug.status === 200, "GET /api/drugs/Metformin returns 200", `got ${drug.status}`);
  record(Boolean(drugData?.drug?.genericName), "normalized drug record has a generic name");
  record(Array.isArray(drugData?.sources) && drugData.sources.length > 0, "response carries source metadata");
  record(
    ["live", "cached", "fallback"].includes(drugData?.status),
    `status is honestly labelled (${drugData?.status})`,
  );

  section("5. Create, read back, update");
  const created = await request("/api/boards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subjectName: "Verifier board",
      wardNote: "Created by scripts/verify-live.mjs",
      timezone: "UTC",
      caregivers: ["Verifier"],
      withExampleEntries: false,
    }),
  });
  const board = unwrap(created.body);
  record(created.status === 201, "POST /api/boards creates a board", `got ${created.status}`);
  const boardId = board?.board?.id;
  record(Boolean(boardId), "created board has an id");

  const seeded = await request("/api/boards", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subjectName: "Verifier example board",
      timezone: "UTC",
      caregivers: ["Priya", "Ravi"],
      withExampleEntries: true,
    }),
  });
  const example = unwrap(seeded.body);
  record(example?.exampleEntries > 0, "worked example inserts entries", `got ${example?.exampleEntries}`);

  const entry = await request(`/api/boards/${boardId}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "dose",
      status: "due",
      title: "Metformin 500 mg",
      detail: "Verifier dose with a note long enough to satisfy the documentation factor.",
      medication: "Metformin 500 mg",
      doseAmount: "1 tablet",
      route: "oral",
      instructions: "with food",
      assignedTo: "Verifier",
      scheduledFor: new Date(Date.now() - 2 * 3600_000).toISOString(),
    }),
  });
  const entryData = unwrap(entry.body);
  record(entry.status === 201, "POST an entry returns 201", `got ${entry.status}`);
  record(Boolean(entryData?.seal), "entry response returns the new seal");
  const entryId = entryData?.entry?.id;

  const readBack = await request(`/api/boards/${boardId}`);
  const snapshot = unwrap(readBack.body);
  record(readBack.status === 200, "GET the board returns 200", `got ${readBack.status}`);
  record(
    snapshot?.entries?.some((item) => item.id === entryId),
    "created entry is visible on read-back",
  );

  const patched = await request(`/api/entries/${entryId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ boardId, status: "given" }),
  });
  const patchedData = unwrap(patched.body);
  record(patched.status === 200, "PATCH the entry returns 200", `got ${patched.status}`);

  const afterPatch = unwrap((await request(`/api/boards/${boardId}`)).body);
  const patchedEntry = afterPatch?.entries?.find((item) => item.id === entryId);
  record(patchedEntry?.status === "given", "persisted status reflects the update", `got ${patchedEntry?.status}`);

  const rejected = await request(`/api/boards/${boardId}/entries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "dose", title: "" }),
  });
  record(rejected.status === 422, "invalid payload is rejected with 422", `got ${rejected.status}`);

  section("6. Engine");
  const handover = await request(`/api/boards/${boardId}/handover`);
  const handoverData = unwrap(handover.body);
  const analysis = handoverData?.analysis;
  record(handover.status === 200, "GET handover analysis returns 200", `got ${handover.status}`);
  record(Boolean(analysis?.engineVersion), `engine reports a version (${analysis?.engineVersion})`);
  record(Number.isFinite(analysis?.score), `engine returns a numeric score (${analysis?.score})`);
  record(Array.isArray(analysis?.factors) && analysis.factors.length === 6, "six itemized factors returned");
  record(
    analysis?.factors?.every((factor) => Array.isArray(factor.evidence) && "weight" in factor),
    "every factor carries a weight and evidence",
  );
  record(["ready", "caution", "hold"].includes(analysis?.verdict), `verdict is classified (${analysis?.verdict})`);
  record(typeof analysis?.decision === "string" && analysis.decision.length > 0, "engine returns a recommendation");
  record(Boolean(handoverData?.seal), "engine response echoes a seal reference");

  section("7. Agent interface");
  const init = await rpc("initialize", {
    protocolVersion: "2026-10-01",
    capabilities: {},
    clientInfo: { name: "verify-live", version: "1.0.0" },
  });
  record(Boolean(init?.result?.serverInfo?.name), `MCP initialize succeeds (${init?.result?.serverInfo?.name})`);

  const listed = await rpc("tools/list", {});
  const tools = listed?.result?.tools ?? [];
  record(tools.length >= 3, `tools/list returns tools (${tools.length})`);
  const names = tools.map((tool) => tool.name);
  record(names.includes("log_entry"), "a mutating tool is exposed");
  record(names.includes("analyze_handover") || names.includes("get_board"), "an analysis or read tool is exposed");
  record(
    tools.every((tool) => tool.inputSchema && typeof tool.inputSchema.type === "string"),
    "every tool declares a structured input schema",
  );

  const idempotencyKey = `verify-${Date.now()}`;
  const first = await rpc("tools/call", {
    name: "log_entry",
    arguments: {
      boardId,
      kind: "note",
      title: "Logged by the MCP mutating tool",
      detail: "Written by scripts/verify-live.mjs through tools/call.",
      idempotencyKey,
    },
  });
  const firstResult = first?.result?.structuredContent;
  record(Boolean(firstResult?.entryId), "tools/call mutating path returns an entry id");
  record(Boolean(firstResult?.seal), "mutating tool returns a seal");

  const replay = await rpc("tools/call", {
    name: "log_entry",
    arguments: {
      boardId,
      kind: "note",
      title: "Logged by the MCP mutating tool",
      detail: "Written by scripts/verify-live.mjs through tools/call.",
      idempotencyKey,
    },
  });
  const replayResult = replay?.result?.structuredContent;
  record(
    replayResult?.idempotentReplay === true && replayResult?.entryId === firstResult?.entryId,
    "same idempotency key does not double-write",
  );

  const afterAgent = unwrap((await request(`/api/boards/${boardId}`)).body);
  record(
    afterAgent?.entries?.filter((item) => item.id === firstResult?.entryId).length === 1,
    "agent-written entry is visible exactly once on read-back",
  );

  const badTool = await rpc("tools/call", { name: "no_such_tool", arguments: {} });
  record(Boolean(badTool?.error), "unknown tool returns a JSON-RPC error");

  section("8. Integrity");
  const integrity = await request(`/api/boards/${boardId}/integrity?log=1`);
  const integrityData = unwrap(integrity.body);
  record(integrity.status === 200, "integrity endpoint returns 200", `got ${integrity.status}`);
  record(integrityData?.report?.ok === true, "seal chain replays with no broken link");
  record(
    integrityData?.report?.checkedEvents > 0 && Boolean(integrityData?.report?.headSeal),
    "replay reports a head seal",
  );
  const eventTypes = new Set((integrityData?.events ?? []).map((event) => event.type));
  record(eventTypes.has("entry.created"), "audit log contains entry.created");
  record(eventTypes.has("entry.updated"), "audit log contains entry.updated");

  section("9. Export");
  const markdown = await request(`/api/export/${boardId}?format=markdown`);
  record(markdown.status === 200, "markdown export returns 200", `got ${markdown.status}`);
  record(
    typeof markdown.body === "string" && markdown.body.includes("# Handover brief"),
    "markdown export is a real brief",
  );
  record(
    (markdown.headers.get("content-disposition") ?? "").includes("attachment"),
    "export is served as a download",
  );
  const htmlExport = await request(`/api/export/${boardId}?format=html`);
  record(
    htmlExport.status === 200 && typeof htmlExport.body === "string" && htmlExport.body.includes("<!doctype html>"),
    "printable html export returns valid html",
  );

  section("10. Ownership and deletion");
  const guarded = await request(`/api/boards/${boardId}`);
  record(guarded.status === 200, "owner can read the board");
  const noConfirm = await request(`/api/boards/${boardId}`, { method: "DELETE" });
  record(noConfirm.status === 428, "delete without confirmation is refused (428)", `got ${noConfirm.status}`);

  const deleted = await request(`/api/boards/${boardId}?confirm=${boardId}`, { method: "DELETE" });
  const deletedData = unwrap(deleted.body);
  record(deleted.status === 200, "confirmed delete returns 200", `got ${deleted.status}`);
  record(Boolean(deletedData?.tombstone?.seal), "delete leaves a tombstone with a seal");

  const afterDelete = await request(`/api/boards/${boardId}`);
  record(afterDelete.status === 404, "deleted board returns 404", `got ${afterDelete.status}`);

  const integrityAfter = await request(`/api/boards/${boardId}/integrity?log=1`);
  record(integrityAfter.status === 200, "integrity still replays after deletion", `got ${integrityAfter.status}`);

  section("Summary");
  console.log(`  ${passed} passed, ${failed} failed in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("verifier crashed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});