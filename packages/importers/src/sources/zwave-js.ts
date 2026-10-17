// Z-Wave JS device configuration database: one JSON5-ish file per device in
// github.com/zwave-js/zwave-js/packages/config/config/devices/<manufacturerId>/<file>.json
// with "manufacturer", "label" (the model number, sometimes "A / B" variants or a list of
// {$if, value} conditionals), "description" and devices[{productType, productId}].
// Z-Wave product ids have no field of their own in the schema: they are stored in
// identifiers.sku as "zwave:<manufacturerId>:<productType>:<productId>" so they are searchable.
// Z-Wave is a published standard; Z-Wave JS is the open driver that controls these devices.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, firstMatch, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "zwave-js/zwave-js", BRANCH = "master";
const DIR = "packages/config/config/devices";
const DEVICE_FILE = /^packages\/config\/config\/devices\/(0x[0-9a-f]{4})\/[^/]+\.json$/;

/** Device files may carry // and /* *\/ comments and trailing commas: strip them, then JSON. */
export function parseJsonc(text: string): any {
  let out = "", quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += n ?? ""; i++; } else if (c === quote) quote = "";
    } else if (c === '"') { quote = c; out += c; }
    else if (c === "/" && n === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; }
    else if (c === "/" && n === "*") { const end = text.indexOf("*/", i + 2); i = end < 0 ? text.length : end + 1; }
    else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// ---------- vendor names ----------

// Spelling used by the other sources (and by the brand itself) for names Z-Wave JS
// writes as the Z-Wave Alliance registration or legal entity.
const VENDOR_ALIASES: Record<string, string> = {
  "fibargroup": "Fibaro",
  "aeon labs": "Aeotec",
  "aeotec": "Aeotec",
  "shelly europe": "Shelly",
  "popp & co": "Popp",
  "z-wave.me": "Z-Wave.Me",
  "eurotronic": "Eurotronic",
  "eurotronics": "Eurotronic",
  "act - advanced control": "ACT",
  "adtrustmedia llc dba: ezlo": "eZLO",
  "applied micro electronics \"ame\"": "AME",
  "abus security-center": "ABUS",
  "dawon": "Dawon DNS",
  "samsung electronics": "Samsung",
  "secure meters": "Secure Meters",
  "newone": "New One",
  "ultrapro": "UltraPro",
  "defaro": "DEFARO",
  "hab home intelligence": "HAB Home Intelligence",
  "satco products": "Satco",
  "mobilus motor": "Mobilus",
  "kddi": "KDDI",
  "remote": "Remote Technologies",
  "technisat digital": "TechniSat",
  "cytech technology pre": "Cytech",
  "systemair sverige": "Systemair",
  "hornbach baumarkt": "HORNBACH",
  "kjell & co elektronik": "Kjell & Co",
  "queenlock ind.": "Queenlock",
  "sony mobile communications": "Sony",
  "nexa trading": "Nexa",
};

const LEGAL = /(?:[,\s]+(?:co\.?,?\s*ltd\.?|co\.|company|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|gmbh(?:\s*(?:&|und)?\s*co\.?\s*kg)?|kg|ag(?:\s*\+\s*co)?|ab|as|a\/s|b\.?v\.?|nv|oy|s\.?p\.?a\.?|srl|sas|s\.l\.u\.?|ohg|pte\.?|pty|pcl|lda|unipessoal|pvt|lc|spółka z o\.o\.))+$/i;
const CITY = /^(shenzhen|wenzhou|hangzhou|guangzhou|dongguan|ningbo|nanjing)\s+/i;

/**
 * "Philio Technology Corp" → "Philio", "Shenzhen Neo Electronics Co., Ltd." → "Neo",
 * "First Alert (BRK Brands Inc)" → "First Alert", "Enerwave / Wenzhou MTLC…" → "Enerwave".
 */
