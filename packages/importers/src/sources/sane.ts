// SANE scanner backends, from the description files the SANE project generates its own
// supported-devices lists from: doc/descriptions/*.desc in gitlab.com/sane-project/backends
// (one file per backend). The format is a flat keyword list: `:backend`, `:devicetype`,
// `:mfg` (opens a manufacturer), then per `:model` its `:interface`, `:usbid "0xVID" "0xPID"`,
// `:status` and `:comment`; `;` starts a comment. The directory is read from one archive
// download, because gitlab.com rate-limits unauthenticated raw files to a few dozen per IP.
//
// Status: :complete / :good → controllable, :basic / :minimal → partial-protocol. :untested
// (support guessed from a sibling model) and :unsupported entries are left out.
// Left out on purpose:
//  - escl: the standard eSCL/AirScan protocol; listing those scanners would read as
//    "reverse engineered" (same reason libgphoto2 leaves out MTP players);
//  - gphoto2 (cameras, imported from libgphoto2 itself), v4l (generic webcams), net, dll,
//    test, pnm, template, unsupported: not device drivers;
//  - doc/descriptions-external: backends shipped outside SANE, several of them proprietary.
// Backends are GPL-2.0-or-later (with the SANE exception); the descriptions are facts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, deviceFirmwareFreedom, type Source } from "../lib.ts";

const ARCHIVE = "https://gitlab.com/sane-project/backends/-/archive/master/backends-master.tar.gz?path=doc/descriptions";
const LICENSE = "GPL-2.0-or-later";
const SKIP_BACKENDS = new Set(["escl", "gphoto2", "v4l", "net", "dll", "test", "pnm", "template", "unsupported"]);

export interface SaneModel {
  backend: string;
  devicetype: string;
  mfg: string;
  model: string;
  interfaces: string[];
  usb: string[];
  status: string;
  comment: string;
}

/** Values after a keyword: quoted strings and :symbols, `;` comments dropped. */
function values(rest: string): string[] {
  const out: string[] = [];
  for (const m of rest.matchAll(/"((?:[^"\\]|\\.)*)"|(:[A-Za-z0-9_-]+)|(;.*$)/g)) {
    if (m[3]) break;
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2].slice(1));
  }
  return out;
}

const hex4 = (s: string) => {
  const m = clean(s).toLowerCase().match(/^0x([0-9a-f]{1,4})$/);
  return m ? m[1].padStart(4, "0") : null;
};

/** One .desc file → its models (manufacturer and device type carried over from the lines above). */
export function parseDesc(text: string): SaneModel[] {
  const out: SaneModel[] = [];
  let backend = "", devicetype = "scanner", mfg = "", cur: SaneModel | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*:([a-z]+)\s*(.*)$/);
    if (!m) continue;
    const [, kw, rest] = m;
    const v = values(rest);
    switch (kw) {
      case "backend": backend = v[0] ?? ""; break;
      case "devicetype": devicetype = v[0] ?? devicetype; cur = null; break;
      case "mfg": mfg = clean(v[0]); cur = null; break;
      case "model":
        cur = { backend, devicetype, mfg, model: clean(v[0]), interfaces: [], usb: [], status: "", comment: "" };
        out.push(cur);
        break;
      case "interface": if (cur) cur.interfaces.push(...v.flatMap((x) => x.split(/\s+/)).map(clean).filter(Boolean)); break;
      case "usbid": {
        const [vid, pid] = [hex4(v[0] ?? ""), hex4(v[1] ?? "")];
        if (cur && vid && pid && vid !== "0000") cur.usb.push(`${vid}:${pid}`);
        break;
      }
      case "status": if (cur) cur.status = v[0] ?? ""; break;
      case "comment": if (cur) cur.comment = clean(v[0]); break;
    }
  }
  return out;
}

const VENDORS: Record<string, string> = {
  "hewlett-packard": "HP", "hewlett packard": "HP", hp: "HP", "konica minolta": "Konica Minolta",
  epson: "Epson", canon: "Canon", brother: "Brother", fujitsu: "Fujitsu", plustek: "Plustek",
  mustek: "Mustek", umax: "UMAX", xerox: "Xerox", samsung: "Samsung", lexmark: "Lexmark",
  panasonic: "Panasonic", kodak: "Kodak", ricoh: "Ricoh", microtek: "Microtek", visioneer: "Visioneer", agfa: "AGFA",
};
export const saneVendor = (mfg: string) => VENDORS[clean(mfg).toLowerCase()] ?? clean(mfg);

