// OpenDeviceDB core: load, validate, merge and search device records.
// Shared by the site, the MCP server and the importers. See SPEC.md.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import SCHEMA_JSON from "../../../schema/device.schema.json" with { type: "json" };
import { STATUSES, statusRank, makeId, search, toIndexEntry, compact, type Status, type DeviceRecord, type IndexEntry } from "./browser.ts";

export * from "./browser.ts";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SCHEMA_PATH = join(REPO_ROOT, "schema/device.schema.json");
/** The normative record schema, imported so bundles (npm package, site) carry it. */
export const SCHEMA: any = SCHEMA_JSON;

// ---------- validation ----------

let validator: ((r: unknown) => boolean) & { errors?: any[] | null } | undefined;

export function validate(record: unknown): string[] {
  if (!validator) {
    const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
    (addFormats as any)(ajv);
    validator = ajv.compile(SCHEMA);
  }
  if (validator!(record)) return [];
  return (validator!.errors ?? []).map((e: any) => `${e.instancePath || "/"} ${e.message}${e.params?.allowedValues ? " " + JSON.stringify(e.params.allowedValues) : ""}`);
}

// ---------- loading ----------

function walk(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}

/** YAML parses bare dates as Date objects; the schema wants ISO strings. */
function normalizeDates(v: any): any {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(normalizeDates);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizeDates(x)]));
  return v;
}

export function parseRecordYaml(text: string): DeviceRecord {
  return normalizeDates(YAML.parse(text));
}

export function stringifyRecordYaml(record: DeviceRecord): string {
  return YAML.stringify(record, { lineWidth: 100 });
}

export function curatedPath(id: string, root = REPO_ROOT): string {
  return join(root, "data/devices", `${id}.yaml`);
}

export function loadCurated(root = REPO_ROOT): { file: string; record: DeviceRecord }[] {
  return walk(join(root, "data/devices"), ".yaml").map((file) => ({
    file: relative(root, file),
    record: parseRecordYaml(readFileSync(file, "utf8")),
  }));
}

export function loadSnapshots(root = REPO_ROOT): Snapshot[] {
  return walk(join(root, "data/imported"), ".json").map((f) => JSON.parse(readFileSync(f, "utf8")));
}

// ---------- merging ----------


function uniqBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const it of items) if (!seen.has(key(it))) seen.set(key(it), it);
  return [...seen.values()];
}

function mergeIdentifiers(a: DeviceRecord["identifiers"] = {}, b: DeviceRecord["identifiers"] = {}) {
  const out: NonNullable<DeviceRecord["identifiers"]> = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof typeof out, string[]][]) {
    out[k] = [...new Set([...(out[k] ?? []), ...(v ?? [])])];
  }
  return out;
}

/** Projects unioned by url, `a` first; a project that says nothing about freedom takes it from its duplicate. */
function mergeProjects(a: DeviceRecord["projects"] = [], b: DeviceRecord["projects"] = []) {
  return uniqBy([...a, ...b], (p) => p.url).map((p) => {
    if (p.freedom) return p;
    const freedom = [...a, ...b].find((q) => q.url === p.url && q.freedom)?.freedom;
    return freedom ? { ...p, freedom } : p;
  });
}

/** Merge b into a. `a` wins on scalar fields; lists are unioned; status takes the furthest. */
export function mergeRecords(a: DeviceRecord, b: DeviceRecord): DeviceRecord {
  return {
    ...b,
    ...a,
    aliases: [...new Set([...(a.aliases ?? []), ...(b.aliases ?? [])])],
    identifiers: mergeIdentifiers(a.identifiers, b.identifiers),
    status: statusRank(a.status) >= statusRank(b.status) ? a.status : b.status,
    summary: a.summary ?? b.summary,
    interfaces: uniqBy([...(a.interfaces ?? []), ...(b.interfaces ?? [])], (i) => `${i.transport}:${i.name}`),
    projects: mergeProjects(a.projects, b.projects),
    install: uniqBy([...(a.install ?? []), ...(b.install ?? [])], (i) => `${i.method}:${i.guide}`),
    claims: uniqBy([...(a.claims ?? []), ...(b.claims ?? [])], (c) => `${c.who}:${c.since}:${c.scope}`),
    verification: [...(a.verification ?? []), ...(b.verification ?? [])],
    provenance: {
      ...b.provenance,
      ...a.provenance,
      sources: [...new Set([...(a.provenance?.sources ?? []), ...(b.provenance?.sources ?? [])])],
    },
    updated: a.updated > b.updated ? a.updated : b.updated,
  };
}

/** All records, curated first (they override), then every snapshot, merged by id. */
export function loadAll(root = REPO_ROOT): DeviceRecord[] {
  const byId = new Map<string, DeviceRecord>();
  for (const { record } of loadCurated(root)) {
    byId.set(record.id, byId.has(record.id) ? mergeRecords(byId.get(record.id)!, record) : record);
  }
  for (const snap of loadSnapshots(root)) {
    for (const r of snap.records) byId.set(r.id, byId.has(r.id) ? mergeRecords(byId.get(r.id)!, r) : r);
  }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

// One index entry per record object, so repeated lookups reuse core search's per-entry keys.
const entries = new WeakMap<DeviceRecord, IndexEntry>();
const entryOf = (r: DeviceRecord): IndexEntry => {
  let e = entries.get(r);
  if (!e) entries.set(r, (e = toIndexEntry(r)));
  return e;
};

export interface LookupQuery { vendor?: string; model?: string; fcc_id?: string; usb?: string; ble_name?: string; zigbee_model?: string }

/** Best single match for a device description, or null. Identifiers beat names. */
export function lookup(records: DeviceRecord[], q: LookupQuery): DeviceRecord | null {
  const idKeys: [keyof LookupQuery, keyof NonNullable<DeviceRecord["identifiers"]>][] = [
    ["fcc_id", "fcc_id"], ["usb", "usb"], ["ble_name", "ble_names"], ["zigbee_model", "zigbee_model"],
  ];
  for (const [qk, rk] of idKeys) {
    const v = q[qk];
    if (!v) continue;
    const hit = records.find((r) => (r.identifiers?.[rk] ?? []).some((x) => compact(x) === compact(v)));
    if (hit) return hit;
  }
  if (q.model) {
    const id = q.vendor ? makeId(q.vendor, q.model) : undefined;
    const exact = id && records.find((r) => r.id === id);
    if (exact) return exact;
    const best = search(records.map(entryOf), `${q.vendor ?? ""} ${q.model}`, { limit: 1 })[0];
    if (best && best.score >= 20) return records.find((r) => r.id === best.id) ?? null;
  }
  return null;
}
