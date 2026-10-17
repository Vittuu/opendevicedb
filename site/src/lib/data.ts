// Build-time data access. Everything is loaded once per build and shared by all pages.
import {
  loadAll, loadCurated, loadSnapshots, toIndexEntry, liveClaims, effectiveStatus, today,
  stringifyRecordYaml, STATUSES,
  type DeviceRecord, type IndexEntry, type Snapshot, type Status, type Claim,
} from "@opendevicedb/core";
import { REPO_URL } from "./config.ts";

declare const __ODB_ROOT__: string;

/** Repository root the data is read from (ODB_REPO overrides, e.g. for scale tests). */
export const ROOT: string = process.env.ODB_REPO || __ODB_ROOT__;

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  license: string;
  fetched_at?: string;
  count: number;
}

interface Db {
  on: string;
  records: DeviceRecord[];
  byId: Map<string, DeviceRecord>;
  index: IndexEntry[];
  curatedIds: Set<string>;
  snapshots: Omit<Snapshot, "records">[];
  sources: Map<string, SourceInfo>;
}

let cache: Db | undefined;

export function db(): Db {
  if (cache) return cache;
  const t0 = performance.now();
  const on = today();
  const curated = loadCurated(ROOT);
  const snaps = loadSnapshots(ROOT);
  const records = loadAll(ROOT);
  const sources = new Map<string, SourceInfo>();
  sources.set("curated", {
    id: "curated",
    name: "OpenDeviceDB (curated)",
    url: `${REPO_URL}/tree/main/data/devices`,
    license: "CC BY-SA 4.0",
    count: curated.length,
  });
  for (const s of snaps) {
    sources.set(s.source, { id: s.source, name: s.name, url: s.url, license: s.license, fetched_at: s.fetched_at, count: s.records.length });
  }
  cache = {
    on,
    records,
    byId: new Map(records.map((r) => [r.id, r])),
    index: records.map((r) => toIndexEntry(r, on)),
    curatedIds: new Set(curated.map((c) => c.record.id)),
    snapshots: snaps.map(({ records: _r, ...meta }) => meta),
    sources,
  };
  if (process.env.ODB_TIMING) console.log(`[odb] loaded ${records.length} records in ${Math.round(performance.now() - t0)} ms`);
  return cache;
}

// ---------- urls ----------

/** Every record gets a pre-rendered page (20k records build in ~45 s; see site/README.md). */
export const deviceUrl = (id: string) => `/devices/${id}/`;

export const jsonUrl = (id: string) => `/api/devices/${id}.json`;

// ---------- aggregates ----------

export function counts() {
  const { index, snapshots } = db();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  for (const e of index) byStatus[e.status]++;
  return { devices: index.length, sources: snapshots.length, byStatus };
}

export function activeClaims(): { record: DeviceRecord; claim: Claim }[] {
  const { records, on } = db();
  const out: { record: DeviceRecord; claim: Claim }[] = [];
  for (const r of records) for (const c of liveClaims(r, on)) out.push({ record: r, claim: c });
  return out.sort((a, b) => b.claim.since.localeCompare(a.claim.since));
}

export function latestCurated(n = 6): DeviceRecord[] {
  const { records, curatedIds } = db();
  return records.filter((r) => curatedIds.has(r.id)).sort((a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id)).slice(0, n);
}

export function facet(key: "category" | "status"): [string, number][] {
  const m = new Map<string, number>();
  for (const e of db().index) m.set(e[key], (m.get(e[key]) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}

export function sourceFacet(): [string, number][] {
  const m = new Map<string, number>();
  for (const e of db().index) for (const s of e.sources) m.set(s, (m.get(s) ?? 0) + 1);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}

export function sourceName(id: string): string {
  return db().sources.get(id)?.name ?? id;
}

export { effectiveStatus, liveClaims };

// ---------- GitHub links ----------

export function editUrl(r: DeviceRecord): string {
  if (db().curatedIds.has(r.id)) return `${REPO_URL}/edit/main/data/devices/${r.id}.yaml`;
  // Imported-only record: open a new curated file prefilled with a stub that overrides it.
  const [vendor, model] = r.id.split("/");
  const stub: DeviceRecord = {
    id: r.id, vendor: r.vendor, model: r.model, category: r.category, status: r.status,
    ...(r.summary ? { summary: r.summary } : {}),
    provenance: { sources: ["curated"], ai_assisted: false },
    updated: db().on,
  };
  const q = new URLSearchParams({ filename: `${model}.yaml`, value: stringifyRecordYaml(stub) });
  return `${REPO_URL}/new/main/data/devices/${vendor}?${q}`;
}
