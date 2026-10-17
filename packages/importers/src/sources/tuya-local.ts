// tuya-local supported devices: one YAML config per device in
// github.com/make-all/tuya-local/custom_components/tuya_local/devices/*.yaml, mapping the
// Tuya data points (DPs) of the device to Home Assistant entities over the local Tuya
// LAN protocol (stock firmware, no cloud). Each config has a generic `name` ("Dehumidifier")
// and optional `products` [{id, manufacturer, model, model_id, name}], `id` being the Tuya
// product key. One record per product with a manufacturer; configs that list no
// manufacturer get a brand only when their file name starts with a brand that tuya-local
// lists elsewhere and is followed by a model code ("goldair_gpcv405_heater"), else they
// are skipped (no "Generic" records). Category from the device name, then the primary entity.
import YAML from "yaml";
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, firstMatch, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "make-all/tuya-local", BRANCH = "main";
const DIR = "custom_components/tuya_local/devices/";
const CONFIG = /^custom_components\/tuya_local\/devices\/[^/]+\.ya?ml$/;

export interface TuyaProduct { id?: string; manufacturer?: string; model?: string; model_id?: string; name?: string }
export interface TuyaConfig { file: string; name: string; entity: string; entityClass?: string; products: TuyaProduct[] }

/** The parts of one device YAML this importer reads, or null when unparsable. */
export function parseConfig(file: string, text: string): TuyaConfig | null {
  let y: any;
  try { y = YAML.parse(text); } catch {
    // a syntax error deep in the DP mappings: the head (name, products) is enough
    const head = text.split(/^entities:/m)[0];
    try { y = { ...YAML.parse(head), entities: [{ entity: text.match(/^entities:\s*\n\s*-\s*entity:\s*(\w+)/m)?.[1] }] }; } catch { return null; }
  }
  if (!y || typeof y !== "object" || !y.name) return null;
  const first = Array.isArray(y.entities) ? y.entities[0] : y.primary_entity;
  const products = (Array.isArray(y.products) ? y.products : []).filter((p: any) => p && typeof p === "object").map((p: any) => ({
    id: clean(p.id) || undefined, manufacturer: clean(p.manufacturer) || undefined,
    model: clean(p.model) || undefined, model_id: clean(p.model_id) || undefined, name: clean(p.name) || undefined,
  }));
  return { file: file.split("/").pop()!, name: clean(y.name), entity: clean(first?.entity), entityClass: clean(first?.class) || undefined, products };
}

// ---------- category ----------

// Ordered: the first pattern matching the device name wins.
export const NAME_CATEGORIES: [RegExp, string][] = [
  [/\b(pet|fish|cat|bird|water) (feeder|fountain)|\bfeeder|litter ?box|pet toilet/i, "appliance"],
  [/camera|video (doorbell|intercom)/i, "ip-camera"],
  [/robot vacuum|vacuum and mop|vacuum robot|pool cleaning robot/i, "vacuum-robot"],
  [/thermostat|(temperature|humidity|heating|heat pump) controller|radiator (valve|controller)|pilot wire|(ac|hvac|fan coil) controller|climate (remote|switch)/i, "other"],
  // energy, pool and garden equipment
  [/\bev\b|wallbox|wall charger|battery|solar (inverter|charg|panel)|inverter|power station|chlorinator|chlorine|electrolyzer|pool pump|irrigation|sprinkler|water(ing)? (timer|valve|device)|tap timer|valve/i, "other"],
  [/\b(fan|light|heater|curtain|cover|scene|wall|ir|dimmer)s? (and light )?(switch|controller|regulator|remote)|fan speed switch|switchboard|lightswitch/i, "switch"],
  [/(washing|washer|dish ?washer|\bdryer|oven|cooker|fryer|kettle|coffee|espresso|stove|kitchen hood|range hood|extractor hood|fridge|refrigerator(?! thermometer)|freezer|ice (cube|maker)|milk maker|sous vide|grill|smoker|beverage center|wine (cooler|cabinet)|water (purifier|dispenser|chiller)|bidet)/i, "appliance"],
  [/temperature alarm/i, "sensor"],
  [/heater|heating|radiator|fireplace|air ?con|\bac\b|heat ?pump|\bfan\b|fans\b|purifier|humidifier|diffuser|air cooler|ventilat|towel (warmer|rail|rack|radiator)|blanket|bed warmer|sauna|spa\b|steam room|water heater|hot water|boiler|heated mirror|pet sofa|laundry rack|drying rack|aroma|vacuum/i, "appliance"],
  [/plug|socket|outlet|power ?(strip|board|point)|powerstrip|powerboard/i, "smart-plug"],
  [/dimmer/i, "switch"],
  [/light|\blamp|bulb|\bled\b|downlight|projector|backlight|strip\b/i, "light"],
  [/switch|relay|breaker|button|fingerbot|remote|keypad|timer\b/i, "switch"],
  [/sensor|detector|monitor|meter|thermometer|hygrometer|weather|gas alarm|co2|air quality|scale|probe|water quality/i, "sensor"],
];

