// SPEC.md "Static API": /api/index.json — one IndexEntry per device (core toIndexEntry).
// Consumed by the MCP server (ODB_API_URL) and by the directory search island.
import { db } from "../../lib/data.ts";

export function GET() {
  return new Response(JSON.stringify(db().index), { headers: { "Content-Type": "application/json" } });
}
