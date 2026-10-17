// SPEC.md R1 "Install reports": /api/install-reports.json — install report issues grouped
// by device id and route method (core ReportGroup). Reports never modify records.
import { reportGroups } from "../../lib/reports.ts";

export async function GET() {
  return new Response(JSON.stringify(await reportGroups()), { headers: { "Content-Type": "application/json" } });
}
