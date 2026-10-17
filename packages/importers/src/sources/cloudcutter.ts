// tuya-cloudcutter device profiles (github.com/tuya-cloudcutter/tuya-cloudcutter.github.io):
// one devices/<slug>.json per Tuya device that the cloudcutter exploit can flash over the
// air, without opening it, with OpenBeken or ESPHome (LibreTiny). A device file gives
// manufacturer, name ("<model> <description> v<tuya firmware>"), the profiles it works with
// (profiles/<slug>.json, whose firmware.chip is the MCU) and, for most, the Tuya
// device_configuration (module, pins, light category code).
// There is no category field upstream: it is derived from the name and the Tuya config.
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, firstMatch, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "tuya-cloudcutter/tuya-cloudcutter.github.io", BRANCH = "master";
const DEVICE_FILE = /^devices\/([^/]+)\.json$/;
const PROFILE_FILE = /^profiles\/([^/]+)\.json$/;

// ---------- Tuya helpers (also used by openbeken.ts) ----------

/**
 * Upstream manufacturer spellings → the brand the other importers (Tasmota, ESPHome take the
 * first word of a title) use, so the same device gets the same id. Keys are lowercase.
 * "Tuya Generic" is a white-label Tuya device: the platform is the only brand known.
 */
export const TUYA_VENDORS: Record<string, string> = {
  "tuya generic": "Tuya",
  "generic tuya": "Tuya",
  "arlec grid connect": "Arlec",
  "merkury innovations": "Merkury",
  "globe electric": "Globe",
  "feit electric": "Feit",
  "mirabella genio": "Mirabella",
  "brilliant smart": "Brilliant",
  "lsc smart connect": "LSC",
  "smart life": "Tuya",
  "smartlife": "Tuya",
};

export const tuyaVendor = (v: unknown): string => {
  const c = clean(v);
  return TUYA_VENDORS[c.toLowerCase()] ?? c;
};

/** Trailing Tuya firmware version: "Smart Plug v1.1.8", "Bulb 1.3.21", "OTA2 v2.1.3". */
export const stripFirmwareVersion = (s: string) => clean(s).replace(/\s+(?:v|ver\.?\s*)?\d+\.\d+\.\d+$/i, "").trim();

/**
 * Does this word look like a model code (SP111, BW-CLT1, 8044, DCF4002WHA) rather than a
 * rating, a lamp base or a count (16W, 10A, E27, GU10, A19, 3-Gang)?
 */
export function isModelCode(w: string): boolean {
  if (!/\d/.test(w) || w.length < 3) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/+-]*$/.test(w)) return false;
  if (/^\d+(\.\d+)?(w|a|v|k|kw|m|cm|mm|in|ft|lm|ch|g|gb|mb|hz|ma|mah)$/i.test(w)) return false;
  if (/^(e\d{2}|gu\d{1,2}|mr\d{2}|a\d{2}|br\d{2}|par\d{2}|g\d{2}|b\d{2}|c\d{2}|st\d{2}|t\d{1,2})$/i.test(w)) return false;
  if (/^\d+-?(gang|way|outlet|ch|in-1|pack|port|socket|button|key)s?$/i.test(w)) return false;
  if (/^(bk72|rtl87|bl60|wb\dl?$|cb\d|wr\d)/i.test(w)) return false; // chips and Tuya modules
  return true;
}

/**
 * Model from a free-text name: the leading model code when there is one (what the Tasmota
 * and ESPHome lists use as model), else the whole name; the full name becomes an alias.
 */
export function tuyaModel(name: string): { model: string; description: string } {
  const description = stripFirmwareVersion(name);
  const first = description.split(" ")[0] ?? "";
  return { model: isModelCode(first) ? first : description, description };
}

