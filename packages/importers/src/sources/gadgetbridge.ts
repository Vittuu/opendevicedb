// Gadgetbridge supported gadgets (https://gadgetbridge.org/gadgets/), from two Codeberg repos:
//  - Freeyourgadget/website: device_support.yml (one key per supported gadget: category,
//    vendor page, support flags, links) and docs/gadgets/<category>/<page>.md, whose headings
//    "## <Name> {{ device("<key>") }}" give each gadget's display name and page anchor;
//  - Freeyourgadget/Gadgetbridge: the DeviceType enum and its *Coordinator classes, whose
//    getSupportedDeviceName() regex is the BLE/BT advertised name the app pairs with. Its
//    literal prefixes become `ble_names`, matched to the website entries by display name
//    (app/src/main/res/values/strings.xml devicetype_*).
// Codeberg rate-limits raw file requests hard (429 after ~100), so both repos are read with one
// shallow, blob-less, sparse git clone each (a handful of requests) — this needs `git` on PATH.
// Gadgetbridge drives the stock firmware over a reverse-engineered protocol: status controllable,
// project kind integration; gadgets flagged feature_poor ("probably only pairs") are partial-protocol.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import YAML from "yaml";
import { makeId, slugify, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, type Source } from "../lib.ts";

const WEBSITE = "https://codeberg.org/Freeyourgadget/website.git";
const APP = "https://codeberg.org/Freeyourgadget/Gadgetbridge.git";
const SITE = "https://gadgetbridge.org";
const DEVICES_DIR = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices";

const compact = (s: string) => slugify(s).replace(/-/g, "");

// ---------- website: device_support.yml + gadget pages ----------

export interface GadgetEntry {
  key: string;
  category: string; // website category directory, e.g. "headphones"
  vendor: string; // website vendor key (page name, before vendor_mappings)
  flags: string[];
  links: Record<string, string>;
}

/** device_support.yml → entries. Uses YAML anchors/aliases and has a few duplicate keys (last wins). */
export function parseDeviceSupport(text: string): GadgetEntry[] {
  const doc = YAML.parse(text, { uniqueKeys: false, maxAliasCount: -1 }) ?? {};
  return Object.entries<any>(doc.device_support ?? {}).flatMap(([key, v]) => {
    if (!v || typeof v !== "object" || !clean(v.category)) return [];
    const links = Object.fromEntries(Object.entries<any>(v.links ?? {}).filter(([, u]) => typeof u === "string"));
    return [{ key, category: clean(v.category), vendor: clean(v.vendor), flags: (v.flags ?? []).map(clean), links }];
  });
}

export interface GadgetPage {
  title: string; // frontmatter title, e.g. "Huawei / Honor"
  headings: Map<string, string>; // device key → heading text
}

