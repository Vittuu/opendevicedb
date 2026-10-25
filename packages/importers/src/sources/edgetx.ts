// EdgeTX radio transmitters, from fw.json in github.com/EdgeTX/edgetx: the list of radios
// ("RadioMaster Boxer", build prefix "boxer-") that EdgeTX Buddy offers firmware for. The list
// is read at the main branch and at the latest release of the two newest minor versions, so
// radios dropped from new releases (still served by the older one) and radios only in nightly
// builds are kept, each with a note saying which firmware to use.
//
// EdgeTX is the radio's firmware: status open-firmware.
// fw.json and EdgeTX are GPL-2.0.
import { makeId, today, type DeviceRecord, type Freedom, type InstallRoute } from "@opendevicedb/core";
import { clean, fetchJson, type Source } from "../lib.ts";

const REPO = "EdgeTX/edgetx";
const LICENSE = "GPL-2.0";
const fwUrl = (ref: string) => `https://raw.githubusercontent.com/${REPO}/${ref}/fw.json`;

/** "RadioMaster TX16S / TX16S Mark II" → vendor, model and other names. */
export function radioName(name: string): { vendor: string; model: string; aliases: string[] } | null {
  const [vendor, ...rest] = clean(name).split(" ");
  const names = rest.join(" ").split(" / ").map(clean).filter(Boolean);
  return vendor && names.length ? { vendor, model: names[0], aliases: names.slice(1) } : null;
}

export const EDGETX_GUIDE = "https://manual.edgetx.org/installing-and-updating-edgetx";
export const EDGETX_BUDDY = "https://buddy.edgetx.org/";

export const edgetxFreedom = (): Freedom => ({
  nonfree: ["bootloader"],
  cloud: "none",
  notes: "EdgeTX is free and brings its own bootloader; the STM32 ROM bootloader used for USB flashing is closed and stays. An internal RF module runs its own firmware, free only when it is ExpressLRS or the DIY Multiprotocol module.",
});

/** Install route (SPEC R1): EdgeTX Buddy flashes over USB; the radio's bootloader can also flash from the SD card. */
export const edgetxInstall = (constraint?: string): InstallRoute => ({
  project: "EdgeTX",
  method: "usb-bootloader",
  guide: EDGETX_GUIDE,
  installer: EDGETX_BUDDY,
  difficulty: "medium",
  tools: ["Computer with EdgeTX Buddy (web or desktop)", "USB cable", "SD card with the matching EdgeTX SD-card content"],
  opens_device: false,
  brick_risk: "low",
  reversible: "yes",
  ...(constraint ? { firmware_constraints: constraint } : {}),
  notes: "Back up the SD card and models first. Many of these radios ship with EdgeTX; updates use the same tool, or the radio's own bootloader with the firmware file on the SD card.",
});

/**
 * Radio lists per ref, newest first: main, then the latest release of each minor version.
 * A radio missing from main says the last release that supports it; one in main only is a
 * nightly-only radio.
 */
export function fromTargets(lists: { ref: string; label: string; targets: [string, string][] }[], date = today()): DeviceRecord[] {
  const seen = new Map<string, { name: string; prefix: string; refs: string[] }>();
  for (const l of lists) {
    for (const [name, prefix] of l.targets) {
      const key = clean(prefix).replace(/-$/, "");
      const e = seen.get(key) ?? { name, prefix: key, refs: [] };
      e.refs.push(l.label);
      seen.set(key, e);
    }
  }
  const [main, ...releases] = lists.map((l) => l.label);
  const out: DeviceRecord[] = [];
  for (const e of seen.values()) {
    const n = radioName(e.name);
    if (!n) continue;
    const released = releases.filter((r) => e.refs.includes(r));
    const constraint = !e.refs.includes(main) ? `Not in EdgeTX development builds after ${released[0]}: use the latest ${released[0]} release.`
      : !released.length ? "Only in EdgeTX nightly builds so far (not yet in a release)."
      : undefined;
    out.push({
      id: makeId(n.vendor, n.model),
      vendor: n.vendor,
      model: n.model,
      aliases: n.aliases,
      category: "radio",
      status: "open-firmware",
      projects: [{ name: `EdgeTX (${e.prefix} build)`, url: `https://github.com/${REPO}`, kind: "firmware", license: LICENSE, freedom: edgetxFreedom() }],
      install: [edgetxInstall(constraint)],
      provenance: { sources: ["edgetx"] },
      updated: date,
    });
  }
  return out;
}

/** Latest stable release tag of each of the `n` newest minor versions, newest first. */
export function latestMinors(tags: string[], n = 2): { tag: string; minor: string }[] {
  const best = new Map<string, number[]>();
  for (const t of tags) {
    const m = t.match(/^v(\d+)\.(\d+)\.(\d+)$/);
    if (!m) continue;
    const v = m.slice(1).map(Number), minor = `${v[0]}.${v[1]}`;
    if (!best.has(minor) || best.get(minor)![2] < v[2]) best.set(minor, v);
  }
  return [...best.entries()]
    .sort(([, a], [, b]) => b[0] - a[0] || b[1] - a[1])
    .slice(0, n)
    .map(([minor, v]) => ({ tag: `v${v.join(".")}`, minor }));
}

const source: Source = {
  source: "edgetx",
  name: "EdgeTX",
  url: "https://edgetx.org/",
  license: LICENSE,
  async fetch() {
    const releases = await fetchJson<{ tag_name: string; prerelease: boolean; draft: boolean }[]>(`https://api.github.com/repos/${REPO}/releases?per_page=100`);
    const minors = latestMinors(releases.filter((r) => !r.prerelease && !r.draft).map((r) => r.tag_name));
    const lists = [];
    for (const { ref, label } of [{ ref: "main", label: "main" }, ...minors.map((m) => ({ ref: m.tag, label: m.minor }))]) {
      lists.push({ ref, label, targets: (await fetchJson<{ targets: [string, string][] }>(fwUrl(ref))).targets ?? [] });
    }
    if (lists[0].targets.length < 20) throw new Error(`edgetx: only ${lists[0].targets.length} radios on main`);
    const out = fromTargets(lists);
    console.error(`edgetx: ${out.length} radios (main + ${minors.map((m) => m.tag).join(", ")})`);
    return out;
  },
};
export default source;
