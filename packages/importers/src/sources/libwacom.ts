// Pen tablets and pen displays, from libwacom's device descriptions: data/*.tablet in
// github.com/linuxwacom/libwacom, the files GNOME, KDE and libinput read to configure a tablet.
// Each is an INI file: [Device] Name, ModelName, DeviceMatch=bus|vid|pid[|name];…, IntegratedIn.
// A tablet listed there works on Linux: the kernel drives it (wacom for Wacom; hid-uclogic,
// reverse engineered by the DIGImend project, or generic HID for Huion, XP-Pen, GAOMON, UGEE…)
// and libwacom describes its buttons, rings and styli. Status controllable.
//
// Left out on purpose: digitizers built into laptops and tablets (IntegratedIn contains System)
// — they are parts of another device — and Bluetooth/I2C ids (the schema's `usb` holds USB ids).
// The vendor is the name's own prefix when it has one, else the file name's ("gaomon-a5h.tablet").
// libwacom data is under an HPND-style permissive licence (COPYING).
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, deviceFirmwareFreedom, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "linuxwacom/libwacom", BRANCH = "master";
const LICENSE = "HPND-sell-variant";

/** [Device] keys of a .tablet file. */
export function parseTablet(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*#.*$/, "").trim();
    const h = line.match(/^\[([^\]]+)\]$/);
    if (h) { section = h[1]; continue; }
    const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kv && section === "Device") out[kv[1]] = kv[2];
  }
  return out;
}

export function usbIds(match: string): string[] {
  return match.split(";").map((m) => m.split("|")).filter((p) => p[0] === "usb" && /^[0-9a-f]{4}$/i.test(p[1] ?? "") && /^[0-9a-f]{4}$/i.test(p[2] ?? ""))
    .map((p) => `${p[1].toLowerCase()}:${p[2].toLowerCase()}`);
}

// Name prefixes → vendor (longest first), and file-name prefixes → vendor.
const NAME_VENDORS: [RegExp, string][] = [
  [/^Hanvon Ugee Technology Co\.,\s*Ltd\s+/i, "XP-Pen"],
  [/^Wacom\s+/i, "Wacom"], [/^Huion\s+/i, "Huion"], [/^XP-Pen\s+/i, "XP-Pen"], [/^GAOMON\s+/i, "GAOMON"],
  [/^Lenovo\s+/i, "Lenovo"], [/^Dell\s+/i, "Dell"], [/^Microsoft\s+/i, "Microsoft"], [/^Samsung\s+/i, "Samsung"],
  [/^UGEE\s+/i, "UGEE"], [/^LetSketch\s+/i, "LetSketch"], [/^Waltop\s+/i, "Waltop"], [/^VEIKK\s+/i, "VEIKK"],
];
const FILE_VENDORS: Record<string, string> = {
  wacom: "Wacom", huion: "Huion", "xp-pen": "XP-Pen", gaomon: "GAOMON", ugee: "UGEE", dell: "Dell", lenovo: "Lenovo",
  letsketch: "LetSketch", waltop: "Waltop", veikk: "VEIKK", elan: "ELAN", microsoft: "Microsoft", samsung: "Samsung",
  "n-trig": "N-Trig", acer: "Acer", asus: "ASUS", hp: "HP", xencelabs: "Xencelabs", trust: "Trust", genius: "Genius",
};

export function tabletName(name: string, modelName: string, file: string): { vendor: string; model: string } | null {
  let n = clean(name), vendor = "";
  for (const [re, v] of NAME_VENDORS) if (re.test(n)) { vendor = v; n = clean(n.replace(re, "")); break; }
  if (!vendor) {
    const base = file.replace(/^.*\//, "");
    const key = base.startsWith("xp-pen-") ? "xp-pen" : base.startsWith("n-trig-") ? "n-trig" : base.split("-")[0];
    vendor = FILE_VENDORS[key] ?? "";
  }
  // "LetSketch LetSketch", "HUION KAMVAS…": drop a repeated vendor word.
  if (n.toLowerCase().startsWith(vendor.toLowerCase() + " ")) n = clean(n.slice(vendor.length));
  const m = clean(modelName);
  if (m && !n.toLowerCase().includes(m.toLowerCase())) n = `${n} (${m})`;
  return vendor && n ? { vendor, model: n } : null;
}

export const LINUXWACOM = "https://linuxwacom.github.io/";

export const tabletInstall = (): InstallRoute => ({
  project: "Linux tablet support",
  method: "host-software",
  guide: LINUXWACOM,
  difficulty: "easy",
  brick_risk: "none",
  reversible: "yes",
  notes: "Nothing is flashed: plug the tablet into a Linux computer. The kernel drives it and desktops (GNOME, KDE) set up its buttons from libwacom.",
});

export function fromTablet(file: string, d: Record<string, string>, date = today()): DeviceRecord | null {
  if (/System/i.test(d.IntegratedIn ?? "")) return null;
  const name = tabletName(d.Name ?? "", d.ModelName ?? "", file);
  if (!name) return null;
  const usb = usbIds(d.DeviceMatch ?? "");
  const display = /Display/i.test(d.IntegratedIn ?? "");
  const wacom = name.vendor === "Wacom";
  return {
    id: makeId(name.vendor, name.model),
    vendor: name.vendor,
    model: name.model,
    category: "peripheral",
    identifiers: { usb },
    status: "controllable",
    interfaces: [{
      name: display ? "Pen display input" : "Pen tablet input",
      transport: usb.length ? "usb" : /bluetooth/.test(d.DeviceMatch ?? "") ? "bluetooth" : "other",
      status: "documented",
      notes: wacom ? "Linux kernel wacom driver; buttons and styli described by libwacom" : "Linux kernel hid-uclogic or generic HID driver; buttons and styli described by libwacom",
    }],
    projects: [{ name: `libwacom ${file.replace(/^.*\//, "")}`, url: `https://github.com/${REPO}/blob/${BRANCH}/${file}`, kind: "library", license: LICENSE, freedom: deviceFirmwareFreedom() }],
    install: [tabletInstall()],
    provenance: { sources: ["libwacom"] },
    updated: date,
  };
}

const source: Source = {
  source: "libwacom",
  name: "libwacom",
  url: "https://github.com/linuxwacom/libwacom",
  license: LICENSE,
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => /^data\/[^/]+\.tablet$/.test(p));
    if (files.length < 300) throw new Error(`libwacom: only ${files.length} tablet files`);
    const date = today();
    const out = await mapLimit(files, 8, async (f) => fromTablet(f, parseTablet(await githubRaw(REPO, BRANCH, f)), date));
    const ok = out.filter((r): r is DeviceRecord => !!r);
    console.error(`libwacom: ${files.length} tablet files, ${files.length - ok.length} skipped (built-in digitizers, unknown maker)`);
    return ok;
  },
};
export default source;
