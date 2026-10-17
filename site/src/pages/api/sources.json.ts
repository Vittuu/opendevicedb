// Extra endpoint (not in SPEC v0): snapshot metadata, same shape as the MCP list_sources()
// result of the local backend: {sources: [{source, name, url, license, fetched_at, records}], curated, total}.
import { db } from "../../lib/data.ts";

export function GET() {
  const { snapshots, sources, curatedIds, records } = db();
  const body = {
    sources: snapshots.map((s) => ({
      source: s.source, name: s.name, url: s.url, license: s.license, fetched_at: s.fetched_at,
      records: sources.get(s.source)?.count ?? 0,
    })),
    curated: curatedIds.size,
    total: records.length,
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json" } });
}