/** Category from free text (name, keywords). Order matters: a "Light Switch" is a switch. */
export const TUYA_CATEGORY_RULES: [RegExp, string][] = [
  [/\b(sensor|detector|thermometer|hygrometer|alarm|siren|leak|smoke|motion|pir|window contact|air quality|co2)\b/i, "sensor"],
  [/\b(plugs?|smart ?plug|outlets?|sockets?|power ?strip|powerpoint|power ?point|power ?board|surge|extender|power cube|adapter|splitter|extension)\b/i, "smart-plug"],
  [/\b(switch(es)?|dimmer|relay|breaker|wall touch|touch panel|scene panel|valve|garage)\b/i, "switch"],
  [/\b((energy|power|smart|electricity|kwh) ?(meter|counter|monitor)|meter with|ct[- ]clamp|clamp)\b/i, "sensor"],
  [/\b(fan|heater|dehumidifier|humidifier|diffuser|kettle|purifier|air ?conditioner|feeder|fryer|cooker|boiler|pump|radiator|aquarium|thermostat)\b/i, "appliance"],
  [/\b(bulbs?|light|lights|lamps?|led|leds|strip|downlight|candle|flood ?light|spot ?light|spot|lumens?|lm|rgb\w*|cct|gu10|e27|e14|e26|b22|par\d+|br\d+|a19|a60|panel|lantern|string|ceiling|batten|filament|puck|moodlight|backlight|night ?light)\b/i, "light"],
  [/\b(gateway|hub|bridge)\b/i, "hub"],
];

export const tuyaCategory = (text: string, fallback = "other") => firstMatch(TUYA_CATEGORY_RULES, text, fallback);

// ---------- cloudcutter ----------

export interface CloudcutterProfile { chip?: string | null; type?: string; name?: string }

/** Chip of a profile: firmware.chip, else the chip in the name ("Lightleak - BK7231N - …"). */
export function profileChip(p: any): string | null {
  const chip = clean(p?.firmware?.chip);
  if (chip) return chip;
  return clean(p?.name).match(/\b(BK7231[A-Z]?|RTL87\w+|BL602)\b/i)?.[1].toUpperCase() ?? null;
}

/** Tuya light category codes in device_configuration.category ("0505" = RGBCW light). */
const TUYA_LIGHT_CODE = /^(05\d\d|11\d\d)$/;

// ---------- install route (SPEC R1) ----------

const TOOL_REPO = "https://github.com/tuya-cloudcutter/tuya-cloudcutter";
export const CLOUDCUTTER_GUIDE = `${TOOL_REPO}/blob/main/INSTRUCTIONS.md`;

/** Tuya firmware version and SDK of a profile slug ("oem-bk7231s-rnd-switch-1.1.0-sdk-1.0.2-40.00"). */
export function profileFirmware(profile: string): string | null {
  const m = clean(profile).match(/-(\d+\.\d+\.\d+)-sdk-(\d+\.\d+\.\d+-\d+\.\d+)$/);
  return m ? `${m[1]} (SDK ${m[2]})` : null;
}

