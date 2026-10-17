// Klipper 3D-printer firmware: github.com/Klipper3d/klipper/config/ ships one config per
// supported printer, printer-<vendor>-<model>-<year>.cfg, whose header comment names the
// printer and the micro-controller to compile for; generic-<board>.cfg files are controller
// boards (BigTreeTech SKR, Duet…) and kit-<name>.cfg printer kits. File names squash model
// names ("ender3pro"), so models come from a table checked against the headers; unknown
// future files fall back to the file name. Year variants of one printer are merged (the years
// become aliases). Controller boards are recorded as category "other" (they are MCU boards,
// not single-board computers) when their maker is known; open designs built by many vendors
// (RAMPS, RUMBA, Melzi…) are skipped.
//
// printerVendor() and canonModel() are shared with the Marlin importer so that the same
// printer gets the same id from both sources.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "Klipper3d/klipper", BRANCH = "master";
const CONFIG = /^config\/((printer|generic|kit)-(.+?))\.cfg$/;

// ---------- names shared with marlin.ts ----------

const VENDORS: Record<string, string> = {
  adimlab: "ADIMLab", alfawise: "Alfawise", anet: "Anet", anycubic: "Anycubic", artillery: "Artillery",
  biqu: "BIQU", bq: "BQ", creality: "Creality", elegoo: "Elegoo", eryone: "Eryone", flashforge: "FlashForge",
  flsun: "FLSUN", fokoos: "Fokoos", geeetech: "Geeetech", hiprecy: "Hiprecy", kingroon: "Kingroon",
  longer: "Longer", longer3d: "Longer", lulzbot: "LulzBot", makergear: "MakerGear", micromake: "Micromake",
  modix: "Modix", monoprice: "Monoprice", mtw: "MTW", prusa: "Prusa", prusaresearch: "Prusa", ratrig: "RatRig",
  robo3d: "Robo3D", seemecnc: "SeeMeCNC", sovol: "Sovol", sunlu: "Sunlu", tevo: "Tevo", tronxy: "Tronxy",
  twotrees: "Two Trees", velleman: "Velleman", voxelab: "Voxelab", wanhao: "Wanhao", voron: "Voron Design",
  vorondesign: "Voron Design", zav3d: "ZAV3D", bigtreetech: "BigTreeTech", btt: "BigTreeTech", fysetc: "FYSETC",
  mks: "MKS", makerbase: "MKS", mellow: "Mellow", ldo: "LDO Motors", th3d: "TH3D", duet3d: "Duet3D",
  ultimachine: "UltiMachine", ultimaker: "Ultimaker", makerbot: "MakerBot", printrbot: "Printrbot",
  panucatt: "Panucatt", jgaurora: "JGAurora", flyingbear: "FlyingBear", qidi: "QIDI", malyan: "Malyan",
  zonestar: "Zonestar", weedo: "Weedo", e3d: "E3D", bibo: "BIBO", ctc: "CTC", felix: "Felix", folgertech: "FolgerTech",
  formbot: "Formbot", copymaster3d: "Copymaster3D", dagoma: "Dagoma", labists: "Labists", renkforce: "Renkforce",
  tinkerine: "Tinkerine", turnigy: "Turnigy", wasp: "WASP", mbot: "MBot", makerfarm: "MakerFarm",
  intamsys: "Intamsys", infitary: "Infitary", hictop: "Hictop", easythreed: "EasyThreeD", eazao: "Eazao",
  raiscube: "Raiscube", simax: "Simax", weistek: "Weistek", gcreate: "gCreate", rolohaun: "Rolohaun",
  opulo: "Opulo", dreammaker: "Dreammaker", "3dfabxyz": "3DFabXYZ", "3dmatik": "3DMatik", daycom: "Daycom",
  rapidelite: "RapideLite", reprappro: "RepRapPro", makertech3d: "MakerTech3D", mz3d: "MZ3D",
};

/** Vendor display name, one spelling for all sources ("AnyCubic", "anycubic" → "Anycubic"). */
export function printerVendor(raw: string): string {
  const key = clean(raw).toLowerCase().replace(/[^a-z0-9]/g, "");
  return VENDORS[key] ?? clean(raw);
}