const TRANSPORT: [RegExp, string][] = [[/usb/i, "usb"], [/ethernet|network|lan/i, "ethernet"], [/wi-?fi|wlan|wireless/i, "wifi"]];
const transport = (ifaces: string[]) => {
  for (const [re, t] of TRANSPORT) if (ifaces.some((i) => re.test(i))) return t;
  return "other";
};

export const SANE_SITE = "http://www.sane-project.org/";
export const manPage = (backend: string) => `http://www.sane-project.org/man/sane-${backend.toLowerCase()}.5.html`;

/**
 * Install route (SPEC R1): SANE runs on the computer; nothing is flashed. Every Linux
 * distribution packages it, and scanning apps (Simple Scan, XSane, NAPS2) use it. Some old
 * models need a firmware file taken from the vendor's Windows driver, which the backend's
 * manual page explains.
 */
export function saneInstall(m: SaneModel): InstallRoute {
  const firmware = /firmware/i.test(m.comment);
  return {
    project: "SANE",
    method: "host-software",
    guide: manPage(m.backend),
    installer: SANE_SITE,
    difficulty: firmware ? "medium" : "easy",
    brick_risk: "none",
    reversible: "yes",
    notes: "Nothing is flashed: install SANE (sane-backends, packaged by Linux distributions) and a scanning app such as Simple Scan or XSane." +
      (firmware ? " This model needs a firmware file from the vendor's own driver: see the backend's manual page." : ""),
  };
}

export function fromModel(m: SaneModel, date = today()): DeviceRecord | null {
  if (SKIP_BACKENDS.has(m.backend.toLowerCase()) || !m.mfg || !m.model) return null;
  const status = m.status === "complete" || m.status === "good" ? "controllable"
    : m.status === "basic" || m.status === "minimal" ? "partial-protocol" : null;
  if (!status) return null;
  const vendor = saneVendor(m.mfg);
  return {
    id: makeId(vendor, m.model),
    vendor,
    model: m.model,
    category: m.devicetype === "stillcam" || m.devicetype === "vidcam" ? "camera" : "peripheral",
    identifiers: { usb: m.usb },
    status,
    interfaces: [{
      name: m.devicetype === "scanner" ? "Scanning" : "Image capture",
      transport: transport(m.interfaces),
      status: status === "controllable" ? "documented" : "partial",
      notes: clean(`SANE ${m.backend} backend, support ${m.status}${m.interfaces.length ? ` (${m.interfaces.join(", ")})` : ""}. ${m.comment}`).slice(0, 300),
    }],
    projects: [{ name: `SANE ${m.backend} backend`, url: manPage(m.backend), kind: "driver", license: LICENSE, freedom: deviceFirmwareFreedom() }],
    install: [saneInstall(m)],
    provenance: { sources: ["sane"] },
    updated: date,
  };
}

/** Download and unpack the descriptions directory; returns file name → text. */
async function fetchDescriptions(): Promise<Map<string, string>> {
  // gitlab.com sometimes answers 406 while it builds the archive: retry a few times.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 5000 * attempt));
    res = await fetch(ARCHIVE, { headers: { "user-agent": "opendevicedb-importer/0.1 (+https://github.com/opendevicedb)" } });
    if (res.ok) break;
  }
  if (!res?.ok) throw new Error(`${res?.status} ${res?.statusText} for ${ARCHIVE}`);
  const dir = mkdtempSync(join(tmpdir(), "odb-sane-"));
  try {
    writeFileSync(join(dir, "d.tar.gz"), Buffer.from(await res.arrayBuffer()));
    execFileSync("tar", ["-xzf", "d.tar.gz"], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
    const out = new Map<string, string>();
    for (const e of readdirSync(dir, { recursive: true, withFileTypes: true }) as any[]) {
      const p = join(e.parentPath ?? e.path, e.name) as string;
      if (e.isFile() && p.endsWith(".desc") && /\/doc\/descriptions\/[^/]+$/.test(p)) out.set(e.name, readFileSync(p, "utf8"));
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const source: Source = {
  source: "sane",
  name: "SANE",
  url: SANE_SITE,
  license: LICENSE,
  async fetch() {
    const files = await fetchDescriptions();
    if (files.size < 50) throw new Error(`sane: only ${files.size} description files`);
    const date = today();
    const models = [...files.values()].flatMap(parseDesc);
    const out = models.map((m) => fromModel(m, date)).filter((r): r is DeviceRecord => !!r);
    console.error(`sane: ${files.size} backends, ${models.length} models, ${models.length - out.length} skipped (untested, unsupported, generic backends)`);
    return out;
  },
};
export default source;
