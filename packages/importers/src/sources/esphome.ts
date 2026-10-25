// ESPHome Devices (devices.esphome.io), one src/docs/devices/<name>/index.md per device
// in github.com/esphome/esphome-devices, with YAML frontmatter (title, type, board…).
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, frontmatter, githubFiles, githubRaw, espWifiFreedom, mapLimit, splitTitle, type Source } from "../lib.ts";

const REPO = "esphome/esphome-devices", BRANCH = "main";
const DEVICE_FILE = /^src\/docs\/devices\/([^/]+)\/index\.mdx?$/;

/** frontmatter `type` → category; unknown values fall back to "other". */
export const ESPHOME_CATEGORIES: Record<string, string> = {
  plug: "smart-plug",
  light: "light",
  switch: "switch",
  relay: "switch",
  dimmer: "switch",
  sensor: "sensor",
  misc: "other",
};

export const esphomeCategory = (t: unknown) => ESPHOME_CATEGORIES[clean(t).toLowerCase()] ?? "other";

/** frontmatter `board` (ESPHome platform) → chip family. */
export const ESPHOME_BOARDS: Record<string, string> = {
  esp8266: "ESP8266",
  esp32: "ESP32",
  bk72xx: "BK72xx",
  rtl87xx: "RTL87xx",
  ln882x: "LN882x",
  rp2040: "RP2040",
  nrf52: "nRF52",
};

/** `board` may list several platforms ("esp32, RP2040"). */
export const esphomeChips = (b: unknown): string[] =>
  clean(b).toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).map((k) => ESPHOME_BOARDS[k] ?? k.toUpperCase());

/** URL slug of devices.esphome.io (github-slugger on the directory name). */
export const esphomeSlug = (dir: string) => dir.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");

// ---------- install routes (SPEC R1) ----------

const WEB_INSTALLER = "https://web.esphome.io/";
export const MAINS_WARNING = "Mains-powered: unplug before opening; for experienced users only.";

/**
 * frontmatter `difficulty` (devices.esphome.io labels): 1 "Comes with ESPhome",
 * 2 "Plug-n-flash", 3 "Disassembly required", 4 "Soldering required",
 * 5 "Chip needs replacement". Absent or unreadable → undefined.
 */
export function esphomeDifficulty(v: unknown): number | undefined {
  const t = clean(v).toLowerCase();
  if (!t) return undefined;
  if (/^[1-5]$/.test(t)) return Number(t);
  return ({ "comes with esphome": 1, "plug-n-flash": 2, "disassembly required": 3, "soldering required": 4, "chip needs replacement": 5 } as Record<string, number>)[t];
}

/** Page types of boards and gadgets (not wired appliances) that plug-n-flash over USB. */
const BOARD_TYPES = new Set(["misc", "sensor"]);

const truthy = (v: unknown) => v === true || clean(v).toLowerCase() === "true";

/** Mains devices: plugs, wall switches, dimmers, and lights whose title says bulb/lamp/fitting. */
const MAINS_TYPES = new Set(["plug", "switch", "dimmer"]);
const MAINS_TITLE = /\b(bulbs?|lamps?|downlights?|ceiling|gu10|e2[67]|e1[24]|b22|plugs?|sockets?|outlets?|power ?strips?|wall switch(es)?|dimmers?)\b/i;
export const esphomeMains = (type: unknown, title: string) => MAINS_TYPES.has(clean(type).toLowerCase()) || MAINS_TITLE.test(title);

/**
 * How ESPHome gets on the device, from the page's `made-for-esphome` and `difficulty` (and,
 * for "Plug-n-flash" pages, whether the page flashes over the air with tuya-cloudcutter or
 * tuya-convert).
 * The web installer (ESP Web Tools) only flashes ESP8266/ESP32 chips. Devices that must be
 * opened and run on mains get the warning and no installer link (the site shows a plain link).
 */