/** A docs/gadgets page: its title and every heading that carries a {{ device("key") }} tag. */
export function parseGadgetPage(text: string): GadgetPage {
  const title = clean(text.match(/^---[\s\S]*?^title:\s*(.+)$/m)?.[1]?.replace(/^["']|["']$/g, "")) || clean(text.match(/^#\s+([^{\n]+)/m)?.[1]);
  const headings = new Map<string, string>();
  for (const m of text.matchAll(/^#{1,6}\s+(.*?)\s*\{\{\s*device\(\s*["']([^"']+)["']\s*\)\s*\}\}/gm)) headings.set(m[2], clean(m[1]));
  return { title, headings };
}

/** Pages that list one app/protocol family across many (often unbranded) makers. */
export const PLATFORM_PAGES: Record<string, string> = {
  fitcloud: "FitCloud",
  fitpro: "FitPro",
  gloryfit: "GloryFit",
  gloryfitpro: "GloryFitPro",
  moyoung: "Moyoung",
  wearfit: "Wearfit",
  keephealth: "Keep Health",
  hplus: "HPlus",
  other: "Generic",
};

/** Page titles that are not the brand printed on the device. */
export const TITLE_BRANDS: Record<string, string> = {
  "Garmin HRM": "Garmin",
  "Ollee Watch One": "Ollee",
  "UNA Watch": "UNA",
  "Bangle.js": "Espruino",
  "BMx devices": "Leagend",
  "QN-Scale": "Chipsea",
  Flipper: "Flipper Devices",
};

/** Brands that appear as the first word(s) of headings on pages named after someone else. */
export const KNOWN_BRANDS = [
  "Advan", "Blackview", "Bohemic", "Braun", "Citizen", "ColaCao", "Colmi", "Dotn", "Fire-Boltt", "Garett",
  "Garmin", "GRV", "Honor", "Huawei", "IMIKI", "iTECH", "JYou", "Kieslect", "Ksix", "LIGE", "Makibes",
  "Misirun", "NO.1", "Oukitel", "Qecnato", "Rainbuvvy", "Skagen", "Teclast", "Ultrahuman", "Victron",
  "Viran", "Vivitar", "Xplora", "Yawell", "Zeblaze", "8BitDo", "Soundbrenner",
];

/** Gadgets whose page and heading do not give a usable vendor/model. */
export const KEY_OVERRIDES: Record<string, { vendor: string; model: string }> = {
  sony_ericsson_liveview: { vendor: "Sony Ericsson", model: "LiveView" },
  flipper_zero: { vendor: "Flipper Devices", model: "Flipper Zero" },
  other_vesc: { vendor: "Generic", model: "VESC" }, // open-hardware motor controller built by many makers
  other_um25: { vendor: "RDTech", model: "UM25" },
  itag_any: { vendor: "Generic", model: "iTag" },
  vibratissimo_any: { vendor: "Amor", model: "Vibratissimo" }, // coordinator manufacturer "Amor AG"
};

/** OS or firmware families listed as gadgets: not device models, skipped. */
export const SKIP_KEYS = new Set(["asteroid_os", "wasp_os", "other_atc_ble_oepl"]);

/**
 * Vendor and model of a gadget. The page title is the brand ("Sony"), except on multi-brand
 * pages ("Huawei / Honor") and platform pages (FitPro, Moyoung…) where a heading that starts with
 * a known brand ("Colmi P76") gives it; "(brandless)" headings are Generic.
 */
export function splitGadget(page: string, title: string, heading: string, key = ""): { vendor: string; model: string; aliases: string[] } {
  const o = KEY_OVERRIDES[key];
  if (o) return { ...o, aliases: [] };
  const platform = PLATFORM_PAGES[page];
  const titleBrands = platform ? [] : (TITLE_BRANDS[title] ?? title).split(" / ").map(clean).filter(Boolean);
  const brands = [...titleBrands, ...KNOWN_BRANDS].sort((a, b) => b.length - a.length);
  const brandless = heading.match(/^(.*?)\s*\((?:brandless|unbranded)\)$/i);
  if (brandless) {
    const model = clean(brandless[1]);
    return { vendor: "Generic", model, aliases: platform && platform !== "Generic" ? [`${platform} ${model}`] : [] };
  }
  const lower = heading.toLowerCase();
  const brand = brands.find((b) => lower === b.toLowerCase() || lower.startsWith(b.toLowerCase() + " "));
  if (brand) {
    let model = clean(heading.slice(brand.length)).replace(/^\((.*)\)$/, "$1"); // "LIGE (C60)"
    if (!model) model = heading; // heading is just the brand: "AAWireless"
    return { vendor: brand, model, aliases: [] };
  }
  const vendor = platform ?? titleBrands[0] ?? "Generic";
  return { vendor, model: heading, aliases: [] };
}

/** website category → OpenDeviceDB category. */
export const GADGET_CATEGORIES: Record<string, string> = {
  wearables: "wearable",
  rings: "wearable",
  "hr-bands": "wearable",
  glasses: "wearable",
  headphones: "audio",
  speakers: "audio",
  transmitters: "audio", // car FM transmitters
  thermometers: "sensor",
  "battery-monitors": "sensor",
  "blood-monitors": "medical",
  scales: "appliance",
  batteries: "appliance",
  "gym-equipment": "appliance",
  vacuums: "appliance", // handheld stick vacuums, not robots
  "air-conditioners": "appliance",
  scooters: "vehicle",
  gamepads: "peripheral",
};

const KEY_CATEGORIES: Record<string, string> = {
  femometer_vinca_2: "medical",
  shell_racing_rc_motorsport: "toy",
  sony_reon_pocket_pro: "wearable",
  xiaomi_hipee_smart_posture_corrector_p1: "wearable",
  aawireless_one: "peripheral",
  aawireless_two: "peripheral",
};

export const gadgetCategory = (category: string, key = "") => KEY_CATEGORIES[key] ?? GADGET_CATEGORIES[category] ?? "other";

/** feature_poor = "probably only able to pair": not really controllable. */
export const gadgetStatus = (flags: string[]) => (flags.includes("feature_poor") ? "partial-protocol" : "controllable");

const LINK_PROJECTS: Record<string, { name: string; kind: string }> = {
  protocol: { name: "Gadgetbridge protocol notes", kind: "protocol-doc" },
  firmware_info: { name: "Gadgetbridge firmware notes", kind: "other" },
  custom_os: { name: "Gadgetbridge custom OS notes", kind: "other" },
  language_pack: { name: "Gadgetbridge language pack notes", kind: "other" },
};

export const gadgetPageUrl = (category: string, page: string) => `${SITE}/gadgets/${category}/${page}/`;

// ---------- install route (SPEC R1) ----------

const APP_INSTALLER = "https://f-droid.org/packages/nodomain.freeyourgadget.gadgetbridge/";

/** pair_* flags (website extra_config.yml) that need something from the vendor app first. */
const PAIRING_NOTES: Record<string, { difficulty: InstallRoute["difficulty"]; notes: string }> = {
  pair_huami: { difficulty: "medium", notes: `Pair with the vendor app (Zepp / Zepp Life / Mi Fit) first and extract the authentication key: ${SITE}/basics/pairing/huami-xiaomi-server/` },
  pair_xiaomi: { difficulty: "medium", notes: `Pair with the vendor app (Mi Fitness / Xiaomi Wear) first and extract the authentication key: ${SITE}/basics/pairing/huami-xiaomi-server/` },
  pair_fossil: { difficulty: "medium", notes: `Pair with the Fossil app first and extract the authentication key: ${SITE}/basics/pairing/fossil-server/` },
  pair_nothing_cmf: { difficulty: "medium", notes: `Pair with the CMF Watch app first and extract the authentication key: ${SITE}/basics/pairing/nothing-cmf-server/` },
  pair_auth_key: { difficulty: "medium", notes: "Pair with the vendor app first and extract the authentication key; after that the vendor app is not needed." },
  pair_connect_once: { difficulty: "easy", notes: "Connect once with the vendor app first; after that the vendor app is not needed." },
  pair_victron: { difficulty: "easy", notes: "Enable GATT in the VictronConnect app first." },
};

/**
 * Nothing is flashed: the gadget is paired with the Gadgetbridge Android app. pair_free gadgets
 * pair directly; the other pair_* flags say what the vendor app must do first; without a
 * known pairing flag the route says so.
 */
export function gadgetInstall(flags: string[], guide: string): InstallRoute {
  const known = flags.map((f) => PAIRING_NOTES[f]).find(Boolean);
  const free = flags.includes("pair_free");
  return {
    project: "Gadgetbridge",
    method: "pairing",
    guide,
    installer: APP_INSTALLER,
    difficulty: known?.difficulty ?? (free ? "easy" : "medium"),
    tools: ["Android phone with the Gadgetbridge app"],
    brick_risk: "none",
    reversible: "yes",
    ...(known ? { notes: known.notes } : free ? {} : { notes: "Pairing method not documented yet: the vendor app may be needed first." }),
  };
}

export function fromGadget(e: GadgetEntry, page: string, p: GadgetPage, date = today()): DeviceRecord | null {
  const heading = p.headings.get(e.key);
  if (!heading || SKIP_KEYS.has(e.key)) return null;
  const { vendor, model, aliases } = splitGadget(page, p.title, heading, e.key);
  if (!vendor || !model) return null;
  const pageUrl = gadgetPageUrl(e.category, page);
  const projects: NonNullable<DeviceRecord["projects"]> = [
    { name: "Gadgetbridge", url: `${pageUrl}#device__${encodeURIComponent(e.key)}`, kind: "integration", license: "AGPL-3.0" },
  ];
  for (const [k, rel] of Object.entries(e.links)) {
    const lp = LINK_PROJECTS[k];
    if (!lp) continue;
    try {
      projects.push({ name: lp.name, url: new URL(rel.replace(/\/?$/, "/"), pageUrl).href, kind: lp.kind as any, license: "AGPL-3.0" });
    } catch { /* not a URL */ }
  }
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases,
    category: gadgetCategory(e.category, e.key) as DeviceRecord["category"],
    status: gadgetStatus(e.flags),
    projects,
    install: [gadgetInstall(e.flags, projects[0].url)],
    provenance: { sources: ["gadgetbridge"] },
    updated: date,
  };
}

// ---------- app: DeviceType + coordinators → BLE names ----------

/** Coordinator class names in the DeviceType enum, in order (UNKNOWN/TEST excluded). */
export function deviceTypeCoordinators(text: string): string[] {
  const body = text.slice(text.indexOf("enum DeviceType"));
  return [...body.matchAll(/^\s+([A-Z0-9_]+)\((\w+)\.class\)/gm)].filter((m) => m[1] !== "UNKNOWN" && m[1] !== "TEST").map((m) => m[2]);
}

/** strings.xml → { devicetype_xxx: "Display Name" }. */
export function deviceTypeNames(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of xml.matchAll(/<string name="(devicetype_[^"]+)"[^>]*>([^<]*)<\/string>/g)) {
    out[m[1]] = clean(m[2].replace(/\\'/g, "'").replace(/&amp;/g, "&").replace(/^"|"$/g, ""));
  }
  return out;
}

/** String constants of a Java/Kotlin file: `String X = "..."` / `const val X = "..."`. */
export function stringConstants(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]*)\s*(?::\s*String\s*)?=\s*"((?:[^"\\]|\\.)*)"\s*[;\n]/g)) out[m[1]] ??= unescapeJava(m[2]);
  return out;
}

