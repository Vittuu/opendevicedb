// QMK keyboards, from the bulk export the QMK Configurator itself reads:
// https://keyboards.qmk.fm/v1/keyboards.json, generated from keyboards/**/keyboard.json (and
// info.json) in github.com/qmk/qmk_firmware. One entry per build target, keyed by its folder
// ("keychron/q1v2/ansi"), with keyboard_name, manufacturer, usb {vid, pid}, processor, bootloader.
//
// Revisions and layout variants of one keyboard ("…/ansi", "…/iso", "…/rev2") share a name and
// become one record: USB ids and chips are unioned and the project links to their common folder.
// QMK replaces (or is) the keyboard's firmware: status open-firmware.
//
// Left out on purpose:
//  - handwired/* (one-off builds, not products) and converter/* (adapters for other keyboards);
//  - USB ids that do not identify one keyboard: QMK's placeholder vendor 0xFEED, and any
//    vid:pid shared by keyboards of different names (hobby makers reuse ids).
// Data and firmware are GPL-2.0-or-later.
import { makeId, today, type DeviceRecord, type Freedom, type InstallRoute } from "@opendevicedb/core";
import { clean, fetchJson, type Source } from "../lib.ts";

const API = "https://keyboards.qmk.fm/v1/keyboards.json";
const TREE = "https://github.com/qmk/qmk_firmware/tree/master/keyboards";
const LICENSE = "GPL-2.0-or-later";

export interface QmkKeyboard {
  keyboard_name?: string;
  keyboard_folder: string;
  manufacturer?: string;
  usb?: { vid?: string; pid?: string };
  processor?: string;
  bootloader?: string;
}

const hex4 = (s: unknown) => {
  const m = clean(s).toLowerCase().match(/^0x([0-9a-f]{1,4})$/);
  return m ? m[1].padStart(4, "0") : null;
};
export const usbId = (k: QmkKeyboard) => {
  const vid = hex4(k.usb?.vid), pid = hex4(k.usb?.pid);
  return vid && pid && vid !== "feed" && vid !== "0000" ? `${vid}:${pid}` : null;
};

/** Vendor and model: the manufacturer, and the name without a repeated manufacturer prefix. */
export function qmkName(k: QmkKeyboard): { vendor: string; model: string } | null {
  const vendor = clean(k.manufacturer);
  let model = clean(k.keyboard_name);
  if (!vendor || !model || /^(qmk|unknown|none|n\/a)$/i.test(vendor)) return null;
  if (model.toLowerCase().startsWith(vendor.toLowerCase() + " ")) model = clean(model.slice(vendor.length));
  return { vendor, model };
}

// Bootloaders whose source is published (LUFA/QMK/Arduino/RP2040 boot ROM…) vs. closed ones in
// the microcontroller's ROM or flashed by its maker (Atmel/Microchip DFU, STM32 and WB32 system
// memory, PJRC HalfKay). Anything else: unknown, so `nonfree` is left out.
const OPEN_BOOT = new Set(["caterina", "qmk-dfu", "qmk-hid", "usbasploader", "bootloadhid", "uf2boot", "stm32duino", "rp2040", "tinyuf2", "kiibohd", "md-boot", "lufa-dfu", "lufa-ms"]);
const CLOSED_BOOT = new Set(["atmel-dfu", "stm32-dfu", "wb32-dfu", "halfkay", "gd32v-dfu", "apm32-dfu", "at32-dfu"]);

export function qmkFreedom(bootloaders: string[]): Freedom {
  const closed = bootloaders.filter((b) => CLOSED_BOOT.has(b));
  if (closed.length) return { nonfree: ["bootloader"], cloud: "none", notes: `QMK is free; the USB bootloader it is flashed through (${closed.join(", ")}) is closed and stays.` };
  if (bootloaders.length && bootloaders.every((b) => OPEN_BOOT.has(b))) return { nonfree: [], cloud: "none" };
  return { cloud: "none" };
}

