// ESPHome Devices (devices.esphome.io), one src/docs/devices/<name>/index.md per device
// in github.com/esphome/esphome-devices, with YAML frontmatter (title, type, board…).
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, frontmatter, githubFiles, githubRaw, mapLimit, splitTitle, type Source } from "../lib.ts";

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

export function fromDevice(path: string, text: string, date = today()): DeviceRecord | null {
  const dir = path.match(DEVICE_FILE)?.[1];
  const fm = frontmatter(text);
  if (!dir || !fm || !clean(fm.title)) return null;
  const { vendor, model, aliases } = splitTitle(fm.title, fm.model ?? fm.Model);
  if (!vendor || !model) return null;
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases,
    category: esphomeCategory(fm.type),
    identifiers: { chips: esphomeChips(fm.board) },
    status: "open-firmware",
    projects: [{ name: "ESPHome", url: `https://devices.esphome.io/devices/${encodeURIComponent(esphomeSlug(dir))}/`, kind: "firmware" }],
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
