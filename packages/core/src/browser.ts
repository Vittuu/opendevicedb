// Browser-safe part of core: types, ids, claims and search. No Node imports, so the
// website can ship it to the client. index.ts re-exports all of it.

export type Status = "unknown" | "in-progress" | "partial-protocol" | "controllable" | "open-firmware";

export const STATUSES: Status[] = ["unknown", "in-progress", "partial-protocol", "controllable", "open-firmware"];

export interface Claim { who: string; contact: string; scope: string; since: string; expires: string; agent?: string }
export type NonFree =
  | "vendor-blobs" | "device-firmware" | "modem" | "gpu" | "wifi"
  | "bluetooth" | "camera" | "sensors" | "bootloader" | "other";
export type Cloud = "none" | "setup-only" | "optional" | "required" | "unknown";
/** What stays proprietary or cloud-bound once a project is in use (SPEC "Freedom"). */
export interface Freedom { nonfree?: NonFree[]; cloud?: Cloud; notes?: string }
export interface Project { name: string; url: string; kind: string; license?: string; official?: boolean; freedom?: Freedom }
export interface Interface { name: string; transport: string; status: string; confidence?: string; spec?: string; notes?: string }
export interface Verification { method: string; by: string; date: string; firmware?: string; notes?: string }
export type InstallMethod =
  | "host-software" | "pairing" | "web-serial" | "ota-exploit" | "vendor-upload"
  | "usb-bootloader" | "sd-card" | "serial" | "spi-programmer" | "other";
/** One way to put the open firmware or software on a device (SPEC R1). */
export interface InstallRoute {
  project: string;
  method: InstallMethod;
  guide: string;
  installer?: string;
  difficulty: "easy" | "medium" | "hard";
  tools?: string[];
  opens_device?: boolean;
  mains_powered?: boolean;
  brick_risk?: "none" | "low" | "medium" | "high";
  reversible?: "yes" | "no" | "partial";
  revert?: string;
  firmware_constraints?: string;
  notes?: string;
}

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
  install?: InstallRoute[];
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

export const statusRank = (s: Status) => STATUSES.indexOf(s);

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
  /** Difficulty of the easiest install route, when the record has any (SPEC R1). */
  install?: InstallRoute["difficulty"];
  /** Least cloud dependency across projects, when any project says (SPEC "Freedom"). */
  cloud?: Exclude<Cloud, "unknown">;
  updated: string;
}

const DIFFICULTY = ["easy", "medium", "hard"] as const;
/** Difficulty of the easiest route, or undefined when there is none. */
export function easiestInstall(r: Pick<DeviceRecord, "install">): InstallRoute["difficulty"] | undefined {
  const d = (r.install ?? []).map((i) => DIFFICULTY.indexOf(i.difficulty)).filter((n) => n >= 0);
  return d.length ? DIFFICULTY[Math.min(...d)] : undefined;
}

const CLOUD = ["none", "setup-only", "optional", "required"] as const;
/** Least cloud dependency across projects ("unknown" and absent ignored), or undefined. */
export function bestCloud(r: Pick<DeviceRecord, "projects">): IndexEntry["cloud"] {
  const c = (r.projects ?? []).map((p) => CLOUD.indexOf(p.freedom?.cloud as any)).filter((n) => n >= 0);
  return c.length ? CLOUD[Math.min(...c)] : undefined;
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
    ...(easiestInstall(r) ? { install: easiestInstall(r) } : {}),
    ...(bestCloud(r) ? { cloud: bestCloud(r) } : {}),
    updated: r.updated,
  };
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface SearchFilters { category?: string; status?: Status; limit?: number }

interface SearchKeys { hay: string; words: Set<string>; ids: string[]; model: string; full: string }

// Normalised search keys, computed once per entry (the index is reused across keystrokes).
const keyCache = new WeakMap<IndexEntry, SearchKeys>();
function keys(e: IndexEntry): SearchKeys {
  let k = keyCache.get(e);
  if (!k) {
    const hay = `${norm(`${e.vendor} ${e.model}`)} ${norm(e.aliases.join(" "))}`;
    k = {
      hay, words: new Set(hay.split(" ")),
      ids: Object.values(e.identifiers).flat().map((x) => compact(x!)),
      model: compact(e.model), full: compact(`${e.vendor}${e.model}`),
    };
    keyCache.set(e, k);
  }
  return k;
}

/** Token search over vendor, model, aliases and identifiers. Pure, usable in the browser. */
export function search(entries: IndexEntry[], query: string, f: SearchFilters = {}): (IndexEntry & { score: number })[] {
  const q = norm(query);
  const tokens = q.split(" ").filter(Boolean);
  const qc = compact(query);
  const out: (IndexEntry & { score: number })[] = [];
  for (const e of entries) {
    if (f.category && e.category !== f.category) continue;
    if (f.status && e.status !== f.status) continue;
    if (!tokens.length) { out.push({ ...e, score: 0 }); continue; }
    const { hay, words, ids, model, full } = keys(e);
    let score = 0;
    if (qc && ids.includes(qc)) score += 100;
    if (model === qc || full === qc) score += 50;
    let all = true;
    for (const t of tokens) {
      if (words.has(t)) score += 10;
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

export * from "./wanted.ts";
export * from "./reports.ts";
export * from "./detect.ts";
