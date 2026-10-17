// LineageOS supported devices: one YAML file per device (or per hardware variant,
// <codename>_variant<N>.yml) in github.com/LineageOS/lineage_wiki/_data/devices, the data
// behind wiki.lineageos.org/devices. Fields used: vendor, name, models (retail model
// numbers), type, codename, variant, soc, maintainers, versions, current_branch.
// The codename goes to aliases, not identifiers.sku: it is not printed on the device,
// LineageOS and postmarketOS use different codenames for the same phone, and short ones
// ("m0", "flo") would make false exact-identifier matches across vendors.
//
// Status: every listed device is "open-firmware" — LineageOS is a free replacement OS and
// its device tree, kernel and build exist for it. A device without maintainers is
// "discontinued" upstream (no new official builds, last version = current_branch); that
// is said in the project name, not by lowering the status, because the free OS was built
// and its sources remain buildable.
//
// The vendor and model normalisation below is exported and shared with the postmarketOS
// importer so that the same phone gets the same id in both sources.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, firstMatch, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";
import YAML from "yaml";

const REPO = "LineageOS/lineage_wiki", BRANCH = "main";
const DEVICE_FILE = /^_data\/devices\/([^/]+)\.yml$/;

// ---------- shared vendor / model normalisation (also used by postmarketos.ts) ----------

const key = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** Canonical display names for vendors spelled differently across sources. */
export const VENDORS: Record<string, string> = Object.fromEntries(
  [
    "Acer", "Alcatel", "Amazon", "Apple", "ASUS", "AYN", "Banana Pi", "BlackBerry", "BQ", "Dell", "Essential",
    "F(x)tec", "Fairphone", "Gigaset", "Google", "Hardkernel", "HTC", "Huawei", "Jolla", "Kobo", "LeEco",
    "Lenovo", "LG", "Meizu", "Microsoft", "Motorola", "Nextbit", "Nokia", "Nothing", "Nubia", "NVIDIA",
    "OnePlus", "OPPO", "PINE64", "Purism", "Radxa", "Raspberry Pi", "Razer", "Realme", "Samsung", "Sharp",
    "SHIFT", "Sony", "Sony Ericsson", "TrekStor", "Vivo", "Wileyfox", "Xiaomi", "YU", "ZTE", "ZUK",
  ].map((v) => [key(v), v]),
);
// Other spellings of the same company.
VENDORS[key("Odroid")] = "Hardkernel"; // ODROID is Hardkernel's product line
VENDORS[key("BananaPi")] = "Banana Pi";
VENDORS[key("fxtec")] = "F(x)tec";

export const normVendor = (v: unknown): string => {
  const c = clean(v);
  return VENDORS[key(c)] ?? c;
};

/** Words that only qualify a carrier, region, radio or build variant of the same model. */
const QUALIFIER = new RegExp(
  "^(?:" +
    [
      "at&t", "t-mobile", "tmo", "verizon", "sprint", "us cellular", "china telecom", "china mobile", "china unicom",
      "international", "intl", "global", "china", "india", "korea", "korean", "canada", "canadian", "japan",
      "europe", "eu", "eea", "us", "usa", "north america", "latam", "other", "unlocked", "us unlocked", "eu unlocked",
      "gsm unlocked", "gsm", "cdma", "umts", "lte", "lte-a", "3g", "4g", "5g", "wi-?fi", "wifi \\+ ir", "wi-?fi \\+ ir",
      "ir", "dual sim", "single sim", "duos", "snapdragon", "exynos", "mediatek", "qualcomm", "eng bl", "emmc only",
      "low ram", "repartitioned", "\\d{3,4}p", "samsung camera", "sony camera",
      "broadcom wi-fi", "realtek wi-fi", "bluetooth", "dirtysanta", "android tv", "tablet",
      "international 3g", "international lte", "international dual sim",
    ].join("|") +
    ")$",
  "i",
);

/** A retail model number such as SM-G960F, ZS660KL, G710N, XT1924-3 (letters and digits, 4+ chars). */
const SKU_LIKE = /^(?=[A-Z0-9/+-]*\d)(?=[A-Z0-9/+-]*[A-Z])[A-Z0-9][A-Z0-9/+-]{3,}$/;
/** SoC part numbers (S905X3) also appear in qualifiers. */
const SOC_LIKE = /^(?:S9\d\d[A-Z0-9-]*|SM\d{4}|MSM\d{4}|SDM\d{3}|MT\d{4}|RK\d{4})$/i;

/** True when a "(…)" or "[…]" suffix only names a carrier/region/radio/SKU variant. */
export function isQualifier(inner: string): boolean {
  const parts = clean(inner).split(/\s*(?:,|\/|\s-\s|\bor\b)\s*/).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => QUALIFIER.test(p) || SKU_LIKE.test(p) || SOC_LIKE.test(p) || (parts.length > 1 && /^(?:[A-Z]{1,3}\d?|\d{1,2}[A-Z]{0,2}|[A-Z]\d[A-Z]?)$/.test(p)));
}

