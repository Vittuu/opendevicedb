// Shared helpers for importers: HTTP with retries, GitHub listing, frontmatter,
// name splitting and snapshot finalisation (validate, dedupe, compact, sort).
import YAML from "yaml";
import { validate, mergeRecords, type DeviceRecord, type Snapshot } from "@opendevicedb/core";

export interface Source {
  source: string;   // short id, also the snapshot file name
  name: string;     // display name
  url: string;      // upstream project
  license: string;  // license of the upstream data
  fetch(): Promise<DeviceRecord[]>;
}

const UA = "opendevicedb-importer/0.1 (+https://github.com/opendevicedb)";

// ---------- http ----------

export async function fetchText(url: string, { retries = 6, headers = {} as Record<string, string> } = {}): Promise<string> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, ...headers } });
      if (res.ok) return await res.text();
      last = new Error(`${res.status} ${res.statusText} for ${url}`);
      if (res.status !== 429 && res.status < 500) break; // 4xx other than rate limit: give up
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export async function fetchJson<T = any>(url: string, opts?: Parameters<typeof fetchText>[1]): Promise<T> {
  return JSON.parse(await fetchText(url, opts));
}

/** Run fn over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- github ----------

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Paths of every blob in a repository branch (one API call). */
export async function githubFiles(repo: string, branch: string): Promise<string[]> {
  const tree = await fetchJson(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { headers: githubHeaders() });
  if (tree.truncated) throw new Error(`git tree of ${repo} is truncated`);
  return tree.tree.filter((x: any) => x.type === "blob").map((x: any) => x.path as string);
}

export function githubRaw(repo: string, branch: string, path: string): Promise<string> {
  return fetchText(`https://raw.githubusercontent.com/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`);
}

// ---------- parsing ----------

/**
 * YAML frontmatter of a markdown file, or null when absent or unparsable. Lenient like
 * Jekyll: leading blank lines and trailing spaces around the fences, duplicate keys (last wins).
 */
export function frontmatter(text: string): Record<string, any> | null {
  const m = text.replace(/^﻿/, "").match(/^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/);
  if (!m) return null;
  try {
    const v = YAML.parse(m[1], { uniqueKeys: false });
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

export const clean = (s: unknown): string => (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(/\s+/g, " ").trim();

/**
 * Upstream lists that only give a free-text title ("Athom Smart Plug PG01V2") have no
 * vendor field: take the first word as vendor. An explicit model wins over the rest
 * of the title, which then becomes an alias. A one-word title has no vendor: "Generic".
 */
export function splitTitle(title: string, model?: string): { vendor: string; model: string; aliases: string[] } {
  const t = clean(title);
  const m = clean(model);
  const words = t.split(" ").filter(Boolean);
  if (words.length <= 1) {
    const w = words[0] ?? "";
    // "2nice" + model "SP111": the title is the brand. A lone title is just the model.
    if (m && w && w.toLowerCase() !== m.toLowerCase()) return { vendor: w, model: m, aliases: [] };
    return { vendor: "Generic", model: m || w, aliases: [] };
  }
  const [vendor, ...rest] = words;
  if (m) return { vendor, model: m, aliases: [t] };
  return { vendor, model: rest.join(" "), aliases: [] };
}

/** First match in an ordered [regex, value] table, else the fallback. */
export function firstMatch<T>(table: [RegExp, T][], text: string, fallback: T): T {
  for (const [re, v] of table) if (re.test(text)) return v;
  return fallback;
}

// ---------- records ----------

const uniq = (xs: string[]) => [...new Set(xs.map(clean).filter(Boolean))];

/** Drop empty arrays/objects/strings so snapshots stay small; dedupe string lists. */
export function compactRecord(r: DeviceRecord): DeviceRecord {
  const out: any = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      const arr = v.every((x) => typeof x === "string") ? uniq(v as string[]) : v;
      if (arr.length) out[k] = arr;
    } else if (typeof v === "object") {
      const inner = Object.fromEntries(
        Object.entries(v).flatMap(([ik, iv]) => {
          if (Array.isArray(iv)) { const a = uniq(iv as string[]); return a.length ? [[ik, a]] : []; }
          return iv === undefined ? [] : [[ik, iv]];
        }),
      );
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = v;
  }
  return out;
}

export interface Finalized { records: DeviceRecord[]; input: number; invalid: number; merged: number; errors: string[] }

/** Validate, merge duplicates by id, compact and sort the records of one source. */
export function finalize(records: DeviceRecord[]): Finalized {
  const byId = new Map<string, DeviceRecord>();
  const errors: string[] = [];
  let invalid = 0, merged = 0;
  for (const raw of records) {
    const r = compactRecord(raw);
    const errs = validate(r);
    if (errs.length) {
      invalid++;
      if (errors.length < 20) errors.push(`${r.id ?? "?"}: ${errs[0]}`);
      continue;
    }
    const prev = byId.get(r.id);
    if (prev) merged++;
    byId.set(r.id, prev ? compactRecord(mergeRecords(prev, r)) : r);
  }
  const out = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { records: out, input: records.length, invalid, merged, errors };
}

export function snapshot(src: Source, records: DeviceRecord[], fetchedAt = new Date()): Snapshot {
  return { source: src.source, name: src.name, url: src.url, license: src.license, fetched_at: fetchedAt.toISOString(), records };
}

/** Snapshot as JSON with one record per line: small, and diffs stay readable. */
export function stringifySnapshot(s: Snapshot): string {
  const { records, ...head } = s;
  const top = JSON.stringify(head, null, 1).slice(0, -2); // drop the closing "\n}"
  return `${top},\n "records": [\n${records.map((r) => "  " + JSON.stringify(r)).join(",\n")}\n ]\n}\n`;
}
