// Betaflight flight controllers, from the board definitions the Betaflight App flashes from:
// github.com/betaflight/config, configs/<MANUFACTURER_ID>/<BOARD_NAME>/config.h (one per board),
// with `#define FC_TARGET_MCU`, `BOARD_NAME` and `MANUFACTURER_ID`. Manufacturer ids are
// resolved through the repository's Manufacturers.md table. Read with one shallow, blob-less,
// sparse git clone (about 600 small files).
//
// The model is the board's target name, exactly as the Betaflight App lists it ("MATEKH743").
// Betaflight is the board's firmware: status open-firmware.
// Left out on purpose: the CUST, FOSS, COMM and LEGA ids (homebrew, community and legacy
// targets), which name no manufacturer.
// Definitions and firmware are GPL-3.0-or-later.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeId, today, type DeviceRecord, type Freedom, type InstallRoute } from "@opendevicedb/core";
import { clean, type Source } from "../lib.ts";

const GIT = "https://github.com/betaflight/config.git";
const TREE = "https://github.com/betaflight/config/tree/master/configs";
const LICENSE = "GPL-3.0-or-later";
const NO_MAKER = new Set(["CUST", "FOSS", "COMM", "LEGA"]);

export interface BfBoard { manufacturer: string; board: string; mcu: string }

/** One config.h → its board, MCU and manufacturer id. */
export function parseConfig(text: string): BfBoard | null {
  const def = (name: string) => clean(text.match(new RegExp(`^\\s*#define\\s+${name}\\s+(\\S+)`, "m"))?.[1]);
  const board = def("BOARD_NAME"), manufacturer = def("MANUFACTURER_ID");
  return board && manufacturer ? { board, manufacturer, mcu: def("FC_TARGET_MCU") } : null;
}

// "CADDX TECHNOLOGY (SHENZHEN) Co., Ltd" → "CADDX": the city and company-form words are not
// part of the brand.
const PREFIX = /^(shenzhen|huizhou|guangzhou shi|zhuhai|dezhou)\s+/i;
const SUFFIX = /[\s,]+(co\.?,?\s*ltd\.?|co\.?,?\s*limited|ltd\.?|llc|inc\.?|pte\.?,?\s*ltd\.?|limited|gmbh|sl|corporation|corp\.?|technology|technologies|tech|science and|electronics?|electronic|innovations?|intelligent|smart|future|hobby|co\.?)$/i;
// Where the brand on the boards is not the company name (from the table's own notes and links).
const BRANDS: Record<string, string> = {
  SPBE: "SpeedyBee", JHEF: "JHEMCU", DYST: "DYS", TCMM: "TCMM", KLEE: "WhitenoiseFPV", RDMS: "RadioMaster",
  STMI: "STMicroelectronics", RASP: "Raspberry Pi", DIAT: "Diatone", SKST: "SKYSTARS", FLHB: "Flash Hobby", SPCM: "SPCMaker", NAMO: "Namimno",
};
export function makerName(name: string): string {
  let n = clean(name.replace(/\([^)]*\)/g, " "));
  for (let prev = ""; prev !== n; ) { prev = n; n = clean(n.replace(PREFIX, "").replace(SUFFIX, "")); }
  return n || clean(name);
}

/** Manufacturers.md table rows `|ID|Name|Contact|` → id → brand. */
export function parseManufacturers(md: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of md.matchAll(/^\|\s*([A-Z0-9]{4})\s*\|\s*([^|]+?)\s*\|/gm)) out.set(m[1], BRANDS[m[1]] ?? makerName(m[2]));
  return out;
}

export const BF_GUIDE = "https://betaflight.com/docs/wiki/getting-started/firmware-installation";
export const BF_APP = "https://app.betaflight.com/";

// Every MCU Betaflight runs on (STM32, AT32, APM32) is flashed through the DFU bootloader in its
// ROM, which is closed and cannot be replaced.
export const bfFreedom = (): Freedom => ({
  nonfree: ["bootloader"],
  cloud: "none",
  notes: "Betaflight is free; the microcontroller's ROM bootloader (DFU) it is flashed through is closed and stays.",
});

/** Install route (SPEC R1): flash from the Betaflight App over USB. */
export const bfInstall = (): InstallRoute => ({
  project: "Betaflight",
  method: "usb-bootloader",
  guide: BF_GUIDE,
  installer: BF_APP,
  difficulty: "easy",
  tools: ["Computer with the Betaflight App (Chromium-based browser) or Betaflight Configurator", "USB cable"],
  opens_device: false,
  brick_risk: "low",
  reversible: "yes",
  notes: "Most of these boards ship with Betaflight. Pick the board's target name in the App's firmware flasher; if it is not detected, hold the board's BOOT button while plugging USB in.",
});

export function fromBoard(b: BfBoard, makers: Map<string, string>, date = today()): DeviceRecord | null {
  if (NO_MAKER.has(b.manufacturer)) return null;
  const vendor = makers.get(b.manufacturer);
  if (!vendor) return null;
  return {
    id: makeId(vendor, b.board),
    vendor,
    model: b.board,
    category: "drone",
    identifiers: { chips: b.mcu ? [b.mcu] : [] },
    status: "open-firmware",
    projects: [{ name: `Betaflight ${b.board} target`, url: `${TREE}/${b.manufacturer}/${b.board}`, kind: "firmware", license: LICENSE, freedom: bfFreedom() }],
    install: [bfInstall()],
    provenance: { sources: ["betaflight"] },
    updated: date,
  };
}

function sparseClone(): string {
  const dir = mkdtempSync(join(tmpdir(), "odb-betaflight-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  try {
    git("clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout", GIT, ".");
    git("sparse-checkout", "set", "--no-cone", "/Manufacturers.md", "/configs/*/*/config.h");
    git("checkout", "-q");
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

const source: Source = {
  source: "betaflight",
  name: "Betaflight",
  url: "https://betaflight.com/",
  license: LICENSE,
  async fetch() {
    const dir = sparseClone();
    try {
      const makers = parseManufacturers(readFileSync(join(dir, "Manufacturers.md"), "utf8"));
      const boards: BfBoard[] = [];
      for (const m of readdirSync(join(dir, "configs"))) {
        for (const b of readdirSync(join(dir, "configs", m))) {
          const f = join(dir, "configs", m, b, "config.h");
          const parsed = existsSync(f) ? parseConfig(readFileSync(f, "utf8")) : null;
          // The folder names are authoritative (they are what the App lists).
          if (parsed) boards.push({ ...parsed, manufacturer: m, board: b });
        }
      }
      if (boards.length < 300) throw new Error(`betaflight: only ${boards.length} boards`);
      const out = boards.map((b) => fromBoard(b, makers)).filter((r): r is DeviceRecord => !!r);
      console.error(`betaflight: ${boards.length} boards, ${makers.size} manufacturer ids, ${boards.length - out.length} skipped (homebrew, community, legacy, unknown id)`);
      return out;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
export default source;
