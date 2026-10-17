// Rockbox ports, from the target table the rockbox.org infrastructure itself reads:
// tools/builds.pm in the Rockbox git tree (GitHub mirror github.com/Rockbox/rockbox), a Perl
// hash `%builds = ( 'modelname' => { name => 'Full Name', status => 0..3, … }, … );`
// with status 0 = retired, 1 = unusable, 2 = unstable, 3 = stable.
// The SoC comes from `#define CONFIG_CPU …` in firmware/export/config/<modelname>.h (absent for
// "hosted" ports that run on the player's stock Linux, and for long-removed Archos targets).
//
// Status: stable, unstable and retired ports (retired = last shipped in an old release, still
// downloadable) are open-firmware. "Unusable" ports boot in development builds but are not fit
// for use: the hardware is partly reverse engineered, so partial-protocol, not open-firmware.
// Hosted/native ports of one player (e.g. "FiiO M3K" and "FiiO M3K (Linux)") merge into one
// record keeping the furthest status. The generic rk27xx development target is not a device.
//
// USB ids in the config headers are not imported: they are what Rockbox reports, and several
// are generic (Linux gadget 0525:a4a5, Rockchip 071b:3202) rather than the stock device's.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "Rockbox/rockbox", BRANCH = "master";
const LICENSE = "GPL-2.0-or-later";

export interface Build { key: string; name: string; status: number; release?: string }

/** Entries of the %builds hash in tools/builds.pm (comments ignored). */
export function parseBuilds(text: string): Build[] {
  const start = text.search(/^%builds\s*=\s*\(/m);
  if (start < 0) throw new Error("rockbox: %builds not found");
  const end = text.indexOf("\n);", start);
  const body = text
    .slice(start, end < 0 ? undefined : end)
    .split("\n")
    .map((l) => l.replace(/#.*$/, "")) // Perl comments; names never contain '#'
    .join("\n");
  const out: Build[] = [];
  const entry = /'([a-z0-9_]+)'\s*=>\s*\{([^}]*)\}/g;
  for (let m; (m = entry.exec(body)); ) {
    const field = (k: string) => m![2].match(new RegExp(`\\b${k}\\s*=>\\s*(?:'([^']*)'|"([^"]*)"|(\\d+))`))?.slice(1).find((x) => x !== undefined);
    const name = clean(field("name")), status = Number(field("status"));
    if (!name || !Number.isInteger(status)) continue;
    const release = field("release");
    out.push({ key: m[1], name, status, ...(release ? { release } : {}) });
  }
  return out;
}

/** CONFIG_CPU of a target config header ("AS3525v2", "PP5022", "X1000"…), or null. */
export function configCpu(header: string): string | null {
  return header.match(/^\s*#define\s+CONFIG_CPU\s+([A-Za-z0-9_]+)/m)?.[1] ?? null;
}

// Display name → vendor. Product lines named without their maker, and two-word makers.
const PREFIX_VENDORS: [RegExp, string][] = [
  [/^iPod\b/, "Apple"],
  [/^iAudio\b/, "Cowon"],
];
const MULTIWORD = ["HiFi E.T", "Packard Bell"];
const VENDORS: Record<string, string> = { aigo: "Aigo", hiby: "HiBy", agptek: "Agptek", xuelin: "Xuelin" };

/** Port variant ("(Hosted)", "(native)", "(Linux)") of the same player, stripped from the model. */
const VARIANT = /\s*\((hosted|native|linux)\)\s*$/i;

export function splitName(name: string): { vendor: string; model: string; variant: string | null } {
  let n = clean(name);
  const variant = n.match(VARIANT)?.[1]?.toLowerCase() ?? null;
  n = clean(n.replace(VARIANT, ""));
  for (const [re, vendor] of PREFIX_VENDORS) if (re.test(n)) return { vendor, model: n, variant };
  const multi = MULTIWORD.find((v) => n.toLowerCase().startsWith(v.toLowerCase() + " "));
  const cut = multi ? multi.length : Math.max(0, n.indexOf(" "));
  const first = n.slice(0, cut), model = clean(n.slice(cut));
  return { vendor: VENDORS[first.toLowerCase()] ?? first, model, variant };
}

const STATUS_LABEL: Record<number, string> = { 0: "retired", 1: "unusable", 2: "unstable", 3: "stable" };

export function fromBuild(b: Build, cpu: string | null, hasConfig: boolean, date = today()): DeviceRecord | null {
  if (/generic/.test(b.key) || !(b.status in STATUS_LABEL)) return null;
  const { vendor, model, variant } = splitName(b.name);
  if (!vendor || !model) return null;
  const label = `${STATUS_LABEL[b.status]} port` + (b.status === 0 && b.release ? `, last release ${b.release}` : "");
  const url = hasConfig
    ? `https://github.com/${REPO}/blob/${BRANCH}/firmware/export/config/${b.key}.h`
    : `https://github.com/${REPO}/blob/${BRANCH}/tools/builds.pm`;
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    category: /^anbernic$/i.test(vendor) ? "game-console" : "media-player", // RG Nano is a handheld console
    identifiers: { chips: cpu ? [cpu] : [] },
    status: b.status === 1 ? "partial-protocol" : "open-firmware",
    projects: [{ name: `Rockbox ${b.key} (${variant ? `${variant}, ` : ""}${label})`, url, kind: "firmware", license: LICENSE }],
    provenance: { sources: ["rockbox"] },
    updated: date,
  };
}

const source: Source = {
  source: "rockbox",
  name: "Rockbox",
  url: "https://www.rockbox.org/",
  license: LICENSE,
  async fetch() {
    const builds = parseBuilds(await githubRaw(REPO, BRANCH, "tools/builds.pm"));
    const date = today();
    const out = await mapLimit(builds, 8, async (b) => {
      let header: string | null = null;
      try { header = await githubRaw(REPO, BRANCH, `firmware/export/config/${b.key}.h`); } catch { /* removed target */ }
      return fromBuild(b, header ? configCpu(header) : null, !!header, date);
    });
    const ok = out.filter((r): r is DeviceRecord => !!r);
    console.error(`rockbox: ${builds.length} targets, ${builds.length - ok.length} skipped (generic dev targets)`);
    return ok;
  },
};
export default source;
