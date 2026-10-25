// Printers driven by free drivers, from the OpenPrinting database (foomatic-db,
// github.com/OpenPrinting/foomatic-db): db/source/printer/*.xml (make, model, page description
// languages, functionality rating, recommended driver) and db/source/driver/*.xml (each free
// driver and the printers it supports). Read with one shallow, blob-less, sparse git clone
// (the repository also holds ~900 MB of PPD files we do not need) — this needs `git` on PATH.
//
// Kept: printers rated A ("perfectly") or B ("mostly") that need a printer-specific driver, i.e.
// whose languages include neither PostScript nor PCL. Printers speaking those standard, published
// languages work with any generic driver; listing them would read as "reverse engineered" (same
// reason libgphoto2 leaves out MTP players). What remains is mostly host-based ("GDI") lasers and
// inkjets — Zenographics/ZjStream, Samsung SPL, Canon CAPT, Epson ESC/P(-R)… — driven by drivers
// such as foo2zjs, splix, gutenprint, min12xxw or captdriver. Status controllable.
// Every driver in foomatic-db is free software; the database is GPL-2.0 (its PPDs aside).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, deviceFirmwareFreedom, type Source } from "../lib.ts";

const GIT = "https://github.com/OpenPrinting/foomatic-db.git";
const SITE = "https://openprinting.github.io/foomatic";
const LICENSE = "GPL-2.0";

const decode = (s: string) => clean(s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return m ? decode(m[1]) : ""; };
const noComments = (xml: string) => xml.replace(/<comments>[\s\S]*?<\/comments>/g, "").replace(/<!--[\s\S]*?-->/g, "");

export interface Printer { id: string; make: string; model: string; functionality: string; driver: string; langs: string[] }
export interface Driver { name: string; url: string; printers: string[] }

export function parsePrinter(text: string): Printer | null {
  const xml = noComments(text);
  const id = xml.match(/<printer id="printer\/([^"]+)"/)?.[1];
  if (!id) return null;
  const lang = xml.match(/<lang>([\s\S]*?)<\/lang>/)?.[1] ?? "";
  const langs = [...new Set([...lang.matchAll(/<([a-z0-9_-]+)[\s/>]/gi)].map((m) => m[1].toLowerCase()))].filter((l) => l !== "charset");
  return { id, make: tag(xml, "make"), model: tag(xml, "model"), functionality: tag(xml, "functionality"), driver: tag(xml, "driver"), langs };
}

export function parseDriver(text: string): Driver | null {
  const xml = noComments(text);
  const name = xml.match(/<driver id="driver\/([^"]+)"/)?.[1];
  if (!name) return null;
  const printers = [...(xml.match(/<printers>([\s\S]*?)<\/printers>/)?.[1] ?? "").matchAll(/<id>printer\/([^<]+)<\/id>/g)].map((m) => decode(m[1]));
  return { name, url: tag(xml, "url"), printers };
}

/** Drivers that only produce a standard, published language (PostScript, PDF, PCL/PCL XL). */
export const GENERIC_DRIVER = /^(Postscript|PDF|pxl|ljet|lj4|lj5|lj250|laserjet|ljetplus|hpijs-pcl5|pcl5|cljet5)/i;
const STANDARD_LANG = new Set(["postscript", "pcl", "pdf"]);

export const printerPage = (p: Printer) => `${SITE}/printer/${p.make.replace(/ /g, "_")}/${p.id}`;
export const driverPage = (name: string) => `${SITE}/driver/${encodeURIComponent(name)}`;

const VENDORS: Record<string, string> = { "konica minolta": "Konica Minolta", "hewlett-packard": "HP", hp: "HP", oki: "OKI", kyocera: "Kyocera", brother: "Brother", canon: "Canon", epson: "Epson", samsung: "Samsung", xerox: "Xerox", ricoh: "Ricoh", lexmark: "Lexmark", dell: "Dell", sharp: "Sharp", panasonic: "Panasonic", minolta: "Minolta" };
export const printerVendor = (make: string) => VENDORS[clean(make).toLowerCase()] ?? clean(make);