export function zwaveVendor(raw: string): string {
  let v = clean(raw).replace(/\bA\/S$/i, "").split(/\s*\/\s*/)[0]; // "GE/Enbrighten", "Contec / Da Vinci"
  if (/^dmp\b/i.test(v)) v = "DMP";
  v = v.replace(/\s*\([^)]*\)/g, " ").trim();         // "(UK)", "(RTC)", "(former …)"
  for (let prev = ""; prev !== v;) { prev = v; v = v.replace(LEGAL, "").trim(); }
  let city = false;
  if (CITY.test(v) && v.split(" ").length > 2) { v = v.replace(CITY, ""); city = true; }
  // the generic tail of a company name, kept when it is all that is left
  const tail = city ? /\s+(intelligent technology|smart technology|technology|technologies|electronics|electric appliances|m&e)$/i
    : /\s+(technology|technologies|tech(?= hk$)|hk)$/i;
  for (let prev = ""; prev !== v;) { prev = v; const t = v.replace(tail, "").trim(); if (t) v = t; }
  v = v.replace(/\(hk\)$/i, "").replace(/\s+(?:technology|company)$/i, "").trim() || v;
  return VENDOR_ALIASES[v.toLowerCase()] ?? v;
}

// ---------- category ----------

// Ordered: the first pattern matching "<description> <label>" wins.
export const ZWAVE_CATEGORIES: [RegExp, string][] = [
  [/\b(thermostat|thermostatic|trv|radiator|hvac|heat ?pump|air ?condition(er|ing)?|boiler|water heater|heating|fan ?coil|humidifier|dehumidifier|climate|ventilation|air purifier)s?\b/i, "appliance"],
  [/\b(plug|smartplug|outlet|socket|receptacle|power ?strip|smart strip)s?\b/i, "smart-plug"],
  [/\b(lock|deadbolt|lever|latch|mortise|door handle|cylinder|rim trim)s?\b/i, "other"],
  [/\b(camera|cam|doorcam)s?\b|cam\+?$/i, "ip-camera"],
  // motorised covers, valves, sirens, doorbells: no closer category
  [/\b(shutter|rollershutter|blind|shade|curtain|drapery|awning|skylight|tubular motor|motor|garage door|gate|valve|shut-?off|flow stop|leakage stopper|siren|strobe|doorbell|door bell|chime|sprinkler|irrigation|pool)s?\b/i, "other"],
  [/\b(gateway|hub|bridge|repeater|range extender|extender|usb controller|z-?wave controller|static controller|central unit|central home unit|control unit|system controller|automation controller|home controller|home center|base station|home station|controller stick|z-?stick|smartstick|dongle|serial api|usb|security (panel|system|pad)|alarm (panel|system)|control panel|iq ?panel|set ?top box|router|gpon|ont|xdsl|cpe|interface module|radio module)s?\b|^(z-?wave )?controller$/i, "hub"],
  [/\b(remote|keypad|key ?fob|button|scene (controller|switch)|scene controller|wall controller|panic|push ?button|touch panel|wallmote|nanomote|mote)s?\b/i, "switch"],
  [/\bdimm(er|able|ing)s?\b/i, "light"],
  [/\b(switch|relay|multi-?relay|appliance module|on\/off module|micro module|(double )?smart module|implant|din[- ]rail|actuator|power module|load control(ler)?|fan (speed )?control(ler)?|timeswitch|timer|digital outputs)(e?s)?\b/i, "switch"],
  [/\b(bulb|lamp|light|lighting|led|rgbw?|luminaire|downlight|spotlight|night ?light|illuminator|chandelier)s?\b/i, "light"],
  [/sensors?\b|\b(detector|meter|monitor|thermometer|hygrometer|leak|flood|smoke|carbon monoxide|co alarm|co2|motion|pir|occupancy|presence|contact|door\/window|temperature|humidity|illuminance|tilt|vibration|shock|glass ?break|water alarm|weather|rain|air quality|voc|pm2\.?5)s?\b/i, "sensor"],
];

export const zwaveCategory = (description: string, label = "") => firstMatch(ZWAVE_CATEGORIES, clean(`${description} ${label}`), "other");

// ---------- records ----------

const hex4 = (v: unknown): string | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? `0x${n.toString(16).padStart(4, "0")}` : null;
};

/**
 * A field that is a string or a list of conditionals [{$if, value}, …, "default"].
 * Returns the default plus each conditional value; a condition "productId === 0x…" ties
 * that value to one product id.
 */
