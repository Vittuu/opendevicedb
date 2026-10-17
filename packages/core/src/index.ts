// OpenDeviceDB core: load, validate, merge and search device records.
// Shared by the site, the MCP server and the importers. See SPEC.md.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export type Status = "unknown" | "in-progress" | "partial-protocol" | "controllable" | "open-firmware";

export const STATUSES: Status[] = ["unknown", "in-progress", "partial-protocol", "controllable", "open-firmware"];

export interface Claim { who: string; contact: string; scope: string; since: string; expires: string; agent?: string }
export interface Project { name: string; url: string; kind: string; license?: string; official?: boolean }
export interface Interface { name: string; transport: string; status: string; confidence?: string; spec?: string; notes?: string }
export interface Verification { method: string; by: string; date: string; firmware?: string; notes?: string }

export interface DeviceRecord {
  id: string;
  vendor: string;
  model: string;
  aliases?: string[];
  category: string;
  identifiers?: Partial<Record<"fcc_id" | "usb" | "ble_names" | "chips" | "sku" | "zigbee_model", string[]>>;
  status: Status;
  summary?: string;
  vendor_support?: string;
  interfaces?: Interface[];
  projects?: Project[];
  claims?: Claim[];
  verification?: Verification[];
  provenance?: { sources?: string[]; ai_assisted?: boolean; tools?: string[] };
  updated: string;
}

/** An importer snapshot, stored as data/imported/<source>.json */
export interface Snapshot {
  source: string;        // short id, e.g. "zigbee2mqtt"
  name: string;          // display name, e.g. "Zigbee2MQTT"
  url: string;           // upstream project
  license: string;       // license of the upstream data
  fetched_at: string;    // ISO datetime
  records: DeviceRecord[];
}

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SCHEMA_PATH = join(REPO_ROOT, "schema/device.schema.json");

// ---------- ids ----------

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "x";
}

export function makeId(vendor: string, model: string): string {
  return `${slugify(vendor)}/${slugify(model)}`;
}

// ---------- validation ----------

let validator: ((r: unknown) => boolean) & { errors?: any[] | null } | undefined;

export function validate(record: unknown): string[] {
  if (!validator) {
    const ajv = new (Ajv2020 as any)({ allErrors: true, strict: false });
    (addFormats as any)(ajv);
    validator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, "utf8")));
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

const statusRank = (s: Status) => STATUSES.indexOf(s);

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
    projects: uniqBy([...(a.projects ?? []), ...(b.projects ?? [])], (p) => p.url),
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

// ---------- claims ----------

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function liveClaims(r: DeviceRecord, on = today()): Claim[] {
  return (r.claims ?? []).filter((c) => c.expires >= on);
}

/** Status as displayed: a record with nothing known but a live claim is "in-progress". */
export function effectiveStatus(r: DeviceRecord, on = today()): Status {
  if (r.status === "unknown" && liveClaims(r, on).length) return "in-progress";
  if (r.status === "in-progress" && !liveClaims(r, on).length) return "unknown";
  return r.status;
}

// ---------- index & search ----------

export interface IndexEntry {
  id: string;
  vendor: string;
  model: string;
  aliases: string[];
  category: string;
  status: Status;
  sources: string[];
  identifiers: NonNullable<DeviceRecord["identifiers"]>;
  claims: number;
  verified: boolean;
  updated: string;
}

export function toIndexEntry(r: DeviceRecord, on = today()): IndexEntry {
  return {
    id: r.id,
    vendor: r.vendor,
    model: r.model,
    aliases: r.aliases ?? [],
    category: r.category,
    status: effectiveStatus(r, on),
    sources: r.provenance?.sources ?? [],
    identifiers: r.identifiers ?? {},
    claims: liveClaims(r, on).length,
    verified: (r.verification ?? []).some((v) => v.method === "hardware-replay"),
    updated: r.updated,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface SearchFilters { category?: string; status?: Status; limit?: number }

/** Token search over vendor, model, aliases and identifiers. Pure, usable in the browser. */
export function search(entries: IndexEntry[], query: string, f: SearchFilters = {}): (IndexEntry & { score: number })[] {
  const q = norm(query);
  const tokens = q.split(" ").filter(Boolean);
  const qc = compact(query);
  const out: (IndexEntry & { score: number })[] = [];
  for (const e of entries) {
    if (f.category && e.category !== f.category) continue;
    if (f.status && e.status !== f.status) continue;
    const ids = Object.values(e.identifiers).flat().map((x) => compact(x!));
    if (!tokens.length) { out.push({ ...e, score: 0 }); continue; }
    const name = norm(`${e.vendor} ${e.model}`);
    const hay = `${name} ${norm(e.aliases.join(" "))}`;
    let score = 0;
    if (qc && ids.includes(qc)) score += 100;
    if (compact(e.model) === qc || compact(`${e.vendor}${e.model}`) === qc) score += 50;
    let all = true;
    for (const t of tokens) {
      if (hay.split(" ").includes(t)) score += 10;
      else if (hay.includes(t) || ids.some((i) => i.includes(t))) score += 4;
      else all = false;
    }
    if (!all && score < 100) continue;
    score += statusRank(e.status); // prefer records with more known
    out.push({ ...e, score });
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return out.slice(0, f.limit ?? 50);
}

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
    const best = search(records.map((r) => toIndexEntry(r)), `${q.vendor ?? ""} ${q.model}`, { limit: 1 })[0];
    if (best && best.score >= 20) return records.find((r) => r.id === best.id) ?? null;
  }
  return null;
}