export const QMK_FLASHING = "https://docs.qmk.fm/newbs_flashing";
export const QMK_TOOLBOX = "https://github.com/qmk/qmk_toolbox";

/** Install route (SPEC R1): flash a QMK build over USB once the keyboard is in bootloader mode. */
export const qmkInstall = (): InstallRoute => ({
  project: "QMK",
  method: "usb-bootloader",
  guide: QMK_FLASHING,
  installer: QMK_TOOLBOX,
  difficulty: "medium",
  tools: ["Computer with QMK Toolbox (or the qmk command line)", "USB cable"],
  opens_device: false,
  brick_risk: "low",
  reversible: "partial",
  notes: "Put the keyboard in bootloader mode (reset button or key combination, see its README), then flash a QMK build. Many of these keyboards ship with QMK already; a different original firmware may not be restorable.",
});

const commonFolder = (folders: string[]) => {
  const parts = folders.map((f) => f.split("/"));
  const out: string[] = [];
  for (let i = 0; parts.every((p) => i < p.length && p[i] === parts[0][i]); i++) out.push(parts[0][i]);
  return out.join("/");
};

/** All keyboards → one record per vendor+name. */
export function fromKeyboards(keyboards: QmkKeyboard[], date = today()): { records: DeviceRecord[]; skipped: number } {
  const usable = keyboards.filter((k) => !/^(handwired|converter)\//.test(k.keyboard_folder));
  // vid:pid → names using it; an id shared by different keyboards identifies none of them.
  const owners = new Map<string, Set<string>>();
  for (const k of usable) {
    const u = usbId(k), n = qmkName(k);
    if (u && n) owners.set(u, (owners.get(u) ?? new Set()).add(makeId(n.vendor, n.model)));
  }
  const groups = new Map<string, { vendor: string; model: string; ks: QmkKeyboard[] }>();
  let skipped = keyboards.length - usable.length;
  for (const k of usable) {
    const n = qmkName(k);
    if (!n) { skipped++; continue; }
    const id = makeId(n.vendor, n.model);
    const g = groups.get(id) ?? { ...n, ks: [] };
    g.ks.push(k);
    groups.set(id, g);
  }
  const records: DeviceRecord[] = [];
  for (const [id, g] of groups) {
    const usb = g.ks.map(usbId).filter((u): u is string => !!u && owners.get(u)!.size === 1);
    const folder = commonFolder(g.ks.map((k) => k.keyboard_folder)) || g.ks[0].keyboard_folder;
    const boots = [...new Set(g.ks.map((k) => clean(k.bootloader)).filter(Boolean))];
    records.push({
      id,
      vendor: g.vendor,
      model: g.model,
      category: "peripheral",
      identifiers: { usb, chips: g.ks.map((k) => clean(k.processor)) },
      status: "open-firmware",
      projects: [{ name: `QMK ${folder}`, url: `${TREE}/${folder}`, kind: "firmware", license: LICENSE, freedom: qmkFreedom(boots) }],
      install: [qmkInstall()],
      provenance: { sources: ["qmk"] },
      updated: date,
    });
  }
  return { records, skipped };
}

const source: Source = {
  source: "qmk",
  name: "QMK Firmware",
  url: "https://qmk.fm/",
  license: LICENSE,
  async fetch() {
    const data = await fetchJson<{ keyboards: Record<string, QmkKeyboard> }>(API);
    const keyboards = Object.entries(data.keyboards ?? {}).map(([folder, k]) => ({ ...k, keyboard_folder: k.keyboard_folder ?? folder }));
    if (keyboards.length < 1000) throw new Error(`qmk: only ${keyboards.length} keyboards`);
    const { records, skipped } = fromKeyboards(keyboards);
    console.error(`qmk: ${keyboards.length} build targets, ${skipped} skipped (handwired, converters, no maker), ${records.length} keyboards`);
    return records;
  },
};
export default source;