/** Vendor-specific model spelling: Creality "Ender 3"/"ender3" → "Ender-3", "CR10" → "CR-10"; Sovol "SV-06" → "SV06". */
export function canonModel(vendor: string, model: string): string {
  let m = clean(model);
  if (vendor === "Creality") m = m.replace(/^(ender|cr)[\s-]?(\d+)/i, (_, a: string, n: string) => `${a.toLowerCase() === "cr" ? "CR" : "Ender"}-${n}`);
  if (vendor === "Sovol") m = m.replace(/^sv[\s-]?(\d+)/i, "SV$1");
  return m;
}

// ---------- printers ----------

interface Named { model: string; aliases?: string[] }
const P = (model: string, ...aliases: string[]): Named => ({ model, aliases });

// file stem without "printer-" and the year (or with the year when one year differs) → printers
const PRINTERS: Record<string, Named[]> = {
  "adimlab": [P("Gantry", "ADIMLab 3D printer (2018)")], // 310x310x400 build volume
  "alfawise-u30": [P("U30")],
  "anet-a4": [P("A4")], "anet-a8": [P("A8")], "anet-a8-2019": [P("A8 Plus")], "anet-e10": [P("E10")], "anet-e16": [P("E16")],
  "anycubic-4max": [P("4Max")], "anycubic-4maxpro-2.0": [P("4Max Pro 2.0")], "anycubic-i3-mega": [P("i3 Mega", "i3 Mega Ultrabase")],
  "anycubic-kobra-go": [P("Kobra Go")], "anycubic-kobra-plus": [P("Kobra Plus")], "anycubic-kossel": [P("Kossel")],
  "anycubic-kossel-plus": [P("Kossel Linear Plus", "Kossel Pulley Plus")], "anycubic-vyper": [P("Vyper")],
  "artillery-genius-pro": [P("Genius Pro")], "artillery-sidewinder-x2": [P("Sidewinder X2")],
  "artillery-sidewinder-x3-plus": [P("Sidewinder X3 Plus"), P("Sidewinder X3 Pro")],
  "biqu-b1-se-plus": [P("B1 SE Plus")], "biqu-bx": [P("BX")],
  "bq-hephestos": [P("Hephestos", "Prusa i3 Hephestos")],
  "creality-cr10": [P("CR-10")], "creality-cr10-smart-pro": [P("CR-10 Smart Pro")], "creality-cr10-v3": [P("CR-10 V3")],
  "creality-cr10mini": [P("CR-10 Mini")], "creality-cr10s": [P("CR-10S")], "creality-cr10s-pro-v2": [P("CR-10S Pro V2")],
  "creality-cr20": [P("CR-20")], "creality-cr20-pro": [P("CR-20 Pro")], "creality-cr30": [P("CR-30", "CR-30 PrintMill")],
  "creality-cr5pro-ht": [P("CR-5 Pro HT")], "creality-cr6se": [P("CR-6 SE")],
  "creality-ender2": [P("Ender-2")], "creality-ender2pro": [P("Ender-2 Pro")], "creality-ender2pro-hc32": [P("Ender-2 Pro", "Ender-2 Pro (HC32F460 board)")],
  "creality-ender3": [P("Ender-3")], "creality-ender3-s1": [P("Ender-3 S1"), P("Ender-3 S1 Pro")],
  "creality-ender3-s1plus": [P("Ender-3 S1 Plus")], "creality-ender3-v2": [P("Ender-3 V2")], "creality-ender3-v2-neo": [P("Ender-3 V2 Neo")],
  "creality-ender3max": [P("Ender-3 Max")], "creality-ender3pro": [P("Ender-3 Pro")],
  "creality-ender5": [P("Ender-5")], "creality-ender5-s1": [P("Ender-5 S1")], "creality-ender5plus": [P("Ender-5 Plus")],
  "creality-ender5pro": [P("Ender-5 Pro")], "creality-ender6": [P("Ender-6")],
  "creality-sermoonD1": [P("Sermoon D1")], "creality-sermoonV1": [P("Sermoon V1")],
  "elegoo-neptune2": [P("Neptune 2")], "elegoo-neptune3-pro": [P("Neptune 3 Pro")],
  "eryone-er20": [P("ER-20")], "eryone-thinker-series-v2": [P("Thinker V2", "Thinker Series V2")],
  "flashforge-creator-pro": [P("Creator Pro")],
  "flsun-q5": [P("Q5")], "flsun-qqs": [P("QQ-S")],
  "fokoos-odin5-f3": [P("Odin-5 F3")],
  "geeetech-301": [P("Rostock 301", "301")],
  "geeetech-A10T-A20T": ["A10", "A10M", "A10T", "A20", "A20M", "A20T"].map((m) => P(m)),
  "hiprecy-leo": [P("Leo")],
  "kingroon-kp3s": [P("KP3S")],
  "longer-lk4-pro": [P("LK4 Pro")], "longer-lk4x": [P("LK4 X")],
  "lulzbot-mini1": [P("Mini", "Mini 1")], "lulzbot-mini2": [P("Mini 2")], "lulzbot-taz6": [P("TAZ 6")], "lulzbot-taz6-dual-v3": [P("TAZ 6", "TAZ 6 Dual v3")],
  "makergear-m2": [P("M2")],
  "micromake-d1": [P("D1")],
  "modix-big60": [P("Big60")],
  "monoprice-mini-delta": [P("Mini Delta")], "monoprice-select-mini-v1": [P("Select Mini V1")], "monoprice-select-mini-v2": [P("Select Mini V2")],
  "mtw-create": [P("Create")],
  "prusa-mini-plus": [P("MINI+", "Original Prusa MINI+")],
  "ratrig-v-minion": [P("V-Minion")],
  "robo3d-r2": [P("R2")],
  "seemecnc-rostock-max-v2": [P("Rostock Max V2")],
  "sovol-sv01": [P("SV01")], "sovol-sv05": [P("SV05")], "sovol-sv06": [P("SV06")], "sovol-sv06-plus": [P("SV06 Plus")],
  "sunlu-s8": [P("S8")], "sunlu-t3": [P("T3", "Terminator T3")],
  "tevo-flash": [P("Flash")], "tevo-tarantula-pro": [P("Tarantula Pro")],
  "tronxy-crux1": [P("Crux1")], "tronxy-p802e": [P("P802E")], "tronxy-p802m": [P("P802M")], "tronxy-x5s": [P("X5S")],
  "tronxy-x5sa-pro": [P("X5SA Pro")], "tronxy-x5sa-v6": [P("X5SA", "X5SA (CXY-V6 board)")], "tronxy-x8": [P("X8")], "tronxy-xy-2-Pro": [P("XY-2 Pro")],
  "twotrees-sapphire-plus-sp-5-v1": [P("Sapphire Plus", "Sapphire Plus V1 (SP-5)")],
  "twotrees-sapphire-plus-sp-5-v1.1": [P("Sapphire Plus", "Sapphire Plus V1.1 (SP-5)")],
  "twotrees-sapphire-pro-sp-3": [P("Sapphire Pro", "SP-3")],
  "velleman-k8200": [P("K8200", "3Drag")], "velleman-k8800": [P("K8800")],
  "voxelab-aquila": [P("Aquila")],
  "wanhao-duplicator-6": [P("Duplicator 6", "Monoprice Ultimate")], "wanhao-duplicator-9": [P("Duplicator 9", "Duplicator 9 MK1", "Monoprice Maker Pro MK1")],
  "wanhao-duplicator-i3-mini": [P("Duplicator i3 Mini")], "wanhao-duplicator-i3-plus": [P("Duplicator i3 Plus")],
  "wanhao-duplicator-i3-plus-mark2": [P("Duplicator i3 Plus Mark II")],
  "wanhao-duplicator-i3-v2.1": [P("Duplicator i3 v2.1", "Monoprice Maker Select", "Cocoon Create")],
  // kits
  "voron2-250mm": [P("Voron 2", "VORON2 250mm")],
  "zav3d": [P("MAX", "ZAV3D MAX")],
};
const KIT_VENDORS: Record<string, string> = { "voron2-250mm": "Voron Design", zav3d: "ZAV3D" };