export const printerInstall = (drivers: string[]): InstallRoute => ({
  project: drivers[0],
  method: "host-software",
  guide: driverPage(drivers[0]),
  difficulty: "easy",
  brick_risk: "none",
  reversible: "yes",
  notes: `Nothing is flashed: add the printer in the computer's printer settings (CUPS) and pick the ${drivers.join(" or ")} driver, which most Linux distributions include. Some host-based printers also need a firmware file sent at power-on, as the driver's page explains.`,
});

/** One printer → record, given the free drivers that support it (recommended first). */
export function fromPrinter(p: Printer, drivers: Driver[], date = today()): DeviceRecord | null {
  if (!["A", "B"].includes(p.functionality) || !p.make || !p.model) return null;
  if (p.langs.some((l) => STANDARD_LANG.has(l))) return null;
  const specific = drivers.filter((d) => !GENERIC_DRIVER.test(d.name));
  if (!specific.length) return null;
  const vendor = printerVendor(p.make);
  const names = specific.map((d) => d.name);
  return {
    id: makeId(vendor, p.model),
    vendor,
    model: p.model,
    category: "printer",
    status: "controllable",
    interfaces: [{
      name: "Printing",
      transport: "usb",
      status: p.functionality === "A" ? "documented" : "partial",
      notes: clean(`OpenPrinting rates it ${p.functionality === "A" ? "A (works perfectly)" : "B (works mostly)"}${p.langs.length ? `; printer language: ${p.langs.join(", ")}` : ""}. Free drivers: ${names.join(", ")}.`),
    }],
    projects: [
      ...specific.slice(0, 3).map((d) => ({ name: d.name, url: driverPage(d.name), kind: "driver", freedom: deviceFirmwareFreedom() })),
      { name: `OpenPrinting: ${p.make} ${p.model}`, url: printerPage(p), kind: "other" },
    ],
    install: [printerInstall(names.slice(0, 3))],
    provenance: { sources: ["openprinting"] },
    updated: date,
  };
}

/** All printers and drivers → records. */
export function fromDatabase(printers: Printer[], drivers: Driver[], date = today()): DeviceRecord[] {
  const byPrinter = new Map<string, Driver[]>();
  for (const d of drivers) for (const id of d.printers) byPrinter.set(id, [...(byPrinter.get(id) ?? []), d]);
  const byName = new Map(drivers.map((d) => [d.name, d]));
  return printers.flatMap((p) => {
    const ds = byPrinter.get(p.id) ?? [];
    const rec = byName.get(p.driver);
    const ordered = rec && ds.includes(rec) ? [rec, ...ds.filter((d) => d !== rec)] : rec ? [rec, ...ds] : ds;
    const r = fromPrinter(p, ordered, date);
    return r ? [r] : [];
  });
}

function sparseClone(): string {
  const dir = mkdtempSync(join(tmpdir(), "odb-openprinting-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  try {
    git("clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout", GIT, ".");
    git("sparse-checkout", "set", "--no-cone", "/db/source/printer/*.xml", "/db/source/driver/*.xml");
    git("checkout", "-q");
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

const read = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".xml")).map((f) => readFileSync(join(dir, f), "utf8"));

const source: Source = {
  source: "openprinting",
  name: "OpenPrinting",
  url: "https://openprinting.github.io/",
  license: LICENSE,
  async fetch() {
    const dir = sparseClone();
    try {
      const printers = read(join(dir, "db/source/printer")).map(parsePrinter).filter((p): p is Printer => !!p);
      const drivers = read(join(dir, "db/source/driver")).map(parseDriver).filter((d): d is Driver => !!d);
      if (printers.length < 3000) throw new Error(`openprinting: only ${printers.length} printers`);
      const out = fromDatabase(printers, drivers);
      console.error(`openprinting: ${printers.length} printers, ${drivers.length} drivers, ${printers.length - out.length} skipped (PostScript/PCL, not working, no specific driver)`);
      return out;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};
export default source;