/**
 * Display model name as both sources should spell it: the vendor prefix is removed
 * ("Samsung Galaxy S9" → "Galaxy S9"), trailing carrier/region/radio/SKU qualifiers are
 * dropped ("Galaxy S III (AT&T)" → "Galaxy S III", "Galaxy Tab S7 (Wi-Fi)" → "Galaxy Tab S7",
 * "ODROID-C4 (S905X3, eMMC Only) [Android TV]" → "ODROID-C4") while years and generations
 * that name a different device are kept ("Galaxy A5 (2016)", "Phone (1)", "One (M8)").
 */
export function normModel(vendor: string, name: string): string {
  let m = clean(name).replace(/\\"/g, '"').replace(/^The\s+/i, "");
  // vendor prefix, possibly repeated ("dell Dell Wyse 3020"); only on a word boundary and
  // not when only a qualifier would remain ("Fairphone (Gen. 6)")
  for (let changed = true; changed; ) {
    changed = false;
    for (const v of [vendor, normVendor(vendor)]) {
      const rest = m.slice(v.length + 1).trim();
      if (v && m.toLowerCase().startsWith(v.toLowerCase() + " ") && rest && !rest.startsWith("(")) { m = rest; changed = true; }
    }
  }
  if (key(vendor) === "samsung") m = m.replace(/\bS(II|III)\b/g, "S $1"); // "Galaxy SIII" → "Galaxy S III"
  m = m.replace(/\s*\((\d+(?:\.\d+)?)\s*(?:inch|in|")\)/gi, " $1"); // "Galaxy Tab 2 (10.1 inch)" → "Galaxy Tab 2 10.1"
  for (let changed = true; changed; ) {
    changed = false;
    const t = m.match(/^(.*\S)\s*[([]([^()[\]]*)[)\]]$/);
    if (t && isQualifier(t[2])) { m = t[1]; changed = true; continue; }
    const w = m.match(/^(.*\S)\s+(Wi-?Fi|LTE|International|Global)$/i); // "Galaxy Tab 4 8.0 Wi-Fi", "Galaxy S III LTE"
    if (w) { m = w[1]; changed = true; }
  }
  return clean(m);
}

// ---------- LineageOS ----------

/** wiki `type` → category. */
export const LINEAGE_TYPES: [RegExp, string][] = [
  [/^phone|foldable/i, "phone"],
  [/^tablet/i, "tablet"],
  [/set top box/i, "media-player"],
  [/^tv$/i, "tv"],
  [/game console/i, "game-console"],
  [/devkit/i, "single-board"],
];
export const lineageCategory = (type: unknown) => firstMatch(LINEAGE_TYPES, clean(type), "other");

export const lineageUrl = (codename: string, variant?: unknown) =>
  `https://wiki.lineageos.org/devices/${encodeURIComponent(codename)}/${variant != null ? `variant${clean(variant)}/` : ""}`;

/** One device YAML (parsed) → record, or null when vendor/name/codename is missing. */
export function fromDevice(d: Record<string, any> | null, date = today()): DeviceRecord | null {
  if (!d || typeof d !== "object") return null;
  const vendor = normVendor(d.vendor), name = clean(d.name), codename = clean(d.codename);
  if (!vendor || !name || !codename) return null;
  const model = normModel(vendor, name) || name;
  const models = Array.isArray(d.models) ? d.models.map(clean).filter(Boolean) : [];
  const maintained = Array.isArray(d.maintainers) && d.maintainers.length > 0;
  const branch = clean(d.current_branch) || clean(Array.isArray(d.versions) ? d.versions.at(-1) : "");
  const label = maintained ? `LineageOS ${branch}`.trim() : `LineageOS, discontinued${branch ? ` after ${branch}` : ""}`;
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases: [model !== name ? name : "", codename],
    category: lineageCategory(d.type),
    identifiers: { sku: models, chips: [clean(d.soc)] },
    status: "open-firmware",
    projects: [{ name: `${label} (${codename}${d.variant != null ? ` variant ${clean(d.variant)}` : ""})`, url: lineageUrl(codename, d.variant), kind: "firmware", license: "Apache-2.0" }],
    provenance: { sources: ["lineageos"] },
    updated: date,
  };
}

export function parseDeviceYaml(text: string): Record<string, any> | null {
  try {
    const v = YAML.parse(text, { uniqueKeys: false, schema: "failsafe" }); // keep "24.0" a string
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const source: Source = {
  source: "lineageos",
  name: "LineageOS Wiki",
  url: "https://wiki.lineageos.org/devices/",
  license: "CC-BY-SA-3.0",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => DEVICE_FILE.test(p));
    const out = await mapLimit(files, 16, async (p) => fromDevice(parseDeviceYaml(await githubRaw(REPO, BRANCH, p))));
    const ok = out.filter((r): r is DeviceRecord => !!r);
    console.error(`lineageos: ${files.length} device files, ${files.length - ok.length} unusable`);
    return ok;
  },
};
export default source;
