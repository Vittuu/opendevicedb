// coreboot supported mainboards: github.com/coreboot/coreboot (mirror of review.coreboot.org),
// one directory per board in src/mainboard/<vendor>/<board>/ with
//  - Kconfig.name: the menu entries ("config BOARD_X / bool "<marketing name>""), one per
//    board variant built from that directory (one record each);
//  - board_info.txt: "Category: laptop|desktop|server|half|mini|sbc|eval|emulation|misc…",
//    "Release year:", flash chip facts; variants/<dir>/board_info.txt overrides it, the
//    variant dir of each entry comes from Kconfig ("default "<dir>" if BOARD_X").
// The vendor display name is src/mainboard/<vendor>/Kconfig.name ("config VENDOR_X").
// Google boards are Chromebook/Chromebox reference designs: the menu label is
// "<Codename> (<OEM product>)" or names the products in its help text; each product becomes a
// record under its OEM (codename as alias), unnamed codenames (reference boards, unreleased
// variants) are skipped. Evaluation/reference/emulation boards are skipped.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, fetchJson, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "coreboot/coreboot", BRANCH = "main", ROOT = "src/mainboard";

type Category = DeviceRecord["category"];

// ---------- parsing ----------

/** "Key: value" lines of board_info.txt, keys lowercased. */
export function parseBoardInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
    if (m && clean(m[2])) out[m[1].toLowerCase()] = clean(m[2]);
  }
  return out;
}

export interface KconfigEntry { symbol: string; label: string; help: string[] }

/** Menu entries of a Kconfig.name: `config X` + `bool "label"` + optional help lines. */
export function parseKconfigName(text: string): KconfigEntry[] {
  const out: KconfigEntry[] = [];
  let cur: KconfigEntry | null = null;
  let inHelp = false;
  for (const line of text.split(/\r?\n/)) {
    const c = line.match(/^config\s+(\w+)/);
    if (c) { cur = { symbol: c[1], label: "", help: [] }; out.push(cur); inHelp = false; continue; }
    if (/^\S/.test(line)) { cur = null; inHelp = false; continue; } // comment, if, endif…
    if (!cur) continue;
    const b = line.match(/^\s+bool\s+"((?:[^"\\]|\\.)*)"/);
    if (b && !inHelp) { cur.label = b[1].replace(/\\(.)/g, "$1"); continue; }
    if (/^\s+help\s*$/.test(line)) { inHelp = true; continue; }
    if (inHelp && clean(line)) cur.help.push(clean(line));
  }
  return out.filter((e) => e.label);
}

/** Vendor display name from <vendor>/Kconfig.name ("config VENDOR_X / bool "Name""). */
export function parseVendorName(text: string): string | undefined {
  return parseKconfigName(text).find((e) => e.symbol.startsWith("VENDOR_"))?.label;
}

/** BOARD_X → variant dir, from the `config VARIANT_DIR` defaults of a board Kconfig. */
export function parseVariantDirs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*config\s+\w+/.test(line)) { inBlock = /^\s*config\s+VARIANT_DIR\b/.test(line); continue; }
    if (!inBlock) continue;
    const m = line.match(/^\s+default\s+"([^"]+)"\s+if\s+(.+)$/);
    if (m) for (const sym of m[2].match(/\bBOARD_\w+/g) ?? []) if (!out.has(sym)) out.set(sym, m[1]);
  }
  return out;
}

const CATEGORIES: Record<string, Category> = {
  laptop: "laptop", desktop: "desktop", server: "desktop", half: "desktop", mini: "desktop",
  aio: "desktop", settop: "desktop", sbc: "single-board", misc: "other",
};
/** board_info Category → record category; null for boards we skip (eval, emulation…). */
export const corebootCategory = (c: string | undefined): Category | null => CATEGORIES[clean(c).toLowerCase()] ?? null;

const VENDOR_NAMES: Record<string, string> = {
  "dell inc.": "Dell", samsung: "Samsung", razer: "Razer", gigabyte: "Gigabyte", "open compute project": "Open Compute Project",
};
/** Normalise vendor spellings ("Dell Inc." → "Dell", "Bostentech (Shenzhen …)" → "Bostentech"). */
export function normVendor(v: string): string {
  const s = clean(v).replace(/\s*\(.*\)$/, "");
  return VENDOR_NAMES[s.toLowerCase()] ?? s;
}

