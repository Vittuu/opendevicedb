// Data backends for the MCP server: a local repository checkout (read + write) or the
// static API published by the site (read-only). See SPEC.md "Static API".
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  loadAll, loadCurated, loadSnapshots, toIndexEntry, today, REPO_ROOT,
  type DeviceRecord, type IndexEntry, type Status,
} from "@opendevicedb/core";

export interface SourceInfo {
  source: string;
  name?: string;
  url?: string;
  license?: string;
  fetched_at?: string;
  records: number;
}

export interface SourcesInfo {
  sources: SourceInfo[];
  curated: number | null;   // null when the backend cannot tell (remote without sources.json)
  total: number;
}

export interface Backend {
  readonly kind: "local" | "remote";
  /** Repository path or API base URL, for messages. */
  readonly location: string;
  /** Repository root when writes are allowed, undefined for read-only backends. */
  readonly root?: string;
  /** Every device, as index entries (effective status computed for `on`). */
  index(on?: string): Promise<IndexEntry[]>;
  /** Records usable by core `lookup` (full locally, slim index-derived remotely). */
  records(): Promise<DeviceRecord[]>;
  /** Full merged record, or null. */
  get(id: string): Promise<DeviceRecord | null>;
  sources(): Promise<SourcesInfo>;
}

// ---------- local repository ----------

export class LocalBackend implements Backend {
  readonly kind = "local" as const;
  readonly root: string;
  readonly location: string;
  constructor(root: string) {
    this.root = root;
    this.location = root;
  }
  // Re-read on every call: the repository is small and may change under us (git pull, edits).
  async records() { return loadAll(this.root); }
  async index(on = today()) { return loadAll(this.root).map((r) => toIndexEntry(r, on)); }
  async get(id: string) { return loadAll(this.root).find((r) => r.id === id) ?? null; }
  async sources(): Promise<SourcesInfo> {
    return {
      sources: loadSnapshots(this.root).map((s) => ({
        source: s.source, name: s.name, url: s.url, license: s.license, fetched_at: s.fetched_at, records: s.records.length,
      })),
      curated: loadCurated(this.root).length,
      total: loadAll(this.root).length,
    };
  }
}

// ---------- remote static API ----------

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export const CACHE_TTL_MS = 10 * 60 * 1000;

/** Static API entries; SPEC.md guarantees id, vendor, model, category, status, sources, identifiers. */
function normalizeEntry(e: any): IndexEntry {
  return {
    id: e.id, vendor: e.vendor, model: e.model, aliases: e.aliases ?? [], category: e.category,
    status: e.status as Status, sources: e.sources ?? [], identifiers: e.identifiers ?? {},
    claims: e.claims ?? 0, verified: e.verified ?? false, updated: e.updated ?? "",
  };
}

export class RemoteBackend implements Backend {
  readonly kind = "remote" as const;
  readonly root = undefined;
  readonly location: string;
  private cache = new Map<string, { at: number; value: any }>();
  private fetchImpl: FetchLike;
  private now: () => number;

  constructor(baseUrl: string, opts: { fetch?: FetchLike; now?: () => number } = {}) {
    this.location = baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? ((u) => fetch(u));
    this.now = opts.now ?? Date.now;
  }

  /** GET a JSON document, cached for CACHE_TTL_MS. Returns null on 404. */
  private async getJson(path: string): Promise<any> {
    const url = `${this.location}${path}`;
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < CACHE_TTL_MS) return hit.value;
    const res = await this.fetchImpl(url);
    let value: any = null;
    if (res.ok) value = await res.json();
    else if (res.status !== 404) throw new Error(`GET ${url} failed: HTTP ${res.status}`);
    this.cache.set(url, { at: this.now(), value });
    return value;
  }

  async index(): Promise<IndexEntry[]> {
    const data = await this.getJson("/api/index.json");
    if (!Array.isArray(data)) throw new Error(`${this.location}/api/index.json is missing or not an array`);
    return data.map(normalizeEntry);
  }

  async records(): Promise<DeviceRecord[]> {
    // Slim records: enough for core lookup (ids, names, identifiers). Full record via get().
    return (await this.index()).map((e) => ({
      id: e.id, vendor: e.vendor, model: e.model, aliases: e.aliases, category: e.category,
      status: e.status, identifiers: e.identifiers, provenance: { sources: e.sources }, updated: e.updated,
    }));
  }

  async get(id: string): Promise<DeviceRecord | null> {
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) return null;
    return this.getJson(`/api/devices/${id}.json`);
  }

  async sources(): Promise<SourcesInfo> {
    const index = await this.index();
    // Optional richer endpoint (not in SPEC v0); fall back to counting index entries per source.
    const extra = await this.getJson("/api/sources.json").catch(() => null);
    if (extra && Array.isArray(extra.sources)) {
      return { sources: extra.sources, curated: extra.curated ?? null, total: index.length };
    }
    const counts = new Map<string, number>();
    for (const e of index) for (const s of e.sources) counts.set(s, (counts.get(s) ?? 0) + 1);
    return {
      sources: [...counts].sort().map(([source, records]) => ({ source, records })),
      curated: null,
      total: index.length,
    };
  }
}

// ---------- selection ----------

export const DEFAULT_API_URL = "https://opendevicedb.org";

/** ODB_REPO (local, writable) wins over ODB_API_URL (remote, read-only); default: this checkout
 *  when run from one, otherwise the public site (npm install). */
export function backendFromEnv(env: Record<string, string | undefined> = process.env): Backend {
  if (env.ODB_REPO) return new LocalBackend(resolve(env.ODB_REPO));
  if (env.ODB_API_URL) return new RemoteBackend(env.ODB_API_URL);
  if (existsSync(join(REPO_ROOT, "data/devices"))) return new LocalBackend(REPO_ROOT);
  return new RemoteBackend(DEFAULT_API_URL);
}