/** The exploit only works on the exact Tuya firmware builds cloudcutter has a profile for. */
export function cloudcutterConstraint(firmware: string[]): string {
  const v = [...new Set(firmware)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const listed = v.length ? `only with the Tuya firmware cloudcutter lists for this device: ${v.join(", ")}` : "only with the Tuya firmware versions cloudcutter lists for this device";
  return `Works ${listed}. Check the "Main Module" version in the Tuya or Smart Life app and do not update the device first. Firmware built on Tuya's patched SDK (from February 2022) cannot be flashed over the air: serial flashing is the alternative.`;
}

/**
 * Over-the-air exploit run from a Linux computer (not a VM) with a spare Wi-Fi adapter that
 * can act as an access point, in Docker; the device stays closed. It replaces the Tuya
 * firmware with OpenBeken, ESPHome (LibreTiny) or another image and cuts the device off the
 * Tuya cloud for good. No way back to the stock firmware is documented.
 */
/** Firmware versions behind each record's route, for combineFirmware. */
const FIRMWARE = new WeakMap<DeviceRecord, string[]>();

export function cloudcutterInstall(firmware: string[]): InstallRoute {
  return {
    project: "tuya-cloudcutter",
    method: "ota-exploit",
    guide: CLOUDCUTTER_GUIDE,
    installer: TOOL_REPO,
    difficulty: "medium",
    tools: ["Linux computer (not a VM) with Docker", "Spare Wi-Fi adapter that supports AP mode"],
    opens_device: false,
    firmware_constraints: cloudcutterConstraint(firmware),
    notes: "Command line. The device can no longer use the Tuya apps or cloud afterwards.",
  };
}

export function fromCloudcutter(slug: string, dev: any, chips: Record<string, string | null>, date = today()): DeviceRecord | null {
  const vendor = tuyaVendor(dev?.manufacturer);
  const name = clean(dev?.name);
  if (!vendor || !name) return null;
  const { model, description } = tuyaModel(name);
  const conf = dev.device_configuration ?? {};
  const profiles: string[] = Array.isArray(dev.profiles) ? dev.profiles.map(clean) : [];
  const firmware = profiles.map(profileFirmware).filter((x): x is string => !!x);
  const hint = TUYA_LIGHT_CODE.test(clean(conf.category)) ? "light"
    : firstMatch([[/light|strip|bulb|lamp/i, "light"], [/plug|dltj|socket/i, "smart-plug"], [/switch|dimmer|dctrl/i, "switch"]], profiles.join(" "), "other");
  const rec: DeviceRecord = {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases: [`${vendor} ${description}`],
    category: tuyaCategory(description, hint),
    identifiers: {
      chips: [...profiles.map((p) => chips[p] ?? "").filter(Boolean), clean(conf.module)],
    },
    status: "open-firmware",
    projects: [{
      name: "tuya-cloudcutter",
      url: `https://github.com/${REPO}/blob/${BRANCH}/devices/${encodeURIComponent(slug)}.json`,
      kind: "tool",
      license: "MIT",
    }],
    install: [cloudcutterInstall(firmware)],
    provenance: { sources: ["cloudcutter"] },
    updated: date,
  };
  FIRMWARE.set(rec, firmware);
  return rec;
}

/**
 * Device files of one model (one per Tuya firmware version) merge into one record, and the
 * merge keeps only the first route per method and guide: give every copy the union of the
 * firmware versions first.
 */
export function combineFirmware(records: DeviceRecord[]): DeviceRecord[] {
  const versions = new Map<string, string[]>();
  for (const r of records) versions.set(r.id, [...(versions.get(r.id) ?? []), ...(FIRMWARE.get(r) ?? [])]);
  for (const r of records) {
    const route = r.install?.find((i) => i.method === "ota-exploit");
    if (route) route.firmware_constraints = cloudcutterConstraint(versions.get(r.id)!);
  }
  return records;
}

const source: Source = {
  source: "cloudcutter",
  name: "tuya-cloudcutter device profiles",
  url: "https://github.com/tuya-cloudcutter/tuya-cloudcutter.github.io",
  license: "MIT",
  async fetch() {
    const files = await githubFiles(REPO, BRANCH);
    const chips: Record<string, string | null> = {};
    await mapLimit(files.filter((p) => PROFILE_FILE.test(p)), 16, async (p) => {
      try { chips[p.match(PROFILE_FILE)![1]] = profileChip(JSON.parse(await githubRaw(REPO, BRANCH, p))); } catch { /* unreadable profile: no chip */ }
    });
    const devs = files.filter((p) => DEVICE_FILE.test(p));
    const out = await mapLimit(devs, 16, async (p) => {
      try { return fromCloudcutter(p.match(DEVICE_FILE)![1], JSON.parse(await githubRaw(REPO, BRANCH, p)), chips); } catch { return null; }
    });
    const ok = combineFirmware(out.filter((r): r is DeviceRecord => !!r));
    console.error(`cloudcutter: ${devs.length} device files, ${Object.keys(chips).length} profiles, ${devs.length - ok.length} unusable`);
    return ok;
  },
};
export default source;