const unescapeJava = (s: string) => s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) =>
  c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[c] ?? c);

/** Index of the parenthesis closing the one at `open`, skipping string literals. */
function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === "\\") i++; continue; }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/** Split on a separator at depth 0, outside string literals. */
function splitCode(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === "\\") i++; continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim());
}

export interface Coordinator {
  cls: string;
  nameRes?: string; // devicetype_xxx
  manufacturer?: string;
  regex?: string; // the Java regex, string-unescaped
  literal?: boolean; // Pattern.LITERAL
  names?: string[]; // Zepp OS getDeviceBluetoothNames(): name prefixes
}

/**
 * Read what a coordinator says about itself. `consts` resolves names like
 * HuamiConst.MI_BAND2_NAME ("Class.NAME" or bare "NAME") used in Pattern.compile(...).
 */
export function parseCoordinator(cls: string, text: string, consts: Record<string, string> = {}): Coordinator {
  const c: Coordinator = { cls };
  c.nameRes = text.match(/getDeviceNameResource\(\)[^{=]*[{=][^}]*?R\.string\.(devicetype_\w+)/)?.[1];
  c.manufacturer = text.match(/getManufacturer\(\)[^{=]*[{=][^}]*?"([^"]+)"/)?.[1];
  const bt = text.match(/getDeviceBluetoothNames\(\)[^{=]*[{=]([^}]*)/)?.[1];
  if (bt) c.names = [...bt.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => clean(unescapeJava(m[1]))).filter(Boolean);
  const at = text.indexOf("getSupportedDeviceName");
  const pc = at < 0 ? -1 : text.indexOf("Pattern.compile(", at);
  if (pc < 0 || pc - at > 400) return c;
  const open = pc + "Pattern.compile".length;
  const close = closingParen(text, open);
  if (close < 0) return c;
  const [expr, ...flags] = splitCode(text.slice(open + 1, close), ",");
  const local = stringConstants(text);
  let regex = "";
  for (const term of splitCode(expr, "+")) {
    const lit = term.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (lit) { regex += unescapeJava(lit[1]); continue; }
    const name = term.match(/^(?:(\w+)\.)?([A-Z][A-Z0-9_]*)$/);
    const v = name && (consts[`${name[1] ?? cls}.${name[2]}`] ?? (name[1] ? undefined : local[name[2]]));
    if (v === undefined || v === null) return c; // unresolvable expression
    regex += v;
  }
  c.regex = regex;
  if (flags.some((f) => /\bLITERAL\b/.test(f))) c.literal = true;
  return c;
}

/** Split a regex on a character at depth 0 (outside groups and classes). */
function splitRegex(re: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, cls = false, start = 0;
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === "\\") { i++; continue; }
    if (cls) { if (c === "]") cls = false; continue; }
    if (c === "[") cls = true;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) { out.push(re.slice(start, i)); start = i + 1; }
  }
  out.push(re.slice(start));
  return out;
}

