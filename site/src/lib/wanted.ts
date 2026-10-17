// Build-time device requests: open GitHub issues labelled "wanted" (core/wanted.ts).
// ODB_WANTED_FILE=<json of WantedRequest[]> replaces the API (tests, offline builds);
// ODB_WANTED=off skips it. In CI a failed fetch fails the build, so the last good
// deploy stays online instead of one without requests.
import { readFileSync } from "node:fs";
import { fetchWanted, groupWanted, statusRank, type WantedEntry, type WantedRequest } from "@opendevicedb/core";
import { db } from "./data.ts";

let cache: Promise<WantedEntry[]> | undefined;

async function load(): Promise<WantedRequest[]> {
  if (process.env.ODB_WANTED === "off") return [];
  if (process.env.ODB_WANTED_FILE) return JSON.parse(readFileSync(process.env.ODB_WANTED_FILE, "utf8"));
  try {
    return await fetchWanted({ token: process.env.GITHUB_TOKEN });
  } catch (e: any) {
    if (process.env.CI) throw e;
    console.warn(`[odb] device requests not loaded (${e.message}); building without them`);
    return [];
  }
}

export function wanted(): Promise<WantedEntry[]> {
  return (cache ??= load().then(groupWanted));
}

export async function wantedById(): Promise<Map<string, WantedEntry>> {
  return new Map((await wanted()).map((w) => [w.id, w]));
}

/** Requests whose device is still not usable (absent from the registry, or below partial-protocol). */
export async function openWanted(): Promise<(WantedEntry & { inRegistry: boolean })[]> {
  const status = new Map(db().index.map((e) => [e.id, e.status]));
  return (await wanted())
    .map((w) => ({ ...w, inRegistry: status.has(w.id) }))
    .filter((w) => !w.inRegistry || statusRank(status.get(w.id)!) < statusRank("partial-protocol"));
}