export function conditional(v: unknown): { default: string; variants: { value: string; productId?: string }[] } {
  if (typeof v === "string") return { default: clean(v), variants: [] };
  if (!Array.isArray(v)) return { default: "", variants: [] };
  let def = "";
  const variants: { value: string; productId?: string }[] = [];
  for (const x of v) {
    if (typeof x === "string") def = clean(x);
    else if (x && typeof x.value === "string") {
      const pid = String(x.$if ?? "").match(/^\s*productId\s*===\s*(0x[0-9a-f]+)\s*$/i)?.[1];
      variants.push({ value: clean(x.value), productId: pid ? hex4(pid)! : undefined });
    }
  }
  return { default: def || variants.at(-1)?.value || "", variants };
}

/** "YRL226 / YRL256" → ["YRL226", "YRL256"]; a slash without spaces ("FGWPA/B-111") is kept. */
export const labelVariants = (label: string) => label.split(/\s+\/\s+/).map(clean).filter(Boolean);

/** One device file → records (one, or one per productId-conditional label). */
export function fromDeviceFile(path: string, json: any, date = today()): DeviceRecord[] {
  const dir = path.match(DEVICE_FILE)?.[1];
  if (!dir || !json || typeof json !== "object") return [];
  const vendorRaw = conditional(json.manufacturer).default;
  const label = conditional(json.label);
  const description = conditional(json.description).default;
  if (!vendorRaw || !label.default) return [];
  const vendor = zwaveVendor(vendorRaw);
  const mid = hex4(json.manufacturerId) ?? dir;
  const devices: { pt: string; pid: string }[] = (Array.isArray(json.devices) ? json.devices : [])
    .map((d: any) => ({ pt: hex4(d?.productType), pid: hex4(d?.productId) }))
    .filter((d: any) => d.pt && d.pid);
  const url = `https://github.com/${REPO}/blob/${BRANCH}/${path}`;
  const zwId = (d: { pt: string; pid: string }) => `zwave:${mid}:${d.pt}:${d.pid}`;

  // Labels bound to a productId become their own record with that product's ids.
  const byPid = label.variants.filter((v) => v.productId);
  const otherVariants = label.variants.filter((v) => !v.productId).map((v) => v.value);
  const groups: { label: string; devices: typeof devices; extra: string[] }[] = [];
  const bound = new Set(byPid.map((v) => v.productId));
  for (const v of byPid) groups.push({ label: v.value, devices: devices.filter((d) => d.pid === v.productId), extra: [] });
  const rest = devices.filter((d) => !bound.has(d.pid));
  if (rest.length || !groups.length) groups.push({ label: label.default, devices: rest, extra: otherVariants });

  return groups.map((g) => {
    const variants = labelVariants(g.label);
    const model = variants[0];
    return {
      id: makeId(vendor, model),
      vendor,
      model,
      aliases: [
        ...variants.slice(1).map((v) => `${vendor} ${v}`),
        ...(description ? [`${vendor} ${description}`] : []),
      ],
      category: zwaveCategory(description, g.label),
      identifiers: { sku: [...new Set([...variants, ...g.extra, ...g.devices.map(zwId)])] },
      status: "controllable",
      summary: description ? `${description} (Z-Wave).` : undefined,
      interfaces: [{ name: "Z-Wave", transport: "zwave", status: "documented", spec: url }],
      projects: [{ name: "Z-Wave JS device config", url, kind: "driver", license: "MIT" }],
      provenance: { sources: ["zwave-js"] },
      updated: date,
    } as DeviceRecord;
  });
}

const source: Source = {
  source: "zwave-js",
  name: "Z-Wave JS",
  url: "https://devices.zwave-js.io/",
  license: "MIT",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => DEVICE_FILE.test(p));
    let bad = 0;
    const out = await mapLimit(files, 12, async (p) => {
      try {
        return fromDeviceFile(p, parseJsonc(await githubRaw(REPO, BRANCH, p)));
      } catch (e) {
        bad++;
        console.error(`zwave-js: ${p}: ${(e as Error).message}`);
        return [];
      }
    });
    console.error(`zwave-js: ${files.length} device files under ${DIR}, ${bad} unreadable`);
    return out.flat();
  },
};
export default source;
