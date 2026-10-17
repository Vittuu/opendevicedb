// Build-time install reports: GitHub issues labelled "install-report" (core/reports.ts).
// ODB_REPORTS_FILE=<json of InstallReport[]> replaces the API (tests, offline builds);
// ODB_REPORTS=off skips it. In CI a failed fetch fails the build, so the last good deploy
// stays online instead of one without reports. Reports never modify records.
import { readFileSync } from "node:fs";
import { fetchReports, groupReports, type InstallReport, type ReportGroup } from "@opendevicedb/core";

let cache: Promise<InstallReport[]> | undefined;

async function load(): Promise<InstallReport[]> {
  if (process.env.ODB_REPORTS === "off") return [];
  if (process.env.ODB_REPORTS_FILE) return JSON.parse(readFileSync(process.env.ODB_REPORTS_FILE, "utf8"));
  try {
    return await fetchReports({ token: process.env.GITHUB_TOKEN });
  } catch (e: any) {
    if (process.env.CI) throw e;
    console.warn(`[odb] install reports not loaded (${e.message}); building without them`);
    return [];
  }
}

export function reports(): Promise<InstallReport[]> {
  return (cache ??= load());
}

let byId: Promise<Map<string, InstallReport[]>> | undefined;
/** Reports of one device (any route). */
export async function reportsFor(id: string): Promise<InstallReport[]> {
  byId ??= reports().then((all) => {
    const m = new Map<string, InstallReport[]>();
    for (const r of all) m.set(r.id, [...(m.get(r.id) ?? []), r]);
    return m;
  });
  return (await byId).get(id) ?? [];
}

export async function reportGroups(): Promise<ReportGroup[]> {
  return groupReports(await reports());
}