const ENTITY_CATEGORIES: Record<string, string> = {
  climate: "appliance", fan: "appliance", humidifier: "appliance", water_heater: "appliance",
  light: "light", switch: "switch", sensor: "sensor", binary_sensor: "sensor", camera: "ip-camera", remote: "hub",
  vacuum: "appliance", // "robot vacuum" is caught by name
};

export function tuyaCategory(name: string, entity: string, entityClass?: string, model = ""): string {
  if (/\btrv/i.test(model)) return "other"; // thermostatic radiator valves named "Radiator"
  const byName = firstMatch(NAME_CATEGORIES, name, "");
  if (byName) return byName;
  if (entity === "switch" && entityClass === "outlet") return "smart-plug";
  return ENTITY_CATEGORIES[entity] ?? "other";
}

// ---------- vendor / model ----------

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Not brands: placeholders some configs use as manufacturer. */
const NOT_BRANDS = new Set(["smart", "generic", "unknown", "unknow", "oem", "noname", "nobrand", "tuya", "simple"]);
/** Upstream typos that would otherwise split one brand in two. */
const SPELLING: Record<string, string> = { "briliiant smart": "Brilliant Smart", blumfeltd: "Blumfeldt", "fancy leds": "Fancy LED", sonnenkonig: "Sonnenkoenig", "mercator ikuu": "Mercator Ikuü" };

/** "Beok / Avatto" or "Yagusmart/Zemismart": a product sold under several brands. */
export const splitBrands = (m: string) => m.split("/").map(clean).filter(Boolean);

/**
 * One display spelling per brand across all configs (most frequent; on a tie the one that
 * is not all capitals), keyed by the compact spelling.
 */
export function brandSpellings(configs: TuyaConfig[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const c of configs) for (const p of c.products) for (const b of splitBrands(p.manufacturer ?? "")) {
    const s = SPELLING[b.toLowerCase()] ?? b;
    const k = compact(s);
    if (!k || NOT_BRANDS.has(k)) continue;
    const m = counts.get(k) ?? new Map<string, number>();
    m.set(s, (m.get(s) ?? 0) + 1);
    counts.set(k, m);
  }
  const caps = (s: string) => s === s.toUpperCase();
  const out = new Map<string, string>();
  for (const [k, m] of counts) out.set(k, [...m].sort((a, b) => b[1] - a[1] || Number(caps(a[0])) - Number(caps(b[0])) || a[0].localeCompare(b[0]))[0][0]);
  return out;
}

/**
 * Brand and model code from a file name "<brand>_<code…>_<type>.yaml": the brand is the
 * shortest run of leading tokens spelling a known brand, the model the tokens right after
 * it that contain a digit ("aquatech_x6_water_heater" → Aquatech X6). Null when either is missing.
 */
export function fromFileName(file: string, brands: Map<string, string>): { vendor: string; model?: string } | null {
  const t = file.replace(/\.ya?ml$/, "").split("_").filter(Boolean);
  for (let n = 1; n < Math.min(4, t.length); n++) {
    const vendor = brands.get(compact(t.slice(0, n).join("")));
    if (!vendor) continue;
    const code: string[] = [];
    for (const tok of t.slice(n)) { if (!/\d/.test(tok)) break; code.push(tok.toUpperCase()); }
    return { vendor, model: code.length ? code.join(" ") : undefined };
  }
  return null;
}

/**
 * "Duux" + "Duux Blade Fan" → "Blade Fan" (a model that is only a number keeps the brand),
 * and drop a trailing note on a config variant: "BHP-6000 (°F)", "Too (MEET firmware)".
 */
