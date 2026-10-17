// Marlin 3D-printer firmware example configurations: github.com/MarlinFirmware/Configurations,
// config/examples/<Vendor>/<Model>[/<board or option>…]/Configuration.h (delta printers live
// under config/examples/delta/<Vendor>/<Model>). Only the directory tree is read: one record
// per vendor/model directory, deeper directories (replacement boards, probes, UI variants)
// are merged into it. Directories that are boards, generic designs or not 3D printers
// (FoamCutter, SCARA, Polargraph…) and single-level directories without a vendor are skipped.
// Vendor and model spellings go through the Klipper importer's printerVendor()/canonModel()
// so that the same printer gets the same id from both sources.
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, githubFiles, type Source } from "../lib.ts";
import { printerVendor, canonModel } from "./klipper.ts";

const REPO = "MarlinFirmware/Configurations", BRANCH = "bugfix-2.1.x";
const EXAMPLES = "config/examples/";

// top-level directories that are not printer makers (boards, machine types, tools)
const SKIP_VENDORS = new Set([
  "ArmEd", "Azteeg", "CNC", "FoamCutter", "FYSETC", "Mks", "Nextion", "Opulo", "Polargraph", "RepRapWorld",
  "SCARA", "Simulator", "STM32", "TPARA", "UltiMachine", "linear_axes", "AliExpress", "EXP3D", "MKS", "generic",
]);
// vendor/model directories that are boards or options, not printers
const SKIP_MODELS = new Set(["Printrbot/PrintrboardG2", "Geeetech/GT2560", "FLSUN/auto_calibrate"]);
// directories that hold vendor and model in one name, or model names to align with Klipper's
const SPECIAL: Record<string, { vendor: string; model: string; alias?: string }> = {
  "Malyan M300": { vendor: "Malyan", model: "M300" },
  "Tevo Little Monster": { vendor: "Tevo", model: "Little Monster" },
  "Hatchbox_Alpha": { vendor: "Hatchbox", model: "Alpha" },
  "Micromake-D1": { vendor: "Micromake", model: "D1" },
  "Anet/A8plus": { vendor: "Anet", model: "A8 Plus" },
  "Anet/A2plus": { vendor: "Anet", model: "A2 Plus" },
  "AnyCubic/KobraMax": { vendor: "Anycubic", model: "Kobra Max" },
  "FlashForge/CreatorPro": { vendor: "FlashForge", model: "Creator Pro" },
  "MakerGear/M2 Rev H": { vendor: "MakerGear", model: "M2", alias: "M2 Rev H" },
  "Wanhao/Duplicator i3 2.1": { vendor: "Wanhao", model: "Duplicator i3 v2.1" },
  "Tronxy/XY2-Pro": { vendor: "Tronxy", model: "XY-2 Pro" },
  "Creality/CR-30 PrintMill": { vendor: "Creality", model: "CR-30", alias: "CR-30 PrintMill" },
  "FLSUN/Q5-nano_v1": { vendor: "FLSUN", model: "Q5", alias: "Q5 (MKS Robin Nano v1)" },
  "FLSUN/Q5-nano_v2": { vendor: "FLSUN", model: "Q5", alias: "Q5 (MKS Robin Nano v2)" },
  "FLSUN/QQS-Pro": { vendor: "FLSUN", model: "QQ-S Pro" },
  "Prusa/MK3S-BigTreeTech-BTT002": { vendor: "Prusa", model: "MK3S", alias: "MK3S (BigTreeTech BTT002 board)" },
  "Two Trees/SP-5_V3": { vendor: "Two Trees", model: "Sapphire Plus", alias: "Sapphire Plus V3 (SP-5)" },
  "Velleman/K8200 Upgraded": { vendor: "Velleman", model: "K8200", alias: "K8200 Upgraded" },
  "ORD Bot/Hadron": { vendor: "ORD Solutions", model: "ORD Bot Hadron" },
  "FlyingBear/FlyingBearGhost_v3": { vendor: "FlyingBear", model: "Ghost v3" },
  "Alfawise/U20-bltouch": { vendor: "Alfawise", model: "U20", alias: "U20 (BLTouch)" },
  "FLSUN/kossel": { vendor: "FLSUN", model: "Kossel" },
  "FLSUN/kossel_mini": { vendor: "FLSUN", model: "Kossel Mini" },
  "LulzBot/TAZ4": { vendor: "LulzBot", model: "TAZ 4" },
};