// controller boards: stem without "generic-" → [vendor, model]; anything else is skipped
const BOARDS: Record<string, [string, string]> = {
  "alligator-r2": ["Alligator", "Alligator Board R2"], "alligator-r3": ["Alligator", "Alligator Board R3"],
  "archim2": ["UltiMachine", "Archim2"], "azteeg-x5-mini-v3": ["Panucatt", "Azteeg X5 Mini V3"],
  "creality-v4.2.10": ["Creality", "Board V4.2.10"], "creality-v4.2.7": ["Creality", "Board V4.2.7"],
  "duet2": ["Duet3D", "Duet 2"], "duet2-duex": ["Duet3D", "Duet 2"], "duet2-maestro": ["Duet3D", "Duet 2 Maestro"],
  "duet3-6hc": ["Duet3D", "Duet 3 6HC"], "duet3-6xd": ["Duet3D", "Duet 3 6XD"], "duet3-mini": ["Duet3D", "Duet 3 Mini 5+"],
  "einsy-rambo": ["UltiMachine", "Einsy Rambo"], "rambo": ["UltiMachine", "RAMBo"], "mini-rambo": ["UltiMachine", "Mini-RAMBo"],
  "flyboard": ["Mellow", "FLYF407ZG"], "gt2560": ["Geeetech", "GT2560"], "ldo-leviathan-v1.2": ["LDO Motors", "Leviathan V1.2"],
  "mellow-super-infinty-hv": ["Mellow", "Super8 HV"], "mightyboard": ["MakerBot", "MightyBoard"],
  "minitronics1": ["RepRapWorld", "Minitronics V1.0"], "printrboard": ["Printrbot", "Printrboard"], "printrboard-g2": ["Printrbot", "Printrboard G2"],
  "prusa-buddy": ["Prusa", "Buddy"], "re-arm": ["Panucatt", "Re-ARM"], "replicape": ["Intelligent Agent", "Replicape Rev B3"],
  "smoothieboard": ["Smoothieware", "Smoothieboard"], "ultimaker-ultimainboard-v2": ["Ultimaker", "UltiMainboard V2"],
  "th3d-ezboard-lite-v1.2": ["TH3D", "EZBoard Lite V1.2"], "th3d-ezboard-v2.0": ["TH3D", "EZBoard V2.0"],
  "mks-sgenl": ["MKS", "SGen L"], "mks-rumba32-v1.0": ["MKS", "Rumba32 V1.0"], "mks-robin-nano-v1": ["MKS", "Robin Nano V1"],
};
// boards whose model is the rest of the file name: "<vendor>-<model words>"
const BOARD_VENDORS = ["bigtreetech", "fysetc", "mks", "mellow", "th3d"];
const SMALL_WORDS = new Set(["max", "pro", "lite", "fly"]);