// Boards whose category says laptop/desktop but which are chipset reference designs.
const SKIP_BOARDS = new Set(["intel/glkrvp", "intel/kunimitsu", "intel/strago", "intel/ptlrvp", "example/min86"]);
const REFERENCE = /\b(RVP\d*|CRB|reference|EVB|fake board)\b/i;

// Per-board or per-entry fixes where the menu label is a codename or misleading.
interface Fix { vendor?: string; model?: string; aliases?: string[]; category?: Category; skip?: boolean }
const FIXES: Record<string, Fix> = {
  "framework/azalea": { model: "Laptop 13 (AMD Ryzen 7040 Series)", aliases: ["Azalea"] },
  "samsung/lumpy": { model: "Chromebook Series 5 550", aliases: ["Lumpy"] },
  "samsung/stumpy": { model: "Chromebox Series 3", aliases: ["Stumpy"] },
  "ti/beaglebone": { vendor: "BeagleBoard.org", model: "BeagleBone" },
  "up/squared": { vendor: "AAEON", model: "UP Squared" },
  "lattepanda/mu": { model: "Mu" }, // SOM and its carriers: one device
  "purism/librem_jsl": { category: "tablet" },
  "lenovo/x230#BOARD_LENOVO_X230_EDP": { model: "ThinkPad X230" }, // eDP display mod
};

/**
 * Clean a menu label for a vendor: drop the "->" sub-menu marker, a leading vendor name,
 * "(work in progress)"; "ThinkPad X200 / X200s / X200t" → model "ThinkPad X200" with the
 * other spaced-slash parts as aliases ("ThinkPad X200s"…) plus the full label.
 */
export function splitLabel(label: string, vendorNames: string[]): { model: string; aliases: string[] } {
  let s = clean(label.replace(/^\s*-+>\s*/, "")).replace(/\s*\(work in progress\)\s*$/i, "");
  for (const v of vendorNames) {
    const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
    if (v && re.test(s) && s.replace(re, "")) { s = s.replace(re, ""); break; }
  }
  const parts = s.split(/\s+\/\s+/).map(clean).filter(Boolean);
  if (parts.length < 2) return { model: s, aliases: [] };
  const first = parts[0];
  const prefix = first.includes(" ") ? first.slice(0, first.lastIndexOf(" ")) : "";
  const firstWord = first.split(" ")[0].toLowerCase();
  const aliases = parts.slice(1).map((p) => (prefix && p.split(" ")[0].toLowerCase() !== firstWord ? `${prefix} ${p}` : p));
  return { model: first, aliases: [s, ...aliases] };
}

// ---------- Google (Chromebooks) ----------

const BRANDS: Record<string, string> = {
  acer: "Acer", asus: "ASUS", hp: "HP", lenovo: "Lenovo", dell: "Dell", samsung: "Samsung", google: "Google",
  aopen: "AOpen", ctl: "CTL", toshiba: "Toshiba", lg: "LG", nec: "NEC", haier: "Haier", hisense: "Hisense",
  framework: "Framework", dynabook: "Dynabook", spc: "SPC",
};
// Products named without their brand: [first words, vendor, keep the words in the model].
const BRANDLESS: [RegExp, string][] = [
  [/^(ideapad|thinkpad|thinkcentre|yoga)\b/i, "Lenovo"],
  [/^latitude\b/i, "Dell"],
  [/^galaxy\b/i, "Samsung"],
  [/^fmv\b/i, "Fujitsu"],
  [/^onhub\b/i, "TP-Link"],
  [/^(pixel|pixelbook|meet|series one|wifi)\b/i, "Google"],
];

// Several-word brands of white-label education Chromebooks.
const LONG_BRANDS = ["JP Sa Couto", "True IDC"];
const NOT_BRANDS = new Set(["education", "consumer", "chromebook", "chromebox"]);

/**
 * "HP Chromebook 14" → HP / Chromebook 14; "IdeaPad 3 Chromebook" → Lenovo / IdeaPad 3 Chromebook.
 * With `anyBrand` (help-text device lists, where every line starts with its OEM) an unknown
 * first word is taken as the vendor ("Positivo Chromebook N2320").
 */
export function productVendor(product: string, anyBrand = false): { vendor: string; model: string } | null {
  const p = clean(product);
  for (const b of LONG_BRANDS) if (p.toLowerCase().startsWith(b.toLowerCase() + " ")) return { vendor: b, model: p.slice(b.length + 1) };
  const [w, ...rest] = p.split(" ");
  const brand = BRANDS[w.toLowerCase()];
  if (brand && rest.length) return { vendor: brand, model: rest.join(" ") };
  for (const [re, v] of BRANDLESS) if (re.test(p)) return { vendor: v, model: p };
  if (anyBrand && rest.length && !NOT_BRANDS.has(w.toLowerCase())) return { vendor: w, model: rest.join(" ") };
  return null;
}

