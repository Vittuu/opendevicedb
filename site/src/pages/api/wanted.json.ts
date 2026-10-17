// SPEC.md "Requests": /api/wanted.json — open device requests grouped by id (core WantedEntry).
// Consumed by the MCP server and by the directory search island.
import { wanted } from "../../lib/wanted.ts";

export async function GET() {
  return new Response(JSON.stringify(await wanted()), { headers: { "Content-Type": "application/json" } });
}