/** "skr-mini-e3-v3.0" → "SKR Mini E3 V3.0", "manta-m8p-v1.1" → "Manta M8P V1.1". */
export function prettyBoard(stem: string): string {
  return stem.split("-").map((t) => {
    if (/^v\d/i.test(t)) return "V" + t.slice(1);
    const letters = t.replace(/[^a-z]/gi, "").length;
    if ((/\d/.test(t) && letters <= 3) || (t.length <= 3 && !SMALL_WORDS.has(t))) return t.toUpperCase();
    return t[0].toUpperCase() + t.slice(1);
  }).join(" ");
}

/** Micro-controllers the header comment (before the first [section]) says to compile for ("AVR atmega2560", "STM32F103"…). */
export function headerChips(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const end = lines.findIndex((l) => l.startsWith("["));
  const head = lines.slice(0, end < 0 ? 40 : end).filter((l) => l.startsWith("#")).join(" ");
  const out = new Set<string>();
  for (const m of head.matchAll(/\b(atmega\d+\w?|at90usb\d+|stm32[fghl]\d{3}\w*|gd32f\d+\w*|hc32f\d+|lpc17\d\d|sam[34][a-z]\d+\w*|same\d+\w*|rp2040)\b/gi)) {
    const c = m[1];
    out.add(/^atmega/i.test(c) ? "ATmega" + c.slice(6).toUpperCase() : c.toUpperCase());
  }
  return [...out];
}