/** Category of a Chrome OS product from its name, else null. */
export function chromeCategory(product: string): Category | null {
  if (/\b(router|onhub|wifi)\b/i.test(product)) return "router";
  if (/\b(tab|tablet|duet|slate|pixel c|detachable)\b/i.test(product)) return "tablet";
  if (/\b(chromebox|chromebase|chromebit|compute system)\b/i.test(product)) return "desktop";
  if (/\b(chromebook|pixelbook|laptop|latitude|thinkpad|ideapad|yoga)\b/i.test(product)) return "laptop";
  if (/\b(meet|series one)\b/i.test(product)) return "other";
  return null;
}

/**
 * Products of a Google menu entry: "Anahera (HP Elite c640 14 inch G3 Chromebook)" or, when the
 * label says "Multiple devices"/"see help text", the "- <device>" lines of its help text.
 */
export interface GoogleProduct { name: string; codename?: string; fromHelp: boolean }
export function googleProducts(e: KconfigEntry): { codenames: string[]; products: GoogleProduct[] } {
  const label = clean(e.label.replace(/^\s*-+>\s*/, ""));
  const m = label.match(/^([^()]+?)\s*\((.*)\)$/);
  const codenames = clean(m ? m[1] : label).split("/").map(clean).filter(Boolean);
  if (!m || /legacy/i.test(m[1])) return { codenames, products: [] };
  if (/multiple|help text/i.test(m[2])) {
    const products = e.help.filter((h) => h.startsWith("- ")).flatMap((h): GoogleProduct[] => {
      let name = clean(h.slice(2)).replace(/\s*\([^)]*(convertible|clamshell)[^)]*\)$/i, "");
      // "HP Chromebook 14 G7 (Drawman)": a trailing one-word codename
      const cm = name.match(/^(.*\S)\s+\(([A-Za-z]+)\)$/);
      const codename = cm ? cm[2][0].toUpperCase() + cm[2].slice(1).toLowerCase() : undefined;
      if (cm) name = cm[1];
      if (codenames.some((c) => name.toLowerCase().startsWith(c.toLowerCase() + " "))) return []; // "Wyvern MobLab"
      return [{ name, codename, fromHelp: true }];
    });
    return { codenames, products };
  }
  return { codenames, products: [{ name: m[2], fromHelp: false }] };
}

// ---------- records ----------

export interface BoardInput {
  dir: string;                      // "<vendor>/<board>"
  vendorName?: string;              // from <vendor>/Kconfig.name
  kconfigName: string;              // <board>/Kconfig.name
  boardInfo?: string;               // <board>/board_info.txt
  variantDirs?: Map<string, string>;
  variantInfo?: Map<string, string>; // variant dir → board_info.txt
}

function summaryOf(info: Record<string, string>, dir: string): string {
  const bits = [`Supported by coreboot (src/mainboard/${dir}).`];
  if (/^\d{4}$/.test(info["release year"] ?? "")) bits.push(`Released ${info["release year"]}.`);
  const rom = [info["rom protocol"], info["rom package"]].filter(Boolean).join(" ");
  if (rom) bits.push(`Flash: ${rom}${info["rom socketed"] === "y" ? ", socketed" : info["rom socketed"] === "n" ? ", soldered" : ""}.`);
  if (info["flashrom support"]) bits.push(`flashrom: ${info["flashrom support"] === "y" ? "yes" : info["flashrom support"]}.`);
  return bits.join(" ");
}

