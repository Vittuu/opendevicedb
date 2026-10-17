// libgphoto2 supported cameras, from the model tables compiled into its camera drivers
// ("camlibs") in github.com/gphoto/libgphoto2:
//   camlibs/ptp2/library.c   models[]        {"Vendor:Model", usb vendor, usb product, flags}
//   camlibs/canon/canon.c    models[]        {"Canon:Model", class, usb vendor, usb product, capture, …}
//   camlibs/sierra/sierra.c  sierra_cameras[] {"Vendor", "Model", sierra model, usb vendor, usb product, …}
// These are the three big, regular tables. Smaller camlibs (sq905, mars, digigr8, jl2005c…)
// list white-label webcams/toy cameras sharing one chipset id under free-text names with no
// vendor field, so they are left out rather than guessed.
//
// Left out on purpose:
//  - mtp_models[] (#include "music-players.h", ~2000 entries copied from libmtp): MTP media
//    players and phones handled only as generic file stores over the standard MTP protocol.
//  - Apple iPhone/iPad/iPod touch and the few phones in the PTP table: they only expose their
//    camera roll over standard PTP; listing them would read as "this phone was reverse engineered".
//
// Status is taken from what the driver can do with the camera: remote capture/configuration
// (ptp2 flag PTP_CAP, canon CAP_SUP, every sierra camera) → controllable; file download only
// → partial-protocol.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, githubRaw, type Source } from "../lib.ts";

const REPO = "gphoto/libgphoto2", BRANCH = "master";
const LICENSE = "LGPL-2.1-or-later";

// ---------- minimal C table reader ----------

/** Remove C comments, keeping string literals intact (a "//" in a string is not a comment). */
export function stripComments(src: string): string {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? src.length : end + 2;
    } else if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      i = end < 0 ? src.length : end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Drop lines inside `#if 0` blocks (with their `#else` branch kept); other conditionals stay. */
export function stripIfZero(src: string): string {
  const stack: boolean[] = []; // true = this frame is an `#if 0` frame currently disabled
  const kinds: boolean[] = []; // true = frame opened by `#if 0`
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const d = line.match(/^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)$/);
    if (d) {
      const [, kw, rest] = d;
      if (kw.startsWith("if")) {
        const zero = kw === "if" && /^\s*0\s*$/.test(rest);
        stack.push(zero);
        kinds.push(zero);
      } else if ((kw === "else" || kw === "elif") && kinds.length && kinds[kinds.length - 1]) {
        stack[stack.length - 1] = !stack[stack.length - 1];
      } else if (kw === "endif") {
        stack.pop();
        kinds.pop();
      }
      continue;
    }
    if (!stack.some(Boolean)) out.push(line);
  }
  return out.join("\n");
}

/** Body (between the outer braces) of the array initialiser `name[] = { … }`, or null. */
export function arrayBody(src: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*\\[\\s*\\]\\s*=\\s*\\{`).exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1, inStr = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(start, i);
  }
  return null;
}

/** Fields of each `{ … }` initialiser at the top level of an array body. */
export function initialisers(body: string): string[][] {
  const rows: string[][] = [];
  let depth = 0, inStr = false, field = "", fields: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      field += c;
      if (c === "\\") field += body[++i] ?? "";
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; if (depth) field += c; continue; }
    if (c === "{") { if (depth++ === 0) { fields = []; field = ""; continue; } }
    else if (c === "}") { if (--depth === 0) { fields.push(clean(field)); rows.push(fields); continue; } }
    else if (c === "," && depth === 1) { fields.push(clean(field)); field = ""; continue; }
    if (depth) field += c;
  }
  return rows;
}

const cString = (f: string | undefined): string | null => {
  const m = clean(f).match(/^"((?:[^"\\]|\\.)*)"$/);
  return m ? m[1].replace(/\\(.)/g, "$1") : null;
};

/** 0x04A9 / 1234 → number; 0, NO_USB or anything symbolic → null. */
export function usbNumber(f: string | undefined): number | null {
  const s = clean(f);
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 0xffff ? n : null;
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

// ---------- names, categories ----------

const VENDORS: Record<string, string> = {
  fuji: "Fujifilm",
  fujifilm: "Fujifilm",
  "konica-minolta": "Konica Minolta",
  topdon: "Topdon",
  kodak: "Kodak",
  nikon: "Nikon",
  canon: "Canon",
  sony: "Sony",
  olympus: "Olympus",
  panasonic: "Panasonic",
  pentax: "Pentax",
  ricoh: "Ricoh",
  leica: "Leica",
  casio: "Casio",
  samsung: "Samsung",
  gopro: "GoPro",
};

export function normaliseVendor(v: string): string {
  const s = clean(v);
  return VENDORS[s.toLowerCase()] ?? s;
}

/** Connection-mode suffixes name a USB personality of the same camera, not another model. */
const MODE_SUFFIX = /\s*\((?:[^()]*\b(?:mode|ptp|mtp|control|pictbridge|alternate id|2nd)\b[^()]*)\)\s*$/i;

export function normaliseModel(vendor: string, model: string): string {
  let m = clean(model);
  for (let prev = ""; prev !== m; ) { prev = m; m = clean(m.replace(MODE_SUFFIX, "")); }
  // "Fuji:Fujifilm X-S10" → "X-S10"
  const v = vendor.toLowerCase();
  if (m.toLowerCase().startsWith(v + " ")) m = m.slice(v.length + 1);
  return clean(m);
}

/** Category, or null for entries that are not cameras reverse engineered as such. */
export function gphotoCategory(vendor: string, model: string): string | null {
  const v = vendor.toLowerCase(), m = model.toLowerCase();
  if (v === "apple" && /iphone|ipad|ipod/.test(m)) return null; // iOS camera roll over plain PTP
  if (v === "nokia") return null;                               // phones
  if (v === "samsung" && /^(s\d{4}|gt-|sgh-|sm-)/.test(m)) return null;
  if (v === "gopro" || /keymission/.test(m)) return "action-camera";
  if (/\bdvr\b|recorder/.test(m)) return "other";
  return "camera";
}

const placeholder = (model: string) => !model || /\.\.\.|\bunknown\b/i.test(model);

// ---------- records ----------

export interface CamEntry { vendor: string; model: string; usb: [number, number] | null; capture: boolean }

const CAMLIBS = {
  ptp2: { path: "camlibs/ptp2/library.c", project: "libgphoto2 ptp2 driver", iface: "PTP/USB with vendor extensions" },
  canon: { path: "camlibs/canon/canon.c", project: "libgphoto2 canon driver", iface: "Canon PowerShot protocol (USB/serial)" },
  sierra: { path: "camlibs/sierra/sierra.c", project: "libgphoto2 sierra driver", iface: "Sierra Imaging protocol (serial/USB)" },
} as const;
export type Camlib = keyof typeof CAMLIBS;

export function fromEntry(camlib: Camlib, e: CamEntry, date = today()): DeviceRecord | null {
  const vendor = normaliseVendor(e.vendor);
  const model = normaliseModel(vendor, e.model);
  if (!vendor || placeholder(model)) return null;
  const category = gphotoCategory(vendor, model);
  if (!category) return null;
  const lib = CAMLIBS[camlib];
  const transport = camlib === "ptp2" || e.usb ? "usb" : "other";
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    category,
    identifiers: { usb: e.usb ? [`${hex4(e.usb[0])}:${hex4(e.usb[1])}`] : [] },
    status: e.capture ? "controllable" : "partial-protocol",
    interfaces: [{
      name: lib.iface,
      transport,
      status: e.capture ? "documented" : "partial",
      notes: e.capture ? "libgphoto2: file access, remote capture and configuration" : "libgphoto2: file listing and download only",
    }],
    projects: [{ name: lib.project, url: `https://github.com/${REPO}/blob/${BRANCH}/${lib.path}`, kind: "driver", license: LICENSE }],
    provenance: { sources: ["libgphoto2"] },
    updated: date,
  };
}