/** Vendor directory, model directory and the printer they name, or null for non-printers. */
export function parseExampleDir(path: string): { dir: string; vendor: string; model: string; aliases: string[] } | null {
  if (!path.startsWith(EXAMPLES)) return null;
  const segs = path.slice(EXAMPLES.length).split("/");
  if (segs[segs.length - 1] === "Configuration.h") segs.pop();
  const delta = segs[0] === "delta";
  const s = delta ? segs.slice(1) : segs;
  const prefix = delta ? "delta/" : "";
  // one-name directories ("delta/Malyan M300", "delta/Micromake-D1/<board>")
  if (s.length >= 1 && SPECIAL[s[0]]) {
    const sp = SPECIAL[s[0]];
    return { dir: `${prefix}${s[0]}`, vendor: sp.vendor, model: sp.model, aliases: sp.alias ? [sp.alias] : [] };
  }
  if (s.length < 2 || SKIP_VENDORS.has(s[0]) || SKIP_MODELS.has(`${s[0]}/${s[1]}`)) return null;
  const dir = `${prefix}${s[0]}/${s[1]}`;
  const sp = SPECIAL[`${s[0]}/${s[1]}`];
  if (sp) return { dir, vendor: printerVendor(sp.vendor), model: canonModel(printerVendor(sp.vendor), sp.model), aliases: sp.alias ? [sp.alias] : [] };
  if (delta && /^kossel/i.test(s[0])) return null; // generic RepRap kossel designs
  const vendor = printerVendor(s[0]);
  let model = clean(s[1].replace(/_/g, " "));
  // "Ultimaker/Ultimaker Original (1.5.7)" → "Original (1.5.7)", but "Ultimaker 2" stays
  const rest = model.slice(s[0].length).trim();
  if (model.toLowerCase().startsWith(s[0].toLowerCase() + " ") && /[a-z]/i.test(rest)) model = rest;
  model = canonModel(vendor, model);
  return model ? { dir, vendor, model, aliases: [] } : null;
}

/**
 * Install route (SPEC R1). Only the directory tree is read, so the board is unknown: the
 * route says SD card (how most 32-bit printer boards take firmware.bin) and the notes give
 * the 8-bit exceptions.
 */
export const MARLIN_INSTALL: InstallRoute = {
  project: "Marlin",
  method: "sd-card",
  guide: "https://marlinfw.org/docs/basics/install.html",
  difficulty: "medium",
  tools: ["Computer to build Marlin with the example configuration (PlatformIO), unless a pre-built binary exists", "microSD card or USB cable"],
  brick_risk: "low",
  reversible: "partial",
  notes: "Most 32-bit boards install firmware.bin from the SD card; 8-bit boards are flashed over USB, and some ship without a bootloader (then an ISP programmer is needed). Going back needs the vendor's stock firmware file, when the vendor publishes it.",
};

export function fromPaths(paths: string[], date = today()): DeviceRecord[] {
  const out = new Map<string, DeviceRecord>();
  for (const p of paths) {
    if (!p.endsWith("/Configuration.h")) continue;
    const e = parseExampleDir(p);
    if (!e) continue;
    const id = makeId(e.vendor, e.model);
    const url = `https://github.com/${REPO}/tree/${BRANCH}/${EXAMPLES}${e.dir}`.replace(/ /g, "%20");
    const prev = out.get(`${id} ${url}`);
    if (prev) { prev.aliases = [...new Set([...(prev.aliases ?? []), ...e.aliases])]; continue; }
    out.set(`${id} ${url}`, {
      id, vendor: e.vendor, model: e.model, aliases: e.aliases, category: "3d-printer", status: "open-firmware",
      summary: `Marlin ships an example configuration for this printer (config/examples/${e.dir}); building Marlin with it replaces the printer's firmware.`,
      projects: [{ name: "Marlin (example configuration)", url, kind: "firmware", license: "GPL-3.0" }],
      install: [{ ...MARLIN_INSTALL, tools: [...MARLIN_INSTALL.tools!] }],
      provenance: { sources: ["marlin"] },
      updated: date,
    });
  }
  return [...out.values()];
}

const source: Source = {
  source: "marlin",
  name: "Marlin example configurations",
  url: "https://marlinfw.org/",
  license: "GPL-3.0",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => p.startsWith(EXAMPLES) && p.endsWith("/Configuration.h"));
    const out = fromPaths(files);
    const skipped = [...new Set(files.filter((p) => !parseExampleDir(p)).map((p) => p.slice(EXAMPLES.length).split("/").slice(0, 2).join("/")))];
    console.error(`marlin: ${files.length} example configurations → ${out.length} records; skipped ${skipped.join(", ")}`);
    return out;
  },
};
export default source;
