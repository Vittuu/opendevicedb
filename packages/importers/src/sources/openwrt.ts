// OpenWrt Table of Hardware, from the wiki's JSON dataset dump (openwrt.org/toh.json:
// {columns[], captions[], entries[][]}). Only devices whose "Supported Current Rel" is
// a release number are kept (not EOL, snapshot-only, or unsupported).
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, fetchJson, type Source } from "../lib.ts";

export const TOH_URL = "https://openwrt.org/toh.json";

/** "Device Type" → category. Missing types fall back to "other"; null drops the row. */
export const DEVICE_TYPE_CATEGORIES: Record<string, string | null> = {
  "wifi router": "router",
  "router": "router",
  "travel router": "router",
  "travel router - battery powered": "router",
  "wifi ap": "router",
  "range extender": "router",
  "modem": "router",
  "single board computer": "single-board",
  "camera": "ip-camera",
  "nas": "other",
  "switch": "other",
  "emulator": null, // virtual machines, not hardware
};

export function tohCategory(deviceType: string | null | undefined): string | null {
  const k = clean(deviceType).toLowerCase();
  return k in DEVICE_TYPE_CATEGORIES ? DEVICE_TYPE_CATEGORIES[k] : "other";
}

const isRelease = (v: unknown) => typeof v === "string" && /^\d+\.\d+(\.\d+)?$/.test(v.trim());

/** FCC ID from the lookup URLs the wiki stores (fcc.io/R7F/A1, fcc.report/FCC-ID/X, fccid.io/X…). */
export function fccFromUrl(u: string): string | null {
  const m = clean(u).match(/^https?:\/\/([^/\s]+)(\/[^?#\s]*)?/i);
  if (!m) return null;
  const host = m[1], path = (m[2] ?? "").replace(/^\/(fcc-id\/)?/i, "");
  const id = (host.includes(".") ? path.replace(/\//g, "") : host).toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{4,}$/.test(id) ? id : null;
}

const pageUrl = (e: Record<string, any>) => {
  const dp = clean(e.devicepage);
  if (dp.startsWith("toh:")) return `https://openwrt.org/${dp.replace(/:/g, "/")}`;
  return `https://openwrt.org/toh/hwdata/${clean(e.deviceid).replace(/:/g, "/")}`;
};

const list = (v: unknown): string[] => (Array.isArray(v) ? v : v == null ? [] : [v]).map(clean).filter((x) => x && x !== "-");

export function fromToh(toh: { columns: string[]; entries: unknown[][] }, date = today()): { records: DeviceRecord[]; skipped: number } {
  const records: DeviceRecord[] = [];
  let skipped = 0;
  for (const row of toh.entries) {
    const e = Object.fromEntries(toh.columns.map((c, i) => [c, row[i]]));
    const category = tohCategory(e.devicetype);
    const vendor = clean(e.brand), base = clean(e.model);
    if (!isRelease(e.supportedcurrentrel) || category === null || !vendor || !base) { skipped++; continue; }
    const versions = list(e.version);
    const model = versions.length ? `${base} ${versions.join(" / ")}` : base;
    const chips = list(e.cpu).filter((c) => !/^(unknown|n\/a|\?)$/i.test(c));
    const fcc = list(e.fccid).map(fccFromUrl).filter((x): x is string => !!x);
    records.push({
      id: makeId(vendor, model),
      vendor,
      model,
      category,
      identifiers: { chips, fcc_id: fcc },
      status: "open-firmware",
      projects: [{ name: "OpenWrt", url: pageUrl(e), kind: "firmware", license: "GPL-2.0" }],
      provenance: { sources: ["openwrt"] },
      updated: date,
    });
  }
  return { records, skipped };
}

const source: Source = {
  source: "openwrt",
  name: "OpenWrt Table of Hardware",
  url: "https://openwrt.org/toh/start",
  license: "CC-BY-SA-4.0",
  async fetch() {
    const { records, skipped } = fromToh(await fetchJson(TOH_URL, { retries: 8 }));
    console.error(`openwrt: ${skipped} rows skipped (no current release, emulator or missing name)`);
    return records;
  },
};
export default source;
