import { NextResponse } from "next/server";
import { absoluteUrl } from "@/lib/config";
import { PROTOCOL_VERSION, SERVER_VERSION } from "@/lib/mcp";
import { TOOL_NAMES } from "@/lib/mcp";

export const dynamic = "force-static";

/**
 * Agent manifest with the real deployed endpoint, so an MCP client can be
 * pointed at this instance without anyone editing a URL by hand.
 */
export function GET(): NextResponse {
  const endpoint = absoluteUrl("/api/mcp");
  return NextResponse.json(
    {
      $schema: "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json",
      name: "handover-care-board",
      version: SERVER_VERSION,
      description:
        "Shared care board for one person: log doses and observations, run a deterministic handover-readiness engine, and seal a handover brief. Mutations are idempotent and append-only.",
      protocolVersion: PROTOCOL_VERSION,
      repository: { url: "https://github.com/aniruddhaadak80/handover", source: "github" },
      remotes: [
        {
          type: "http",
          url: endpoint,
          headers: [],
          description: "JSON-RPC 2.0 over HTTP. Scope is the calling browser session cookie.",
        },
      ],
      tools: TOOL_NAMES,
      safety: {
        domain: "health-adjacent",
        disclaimer:
          "Handover surfaces record-keeping gaps and public label sections. It does not diagnose and never instructs a dose change. Escalate to a prescriber or pharmacist.",
      },
    },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=300",
      },
    },
  );
}