const prepare = (src: string) => stripIfZero(stripComments(src));

const splitVendorModel = (s: string | null): [string, string] | null => {
  const i = s ? s.indexOf(":") : -1;
  return s && i > 0 ? [s.slice(0, i), s.slice(i + 1)] : null;
};

const usbPair = (v?: string, p?: string): [number, number] | null => {
  const a = usbNumber(v), b = usbNumber(p);
  return a !== null && b !== null ? [a, b] : null;
};

/** ptp2 models[]: {"Vendor:Model", vid, pid, flags}; PTP_CAP means remote capture. */
export function parsePtp2(src: string): CamEntry[] {
  const body = arrayBody(prepare(src), "models");
  if (!body) throw new Error("ptp2: models[] not found");
  return initialisers(body).flatMap(([name, vid, pid, flags]) => {
    const vm = splitVendorModel(cString(name));
    return vm ? [{ vendor: vm[0], model: vm[1], usb: usbPair(vid, pid), capture: /\bPTP_CAP\b/.test(flags ?? "") }] : [];
  });
}

/** canon models[]: {"Canon:Model", class, vid|NO_USB, pid|NO_USB, CAP_SUP|CAP_NON|CAP_EXP, …}. */
export function parseCanon(src: string): CamEntry[] {
  const body = arrayBody(prepare(src), "models");
  if (!body) throw new Error("canon: models[] not found");
  return initialisers(body).flatMap(([name, , vid, pid, cap]) => {
    const vm = splitVendorModel(cString(name));
    return vm ? [{ vendor: vm[0], model: vm[1], usb: usbPair(vid, pid), capture: clean(cap) === "CAP_SUP" }] : [];
  });
}

/** sierra_cameras[]: {"Vendor", "Model", sierra model, vid, pid, flags, desc}; all support capture. */
export function parseSierra(src: string): CamEntry[] {
  const body = arrayBody(prepare(src), "sierra_cameras");
  if (!body) throw new Error("sierra: sierra_cameras[] not found");
  return initialisers(body).flatMap(([manuf, model, , vid, pid]) => {
    const v = cString(manuf), m = cString(model);
    return v && m ? [{ vendor: v, model: m, usb: usbPair(vid, pid), capture: true }] : [];
  });
}

const PARSERS: Record<Camlib, (src: string) => CamEntry[]> = { ptp2: parsePtp2, canon: parseCanon, sierra: parseSierra };

const source: Source = {
  source: "libgphoto2",
  name: "libgphoto2",
  url: "http://www.gphoto.org/",
  license: LICENSE,
  async fetch() {
    const out: DeviceRecord[] = [];
    const date = today();
    for (const camlib of Object.keys(CAMLIBS) as Camlib[]) {
      const entries = PARSERS[camlib](await githubRaw(REPO, BRANCH, CAMLIBS[camlib].path));
      const recs = entries.map((e) => fromEntry(camlib, e, date)).filter((r): r is DeviceRecord => !!r);
      console.error(`libgphoto2 ${camlib}: ${entries.length} table entries, ${entries.length - recs.length} skipped (phones, placeholders)`);
      out.push(...recs);
    }
    return out;
  },
};
export default source;