export interface Parsed { vendor: string; models: Named[]; year?: string; kind: "printer" | "kit" }

/** Vendor, model(s) and year of a config file name, or null when it is not a device we record. */
export function parseConfigName(path: string): Parsed | null {
  const m = path.match(CONFIG);
  if (!m) return null;
  if (m[2] === "generic") return null; // boards: parseBoardName
  const kind = m[2] as Parsed["kind"];
  const rest = m[3];
  const year = rest.match(/-((?:19|20)\d\d)$/)?.[1];
  const stem = year ? rest.slice(0, -5) : rest;
  if (kind === "kit") {
    const named = PRINTERS[stem];
    return named && KIT_VENDORS[stem] ? { vendor: KIT_VENDORS[stem], models: named, year, kind } : null;
  }
  const vendorKey = stem.split("-")[0];
  const vendor = printerVendor(VENDORS[vendorKey.toLowerCase()] ?? vendorKey[0].toUpperCase() + vendorKey.slice(1));
  const named = PRINTERS[`${stem}-${year}`] ?? PRINTERS[stem];
  if (named) return { vendor, models: named.map((n) => ({ ...n, model: canonModel(vendor, n.model) })), year, kind };
  // not in the table (a newer file): model words from the file name
  const model = stem.split("-").slice(1).map((t) => (/\d/.test(t) ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1))).join(" ");
  return model ? { vendor, models: [{ model: canonModel(vendor, model) }], year, kind } : null;
}

/** Controller board from a generic-<board>.cfg name, or null for open designs and unknown makers. */
export function parseBoardName(path: string): { vendor: string; model: string } | null {
  const m = path.match(CONFIG);
  if (!m || m[2] !== "generic") return null;
  const stem = m[3];
  if (BOARDS[stem]) return { vendor: BOARDS[stem][0], model: BOARDS[stem][1] };
  const [v, ...rest] = stem.split("-");
  if (!BOARD_VENDORS.includes(v.toLowerCase()) || !rest.length) return null;
  return { vendor: printerVendor(v), model: prettyBoard(rest.join("-")) };
}

export function fromConfig(path: string, text: string, date = today()): DeviceRecord[] {
  const file = path.split("/").pop()!;
  const project = { name: `Klipper (${file})`, url: `https://github.com/${REPO}/blob/${BRANCH}/${path}`, kind: "firmware", license: "GPL-3.0" };
  const chips = headerChips(text);
  const mcu = chips.length ? ` (MCU: ${chips.join(", ")})` : "";
  const base = { identifiers: { chips }, status: "open-firmware" as const, projects: [project], provenance: { sources: ["klipper"] }, updated: date };
  const board = parseBoardName(path);
  if (board) {
    return [{
      id: makeId(board.vendor, board.model), vendor: board.vendor, model: board.model, category: "other",
      summary: `3D-printer controller board. Klipper ships a pin mapping for it (config/${file}); its micro-controller runs the Klipper firmware${mcu}.`,
      ...base,
    }];
  }
  const p = parseConfigName(path);
  if (!p) return [];
  return p.models.map((n) => ({
    id: makeId(p.vendor, n.model), vendor: p.vendor, model: n.model,
    aliases: [...(n.aliases ?? []), ...(p.year ? [`${n.model} (${p.year})`] : [])],
    category: "3d-printer",
    summary: `Klipper ships a config for this printer (config/${file}); its controller board is flashed with the Klipper firmware${mcu}.`,
    ...base,
  }));
}

const source: Source = {
  source: "klipper",
  name: "Klipper",
  url: "https://www.klipper3d.org/",
  license: "GPL-3.0",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => CONFIG.test(p));
    const out = await mapLimit(files, 16, async (p) => fromConfig(p, await githubRaw(REPO, BRANCH, p)));
    const skipped = files.filter((_, i) => !out[i].length).map((p) => p.split("/").pop());
    console.error(`klipper: ${files.length} configs, skipped ${skipped.length}: ${skipped.join(" ")}`);
    return out.flat();
  },
};
export default source;