export function esphomeInstall(fm: Record<string, any>, guide: string, chips: string[], title: string, body = ""): InstallRoute[] {
  const base = { project: "ESPHome", guide };
  const level = esphomeDifficulty(fm.difficulty ?? fm.Difficulty);
  if (truthy(fm["made-for-esphome"] ?? fm["Made-for-esphome"] ?? fm["made-for-esp-home"]) || level === 1) {
    return [{ ...base, method: "other", difficulty: "easy", brick_risk: "none",
      notes: "Ships with ESPHome: adopt it in the ESPHome dashboard or Home Assistant; nothing to flash." }];
  }
  const esp = chips.length > 0 && chips.every((c) => /^ESP(8266|32)/.test(c));
  const installer = esp ? { installer: WEB_INSTALLER } : {};
  const libretiny = chips.some((c) => /^(BK72|RTL87|LN882)/.test(c));
  const nonEsp = libretiny ? ["Beken/Realtek/Lightning chip: the ESPHome web installer does not flash it; use ltchiptool (LibreTiny)."] : [];
  if (level === 2) {
    // "Plug-n-flash" = no disassembly: over the air for Tuya and Shelly devices, USB for boards
    if (/cloudcutter/i.test(body)) {
      return [{ ...base, method: "ota-exploit", installer: "https://github.com/tuya-cloudcutter/tuya-cloudcutter", difficulty: "medium",
        tools: ["Linux computer with Wi-Fi (e.g. Raspberry Pi)"], opens_device: false, brick_risk: "low", reversible: "partial",
        firmware_constraints: "tuya-cloudcutter only works on the Tuya firmware versions it lists as vulnerable; newer devices must be opened and flashed over serial." }];
    }
    if (/tuya-convert/i.test(body) && esp) {
      return [{ ...base, method: "ota-exploit", installer: "https://github.com/ct-Open-Source/tuya-convert", difficulty: "medium",
        tools: ["Linux computer with Wi-Fi (e.g. Raspberry Pi)"], opens_device: false, brick_risk: "low", reversible: "partial",
        firmware_constraints: "tuya-convert only works on Tuya firmware released before its 2020 patch; patched devices must be opened and flashed over serial." }];
    }
    if (BOARD_TYPES.has(clean(fm.type).toLowerCase()) && !esphomeMains(fm.type, title) && esp) {
      return [{ ...base, method: "web-serial", installer: WEB_INSTALLER, difficulty: "medium", tools: ["USB cable"], opens_device: false,
        brick_risk: "low", reversible: "partial" }];
    }
    // RP2040 boards take a UF2 file over their USB bootloader
    if (BOARD_TYPES.has(clean(fm.type).toLowerCase()) && chips.length && chips.every((c) => c === "RP2040")) {
      return [{ ...base, method: "usb-bootloader", difficulty: "medium", tools: ["USB cable"], opens_device: false, brick_risk: "low", reversible: "partial" }];
    }
    return [{ ...base, method: "other", difficulty: "medium", opens_device: false, brick_risk: "low", reversible: "partial",
      notes: ["No disassembly needed (over the air or through an exposed port): follow the steps on the device page.", ...nonEsp].join(" ") }];
  }
  const mains = esphomeMains(fm.type, title);
  const opened = {
    ...base, difficulty: "hard" as const, opens_device: true, ...(mains ? { mains_powered: true } : {}),
    brick_risk: "low" as const, reversible: "partial" as const,
  };
  const notes = (...n: string[]) => {
    const all = [...(mains ? [MAINS_WARNING] : []), ...n, ...nonEsp];
    return all.length ? { notes: all.join(" ") } : {};
  };
  if (level === 5) {
    return [{ ...opened, method: "other", brick_risk: "medium", tools: ["Soldering iron", "Replacement ESP module"],
      ...notes("The original chip must be desoldered and replaced with a supported module before flashing.") }];
  }
  return [{
    ...opened, method: "serial", ...(mains ? {} : installer),
    tools: ["USB-serial adapter, 3.3 V", ...(level === 4 ? ["Soldering iron"] : [])],
    ...notes(),
  }];
}

/** SPEC "Freedom": the closed Wi-Fi blob is only known for Espressif chips (not BK72xx, RTL87xx, RP2040…). */
const isEsp = (chips: string[]) => chips.length > 0 && chips.every((c) => /^ESP/.test(c));

export function fromDevice(path: string, text: string, date = today()): DeviceRecord | null {
  const dir = path.match(DEVICE_FILE)?.[1];
  const fm = frontmatter(text);
  if (!dir || !fm || !clean(fm.title)) return null;
  const { vendor, model, aliases } = splitTitle(fm.title, fm.model ?? fm.Model);
  if (!vendor || !model) return null;
  const url = `https://devices.esphome.io/devices/${encodeURIComponent(esphomeSlug(dir))}/`;
  const chips = esphomeChips(fm.board);
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases,
    category: esphomeCategory(fm.type),
    identifiers: { chips },
    status: "open-firmware",
    projects: [{ name: "ESPHome", url, kind: "firmware", ...(isEsp(chips) ? { freedom: espWifiFreedom() } : {}) }],
    install: esphomeInstall(fm, url, chips, clean(fm.title), text),
    provenance: { sources: ["esphome"] },
    updated: date,
  };
}

const source: Source = {
  source: "esphome",
  name: "ESPHome Devices",
  url: "https://devices.esphome.io/",
  license: "GPL-3.0",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => DEVICE_FILE.test(p));
    const out = await mapLimit(files, 16, async (p) => fromDevice(p, await githubRaw(REPO, BRANCH, p)));
    const ok = out.filter((r): r is DeviceRecord => !!r);
    console.error(`esphome: ${files.length} device pages, ${files.length - ok.length} without usable frontmatter`);
    return ok;
  },
};
export default source;