export function modelName(vendor: string, model: string): string {
  const v = vendor + " ";
  const m = model.toLowerCase().startsWith(v.toLowerCase()) && /[a-z]/i.test(model.slice(v.length)) ? model.slice(v.length) : model;
  return m.replace(/\s*\([^)]*(°|firmware|variant|based on|mapped)[^)]*\)$/i, "") || m;
}

/**
 * Install route (SPEC R1): nothing changes on the device, which keeps its stock firmware;
 * tuya-local runs in Home Assistant and needs the device id and local key (filled in from
 * the Tuya cloud during setup, or found with the steps of DEVICE_DETAILS.md).
 */
export const TUYA_LOCAL_INSTALL: InstallRoute = {
  project: "tuya-local",
  method: "host-software",
  guide: `https://github.com/${REPO}`,
  difficulty: "medium",
  tools: ["Home Assistant (tuya-local is installed through HACS)", "Tuya / Smart Life app account (to get the device's local key)"],
  brick_risk: "none",
  reversible: "yes",
  notes: "No flashing: set the device up in the Tuya or Smart Life app first; tuya-local then controls it on your network with its device id and local key. Re-pairing in the app changes the local key.",
};

const fileUrl = (file: string) => `https://github.com/${REPO}/blob/${BRANCH}/${DIR}${encodeURIComponent(file)}`;

/** Records of one config (one per product and brand). `brands` comes from brandSpellings. */
export function fromConfig(c: TuyaConfig, brands: Map<string, string>, date = today()): DeviceRecord[] {
  const byFile = fromFileName(c.file, brands);
  const products: TuyaProduct[] = c.products.length ? c.products : [{}];
  const out: DeviceRecord[] = [];
  for (const p of products) {
    let vendors = splitBrands(p.manufacturer ?? "").map((b) => brands.get(compact(SPELLING[b.toLowerCase()] ?? b))).filter((b): b is string => !!b);
    if (!vendors.length && !p.manufacturer && byFile) vendors = [byFile.vendor];
    if (!vendors.length) continue; // no identifiable brand
    const name = p.name ?? c.name;
    // a code in the file name belongs to the brand in the file name
    const fileCode = byFile && vendors.includes(byFile.vendor) ? byFile.model : undefined;
    // Without a model, a product name override ("iQ Ceramic", "Glass wall switch 2-gang")
    // is the most specific name, then a code from the file name. The generic config name
    // ("Heater") is never used as a model: it would merge different products of a brand.
    const model = p.model ?? p.model_id ?? p.name ?? fileCode;
    if (!model) continue;
    for (const vendor of vendors) {
      const m = modelName(vendor, model);
      out.push({
        id: makeId(vendor, m),
        vendor,
        model: m,
        aliases: m !== model ? [`${vendor} ${model}`] : [],
        category: tuyaCategory(name, c.entity, c.entityClass, model),
        identifiers: { sku: [...(p.model_id && p.model_id !== m ? [p.model_id] : []), ...(p.id ? [`tuya:${p.id}`] : [])] },
        status: "controllable",
        summary: `${name}, controlled locally over the Tuya protocol by tuya-local (stock firmware, no cloud).`,
        projects: [{ name: "tuya-local", url: fileUrl(c.file), kind: "integration", license: "MIT" }],
        install: [{ ...TUYA_LOCAL_INSTALL, tools: [...TUYA_LOCAL_INSTALL.tools!] }],
        provenance: { sources: ["tuya-local"] },
        updated: date,
      });
    }
  }
  return out;
}

export function fromConfigs(configs: TuyaConfig[], date = today()): DeviceRecord[] {
  const brands = brandSpellings(configs);
  return configs.flatMap((c) => fromConfig(c, brands, date));
}

const source: Source = {
  source: "tuya-local",
  name: "tuya-local",
  url: `https://github.com/${REPO}`,
  license: "MIT",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => CONFIG.test(p));
    const parsed = await mapLimit(files, 16, async (p) => parseConfig(p, await githubRaw(REPO, BRANCH, p)));
    const configs = parsed.filter((c): c is TuyaConfig => !!c);
    const recs = fromConfigs(configs);
    const covered = new Set(recs.map((r) => r.projects![0].url));
    console.error(`tuya-local: ${files.length} configs, ${files.length - configs.length} unparsable, ${configs.length - covered.size} without an identifiable brand/model`);
    return recs;
  },
};
export default source;
