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
//
// Install routes (SPEC R1): the players Rockbox Utility handles come from its own target list,
// utils/rbutilqt/rbutil.ini ([platforms] + one section per target with bootloadermethod and
// manualname); the guide is the Installation chapter of the target's daily manual on
// download.rockbox.org, checked at import time.
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, fetchText, githubRaw, mapLimit, type Source } from "../lib.ts";

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

// ---------- install route ----------

export const RBUTIL = "https://www.rockbox.org/wiki/RockboxUtility";
export const MANUALS = "https://www.rockbox.org/manual.shtml";
export const manualInstallUrl = (manual: string) => `https://download.rockbox.org/daily/manual/rockbox-${manual}/rockbox-buildch2.html`;

/** What Rockbox Utility knows about a build key (all its variant sections merged). */
export interface UtilityTarget { methods: string[]; manual: string }

/**
 * rbutil.ini → build key → Rockbox Utility target. Sections are "<key>[.<variant>]"; only
 * those listed in [platforms] and not status=disabled are shown by the utility.
 */
export function parseRbutil(ini: string): Map<string, UtilityTarget> {
  const sections = new Map<string, Record<string, string>>();
  let cur: Record<string, string> | null = null;
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.replace(/^\s*;.*$/, "").trim();
    const h = line.match(/^\[([^\]]+)\]$/);
    if (h) { cur = {}; sections.set(h[1], cur); continue; }
    const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kv && cur) cur[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1");
  }
  const out = new Map<string, UtilityTarget>();
  for (const name of Object.values(sections.get("platforms") ?? {})) {
    const sec = sections.get(name);
    if (!sec || sec.status === "disabled") continue;
    const key = name.split(".")[0];
    const t = out.get(key) ?? { methods: [], manual: "" };
    if (sec.bootloadermethod && !t.methods.includes(sec.bootloadermethod)) t.methods.push(sec.bootloadermethod);
    if (!t.manual) t.manual = clean(sec.manualname) || key;
    out.set(key, t);
  }
  return out;
}

/** Bootloader methods whose installer asks for the player's original firmware file (they define ofHint()). */
const NEEDS_OF = new Set(["ams", "bspatch", "hex", "chinachip", "tcc", "imx", "mpio"]);

/**
 * Route for a port. Unusable ports get none. With Rockbox Utility (a desktop installer that
 * puts the bootloader and Rockbox on the player over its USB cable, no opening): easy, low
 * risk, and the utility uninstalls it again (the manual's Installation chapter covers that).
 * Other ports: manual installation from the manual, medium, nothing more is known.
 * `manuals` holds the targets whose daily manual chapter exists; without it the general
 * manual page is the guide.
 */
export function rockboxInstall(b: Build, utility?: UtilityTarget, manuals?: Set<string>): InstallRoute | null {
  if (b.status === 1) return null;
  const manual = utility?.manual || b.key;
  const chapter = manuals?.has(manual) ? manualInstallUrl(manual) : undefined;
  if (utility) {
    const of = utility.methods.some((m) => NEEDS_OF.has(m)) ? " Rockbox Utility asks for a copy of the player's original firmware file." : "";
    const none = utility.methods.length > 0 && utility.methods.every((m) => m === "none") ? " Rockbox Utility installs no bootloader for this player: follow the manual for that step if it needs one." : "";
    return {
      project: "Rockbox", method: "other", guide: chapter ?? RBUTIL, installer: RBUTIL, difficulty: "easy",
      tools: ["Computer with Rockbox Utility", "The player's USB cable"], opens_device: false, brick_risk: "low", reversible: "yes",
      ...(chapter ? { revert: chapter } : {}),
      notes: `On most players the original firmware stays available next to Rockbox.${of}${none}`,
    };
  }
  return {
    project: "Rockbox", method: "other", guide: chapter ?? MANUALS, difficulty: "medium",
    notes: b.status === 0
      ? `Retired port${b.release ? ` (last release ${b.release})` : ""}: not in Rockbox Utility, installed by hand as its manual describes.`
      : "Not in Rockbox Utility: installed by hand as the manual describes.",
  };
}

export function fromBuild(b: Build, cpu: string | null, hasConfig: boolean, date = today(), install?: InstallRoute | null): DeviceRecord | null {
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
    ...(install ? { install: [install] } : {}),
    provenance: { sources: ["rockbox"] },
    updated: date,
  };
}

/** Manual names whose daily Installation chapter is online (some daily manuals fail to build). */
async function existingManuals(names: string[]): Promise<Set<string>> {
  const listing = await fetchText("https://download.rockbox.org/daily/manual/").catch(() => "");
  const listed = names.filter((n) => listing.includes(`rockbox-${n}/`));
  const ok = await mapLimit(listed, 8, async (n) => {
    try { return (await fetch(manualInstallUrl(n), { method: "HEAD" })).ok ? n : null; } catch { return null; }
  });
  return new Set(ok.filter((n): n is string => !!n));
}

const source: Source = {
  source: "rockbox",
  name: "Rockbox",
  url: "https://www.rockbox.org/",
  license: LICENSE,
  async fetch() {
    const builds = parseBuilds(await githubRaw(REPO, BRANCH, "tools/builds.pm"));
    const date = today();
    const utility = await githubRaw(REPO, BRANCH, "utils/rbutilqt/rbutil.ini").then(parseRbutil).catch((e) => {
      console.error(`rockbox: rbutil.ini unreadable, no Rockbox Utility routes: ${e}`);
      return new Map<string, UtilityTarget>();
    });
    const manuals = await existingManuals([...new Set(builds.map((b) => utility.get(b.key)?.manual || b.key))]);
    const out = await mapLimit(builds, 8, async (b) => {
      let header: string | null = null;
      try { header = await githubRaw(REPO, BRANCH, `firmware/export/config/${b.key}.h`); } catch { /* removed target */ }
      return fromBuild(b, header ? configCpu(header) : null, !!header, date, rockboxInstall(b, utility.get(b.key), manuals));
    });
    const ok = out.filter((r): r is DeviceRecord => !!r);
    console.error(`rockbox: ${builds.length} targets, ${builds.length - ok.length} skipped (generic dev targets)`);
    return ok;
  },
};
export default source;
