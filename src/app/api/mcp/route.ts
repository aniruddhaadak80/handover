import { NextResponse } from "next/server";
import { ensureSessionId } from "@/lib/session";
import { PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION, handleRpc, type JsonRpcRequest } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live MCP-style JSON-RPC 2.0 endpoint. Same session cookie as the web UI. */
export async function POST(request: Request): Promise<NextResponse> {
  const { sessionId } = await ensureSessionId();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error: body is not JSON." } },
      { status: 400 },
    );
  }

  const batch = Array.isArray(payload);
  const requests = (batch ? payload : [payload]) as JsonRpcRequest[];

  if (requests.length === 0) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: empty batch." } },
      { status: 400 },
    );
  }
  if (requests.length > 24) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Too many requests in one batch (max 24)." } },
      { status: 400 },
    );
  }

  const results = (await Promise.all(
    requests.map((entry) => handleRpc(entry ?? {}, { sessionId })),
  )).filter((entry): entry is unknown => entry !== null);

  if (batch) {
    if (results.length === 0) return new NextResponse(null, { status: 204 });
    return NextResponse.json(results);
  }
  return NextResponse.json(results[0] ?? { jsonrpc: "2.0", id: null, result: null });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    transport: "jsonrpc-2.0-over-http",
    endpoint: "/api/mcp",
    methods: ["initialize", "tools/list", "tools/call", "ping"],
  });
}