export function fromBoard(b: BoardInput, date = today()): DeviceRecord[] {
  if (SKIP_BOARDS.has(b.dir) || b.dir.startsWith("emulation/")) return [];
  const [vendorDir] = b.dir.split("/");
  const boardInfo = parseBoardInfo(b.boardInfo ?? "");
  const out: DeviceRecord[] = [];
  for (const e of parseKconfigName(b.kconfigName)) {
    if (!e.symbol.startsWith("BOARD_")) continue;
    const vdir = b.variantDirs?.get(e.symbol);
    const vtext = vdir ? b.variantInfo?.get(vdir) : undefined;
    const info = { ...boardInfo, ...parseBoardInfo(vtext ?? "") };
    const project = {
      name: "coreboot",
      url: `https://github.com/${REPO}/tree/${BRANCH}/${ROOT}/${b.dir}${vtext ? `/variants/${vdir}` : ""}`,
      kind: "firmware",
      license: "GPL-2.0",
    };
    const base = { status: "open-firmware" as const, summary: summaryOf(info, b.dir), projects: [project], provenance: { sources: ["coreboot"] }, updated: date };

    if (vendorDir === "google") {
      const { codenames, products } = googleProducts(e);
      for (const product of products) {
        const pv = productVendor(product.name, product.fromHelp);
        if (!pv || codenames.some((c) => c.toLowerCase() === pv.model.toLowerCase())) continue; // "ViewSonic Bujia"
        const category = chromeCategory(product.name) ?? corebootCategory(info.category) ?? "laptop";
        const model = clean(pv.model);
        const aliases = [...codenames, ...(product.codename ? [product.codename] : [])].map((c) => `Google ${c}`);
        out.push({ id: makeId(pv.vendor, model), vendor: pv.vendor, model, aliases, category, ...base });
      }
      continue;
    }

    const fix = FIXES[`${b.dir}#${e.symbol}`] ?? FIXES[b.dir] ?? {};
    const category = corebootCategory(info.category) && (fix.category ?? corebootCategory(info.category));
    if (!category || fix.skip || REFERENCE.test(e.label)) continue;
    const kvendor = normVendor(b.vendorName ?? info["vendor name"] ?? vendorDir);
    const vendor = fix.vendor ?? kvendor;
    const split = splitLabel(e.label, [b.vendorName ?? "", kvendor, info["vendor name"] ?? "", vendorDir]);
    const model = fix.model ?? split.model;
    const aliases = [...(fix.aliases ?? []), ...split.aliases, ...(model !== split.model ? [split.model] : [])];
    if (!model) continue;
    out.push({ id: makeId(vendor, model), vendor, model, aliases, category, ...base });
  }
  return out;
}

// ---------- fetch ----------

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Blob paths under src/mainboard: the whole coreboot tree is too big for one recursive listing. */
async function mainboardFiles(): Promise<string[]> {
  const h = { headers: githubHeaders() };
  const src = await fetchJson(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}:src`, h);
  const sha = src.tree.find((x: any) => x.path === "mainboard" && x.type === "tree")?.sha;
  if (!sha) throw new Error("coreboot: src/mainboard not found");
  const tree = await fetchJson(`https://api.github.com/repos/${REPO}/git/trees/${sha}?recursive=1`, h);
  if (tree.truncated) throw new Error("coreboot: src/mainboard tree is truncated");
  return tree.tree.filter((x: any) => x.type === "blob").map((x: any) => x.path as string);
}

const source: Source = {
  source: "coreboot",
  name: "coreboot",
  url: "https://www.coreboot.org/",
  license: "GPL-2.0",
  async fetch() {
    const files = new Set(await mainboardFiles());
    const raw = (p: string) => githubRaw(REPO, BRANCH, `${ROOT}/${p}`);
    const vendors = [...files].filter((p) => /^[^/]+\/Kconfig\.name$/.test(p)).map((p) => p.split("/")[0]);
    const vendorNames = new Map(await mapLimit(vendors, 16, async (v) => [v, parseVendorName(await raw(`${v}/Kconfig.name`))] as const));
    const boards = [...files].filter((p) => /^[^/]+\/[^/]+\/Kconfig\.name$/.test(p)).map((p) => p.slice(0, -"/Kconfig.name".length));
    const inputs = await mapLimit(boards, 16, async (dir): Promise<BoardInput> => {
      const get = (p: string) => (files.has(`${dir}/${p}`) ? raw(`${dir}/${p}`) : Promise.resolve(undefined));
      const variants = [...files].filter((p) => p.startsWith(`${dir}/variants/`) && /\/variants\/[^/]+\/board_info\.txt$/.test(p));
      const variantInfo = new Map<string, string>();
      for (const p of variants) variantInfo.set(p.split("/")[3], (await raw(p))!);
      const kconfig = variants.length ? await get("Kconfig") : undefined;
      return {
        dir,
        vendorName: vendorNames.get(dir.split("/")[0]),
        kconfigName: (await get("Kconfig.name"))!,
        boardInfo: await get("board_info.txt"),
        variantDirs: kconfig ? parseVariantDirs(kconfig) : undefined,
        variantInfo,
      };
    });
    const out = inputs.flatMap((b) => fromBoard(b));
    console.error(`coreboot: ${boards.length} board directories → ${out.length} records`);
    return out;
  },
};
export default source;