/** Literal text a regex alternative must start with ("^Redmi Watch 3 [A-Z0-9]{4}$" → "Redmi Watch 3"). */
export function literalPrefix(alt: string): string {
  let s = alt.replace(/^\(\?[a-z]+\)/, "").replace(/^\^/, "");
  while (/^\.[*+]/.test(s)) s = s.slice(2); // ".*WH-1000XM4.*": contains
  let out = "";
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (c === "\\") {
      const n = s[i + 1];
      if (n === undefined || /[A-Za-z0-9]/.test(n)) break; // \d, \s, \Q…: not literal
      c = n;
      i++;
    } else if (c === "." && !/[*+?{]/.test(s[i + 1] ?? "")) {
      // a lone "." in a device name pattern is nearly always meant literally ("Bangle.js")
    } else if ("^$.([|)".includes(c)) break;
    else if ("?*{".includes(c)) { out = out.slice(0, -1); break; }
    else if (c === "+") break;
    out += c;
  }
  return out.replace(/\s+$/, "").replace(/\s*[(:]$|\s+-$/, ""); // "EPIX PRO - \\d+mm" → "EPIX PRO"
}

/** Index just past the group opening at `open`, or -1. */
function groupEnd(s: string, open: number): number {
  let depth = 0, cls = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (cls) { if (c === "]") cls = false; continue; }
    if (c === "[") cls = true;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The alternatives a regex can start with, with the first group distributed:
 * "(huawei band 2-|huawei band 2 pro-).*" → ["huawei band 2-.*", "huawei band 2 pro-.*"],
 * "^fenix (3 )?Chronos$" → ["fenix 3 Chronos", "fenix Chronos"]; leading lookarounds are dropped.
 */
export function regexAlternatives(re: string): string[] {
  return splitRegex(re, "|").flatMap((a) => {
    let t = a.replace(/^\(\?[a-z]+\)/, "").replace(/^\^/, "").replace(/\$$/, "");
    while (/^\(\?<?[=!]/.test(t)) { const e = groupEnd(t, 0); if (e < 0) return []; t = t.slice(e); }
    // first metacharacter outside escapes; only a plain or optional group there is expanded
    let i = 0;
    while (i < t.length && !"([.*+?{|$^".includes(t[i])) i += t[i] === "\\" ? 2 : 1;
    if (t[i] !== "(" || /^\(\?<?[=!]/.test(t.slice(i))) return [t];
    const e = groupEnd(t, i);
    if (e < 0) return [t];
    const head = t.slice(0, i), q = t[e];
    if (q === "*" || q === "+" || q === "{") return [head];
    const inner = t.slice(t.startsWith("(?:", i) ? i + 3 : i + 1, e - 1);
    const rest = t.slice(q === "?" ? e + 1 : e);
    return [...regexAlternatives(inner).flatMap((h) => regexAlternatives(head + h + rest)), ...(q === "?" ? regexAlternatives(head + rest) : [])];
  });
}

/** Advertised-name literals from a coordinator regex; fragments under 3 characters are dropped. */
export function bleNamesFromRegex(re: string, literal = false): string[] {
  if (literal) return [clean(re)].filter(Boolean);
  return [...new Set(regexAlternatives(re).map(literalPrefix).filter((n) => n.length >= 3))];
}

/** Every BLE name literal a coordinator declares. */
export const coordinatorBleNames = (c: Coordinator): string[] =>
  [...new Set([...(c.regex ? bleNamesFromRegex(c.regex, c.literal) : []), ...(c.names ?? [])])];

/** App display names that the website spells differently ("Xiaomi Smart Band 8" = "Mi Band 8"). */
export const DISPLAY_EQUIVALENTS: [RegExp, string][] = [
  [/^Xiaomi Smart Band\b/i, "Xiaomi Mi Band"],
  [/^Femometer Vinca II$/i, "Femometer Vinca 2"],
];

/**
 * Attach BLE names to website records: a coordinator matches the record whose
 * vendor+model (or model, when unique) spells its display name. A coordinator that
 * matches nothing (one class for a family, e.g. FitPro) gives each name literal to the one
 * record (of its manufacturer, when it says) whose model spells or ends with it.
 * Returns how many coordinators were matched.
 */
export function attachBleNames(records: DeviceRecord[], coords: { display: string; manufacturer?: string; names: string[] }[]): number {
  const full = new Map<string, DeviceRecord[]>(), byModel = new Map<string, DeviceRecord[]>();
  const add = (m: Map<string, DeviceRecord[]>, k: string, r: DeviceRecord) => { if (k) m.set(k, [...(m.get(k) ?? []), r]); };
  for (const r of records) {
    add(full, compact(`${r.vendor} ${r.model}`), r);
    for (const a of r.aliases ?? []) add(full, compact(a), r);
    add(byModel, compact(r.model), r);
  }
  const give = (r: DeviceRecord, names: string[], display?: string) => {
    r.identifiers = { ...r.identifiers, ble_names: [...(r.identifiers?.ble_names ?? []), ...names] };
    if (display && compact(display) !== compact(`${r.vendor} ${r.model}`) && compact(display) !== compact(r.model)) r.aliases = [...(r.aliases ?? []), display];
  };
  const one = (rs?: DeviceRecord[]) => (rs && new Set(rs).size === 1 ? rs[0] : undefined);
  let matched = 0;
  for (const c of coords) {
    if (!c.names.length) continue;
    const display = DISPLAY_EQUIVALENTS.reduce((d, [re, to]) => d.replace(re, to), c.display);
    const k = compact(display);
    const hit = one(full.get(k)) ?? one(byModel.get(k));
    if (hit) {
      // a family coordinator ("Huawei Watch GT 3 (Pro)") lists names that spell other records
      const own = c.names.filter((n) => {
        const other = one(full.get(compact(n)));
        if (!other || other === hit) return true;
        give(other, [n]);
        return false;
      });
      if (own.length) give(hit, own, c.display);
      matched++;
      continue;
    }
    const vendor = c.manufacturer ? compact(c.manufacturer) : "";
    let any = false;
    for (const n of c.names) {
      const l = compact(n);
      if (l.length < 3) continue;
      const rs = records.filter((r) => (!vendor || compact(r.vendor) === vendor) &&
        (compact(r.model) === l || compact(`${r.vendor} ${r.model}`) === l || (l.length >= 5 && compact(r.model).endsWith(l))));
      if (rs.length === 1) { give(rs[0], [n]); any = true; }
    }
    if (any) matched++;
  }
  return matched;
}

// ---------- fetch ----------

/** Shallow, blob-less, sparse clone of `url` with only `patterns` checked out. */
function sparseClone(url: string, patterns: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "odb-gadgetbridge-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  try {
    git("clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout", url, ".");
    git("sparse-checkout", "set", "--no-cone", ...patterns);
    git("checkout", "-q");
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

const files = (dir: string) => (readdirSync(dir, { recursive: true, withFileTypes: true }) as any[])
  .filter((d) => d.isFile()).map((d) => join(d.parentPath ?? d.path, d.name) as string);

const WEB_PATHS = ["/device_support.yml", "/docs/gadgets/**/*.md"];
const DEVICE_TYPE = "app/src/main/java/nodomain/freeyourgadget/gadgetbridge/model/DeviceType.java";
const STRINGS = "app/src/main/res/values/strings.xml";
const APP_PATHS = [`/${DEVICES_DIR}/**/*Coordinator*`, `/${DEVICES_DIR}/**/*Const*`, `/${DEVICE_TYPE}`, `/${STRINGS}`];

/** Records from a website checkout, then BLE names from an app checkout. */
export function fromCheckouts(web: string, app: string, date = today()) {
  const entries = parseDeviceSupport(readFileSync(join(web, "device_support.yml"), "utf8"));
  const pageOf = new Map<string, { page: string; p: GadgetPage }>();
  for (const f of files(join(web, "docs/gadgets")).filter((f) => f.endsWith(".md"))) {
    const p = parseGadgetPage(readFileSync(f, "utf8"));
    for (const k of p.headings.keys()) pageOf.set(k, { page: basename(f, ".md"), p });
  }
  const records = entries.flatMap((e) => {
    const at = pageOf.get(e.key);
    const r = at && fromGadget(e, at.page, at.p, date);
    return r ? [r] : [];
  });

  const classes = deviceTypeCoordinators(readFileSync(join(app, DEVICE_TYPE), "utf8"));
  const names = deviceTypeNames(readFileSync(join(app, STRINGS), "utf8"));
  const src = new Map<string, string>(), consts: Record<string, string> = {};
  for (const f of files(join(app, DEVICES_DIR)).filter((f) => /\.(java|kt)$/.test(f))) {
    const cls = basename(f).replace(/\.(java|kt)$/, "");
    const text = readFileSync(f, "utf8");
    src.set(cls, text);
    for (const [k, v] of Object.entries(stringConstants(text))) consts[`${cls}.${k}`] = v;
  }
  let withNames = 0;
  const coords = classes.flatMap((cls) => {
    const text = src.get(cls);
    if (!text) return [];
    const c = parseCoordinator(cls, text, consts);
    const ble = coordinatorBleNames(c);
    if (ble.length) withNames++;
    const display = c.nameRes ? names[c.nameRes] : undefined;
    return display ? [{ display, manufacturer: c.manufacturer, names: ble }] : [];
  });
  const matched = attachBleNames(records, coords);
  return { records, stats: { gadgets: entries.length, coordinators: classes.length, withNames, matched } };
}

const source: Source = {
  source: "gadgetbridge",
  name: "Gadgetbridge",
  url: "https://gadgetbridge.org/",
  license: "AGPL-3.0",
  async fetch() {
    const web = sparseClone(WEBSITE, WEB_PATHS);
    try {
      const app = sparseClone(APP, APP_PATHS);
      try {
        const { records, stats: s } = fromCheckouts(web, app);
        console.error(`gadgetbridge: ${s.gadgets} gadgets → ${records.length} records; ${s.coordinators} coordinators, ${s.withNames} with BLE name literals, ${s.matched} matched to a gadget`);
        return records;
      } finally {
        rmSync(app, { recursive: true, force: true });
      }
    } finally {
      rmSync(web, { recursive: true, force: true });
    }
  },
};
export default source;
