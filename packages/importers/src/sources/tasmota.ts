// Tasmota device templates (templates.blakadder.com), one markdown file with YAML
// frontmatter per device in github.com/blakadder/templates/_templates.
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, frontmatter, githubFiles, githubRaw, espWifiFreedom, mapLimit, splitTitle, type Source } from "../lib.ts";

const REPO = "blakadder/templates", BRANCH = "master";

/** frontmatter `category` → category; unknown values fall back to "other". */
export const TASMOTA_CATEGORIES: Record<string, string> = {
  plug: "smart-plug",
  light: "light",
  bulb: "light",
  switch: "switch",
  relay: "switch",
  sensor: "sensor",
  sensors: "sensor",
  dimmer: "switch",
  cover: "other", // blinds and curtain motors
  misc: "other",
  diy: "other", // development and adapter boards
};

export const tasmotaCategory = (c: unknown) => TASMOTA_CATEGORIES[clean(c).toLowerCase()] ?? "other";

/** MCU family as the site layout derives it from which template key is present. */
export function tasmotaChip(fm: Record<string, any>): string {
  if (fm.template32 != null) return "ESP32";
  if (fm.templates2 != null) return "ESP32-S2";
  if (fm.templates3 != null) return "ESP32-S3";
  if (fm.templatec2 != null) return "ESP32-C2";
  if (fm.templatec3 != null) return "ESP32-C3";
  if (fm.templatec6 != null) return "ESP32-C6";
  return "ESP8266";
}

// ---------- install routes (SPEC R1) ----------

const WEB_INSTALLER = "https://tasmota.github.io/install/";
export const MAINS_WARNING = "Mains-powered: unplug before opening; for experienced users only.";

/** frontmatter `flash` (+ `flash2`) → the flashing methods it names, in order. */
export function tasmotaFlash(fm: Record<string, any>): string[] {
  const text = `${clean(fm.flash)} ${clean(fm.flash2)}`.toLowerCase();
  const out: string[] = [];
  const add = (re: RegExp, m: string) => { if (re.test(text) && !out.includes(m)) out.push(m); };
  add(/tuya-convert/, "tuya-convert");
  add(/\bmgos32\b/, "mgos32");
  add(/\bmgos\b/, "mgos");
  add(/switchbota/, "switchbota");
  add(/preflashed/, "preflashed");
  add(/\breplace/, "replace");
  add(/onboard usb/, "usb");
  add(/\bserial\b/, "serial");
  return out;
}

const MAINS_CATEGORIES = new Set(["plug", "bulb", "switch", "dimmer", "cover"]);
const MAINS_TYPE = /\b(plugs?|outlets?|power ?strip|socket|switch|dimmer|downlight|ceiling|din relay|curtain|fan|heater|kettle|purifier|dehumidifier|energy meter|smart meter)\b/i;
/** Plugs, bulbs, wall switches and other mains appliances; unknown (undefined) otherwise. */
export const tasmotaMains = (fm: Record<string, any>) =>
  MAINS_CATEGORIES.has(clean(fm.category).toLowerCase()) || MAINS_TYPE.test(clean(fm.type));

const OTA_TOOLS: Record<string, { installer: string; notes: string }> = {
  mgos: { installer: "https://github.com/yaourdt/mgos-to-tasmota", notes: "Shelly with stock (Mongoose OS) firmware: Tasmota is installed over the air from the stock web interface." },
  mgos32: { installer: "https://github.com/tasmota/mgos32-to-tasmota32", notes: "Shelly with stock (Mongoose OS) firmware: Tasmota is installed over the air from the stock web interface." },
};

/**
 * How Tasmota gets on the device, from the template's `flash` field. Templates flagged
 * `unsupported` (newer hardware with an incompatible chip) get no route. Devices that must be
 * opened and run on mains get the warning and no installer link (the site shows a plain link).
 */
export function tasmotaInstall(fm: Record<string, any>, guide: string): InstallRoute[] {
  if (truthy(fm.unsupported)) return [];
  const base = { project: "Tasmota", guide };
  const diy = clean(fm.category).toLowerCase() === "diy";
  const devBoard = /development board/i.test(clean(fm.type));
  const mains = !diy && tasmotaMains(fm);
  const opened = (extra: string[] = []) => ({
    ...base, difficulty: "hard" as const, opens_device: true, ...(mains ? { mains_powered: true } : {}),
    ...(extra.length || mains ? { notes: [...(mains ? [MAINS_WARNING] : []), ...extra].join(" ") } : {}),
  });
  const routes: InstallRoute[] = [];
  let methods = tasmotaFlash(fm);
  if (!methods.length) methods = ["serial"]; // any ESP can be flashed over its serial pins
  for (const m of methods) {
    if (m === "preflashed") {
      routes.push({ ...base, method: "other", difficulty: "easy", brick_risk: "none",
        notes: "Sold with Tasmota already installed: apply the template from the guide." });
    } else if (m === "tuya-convert") {
      routes.push({ ...base, method: "ota-exploit", installer: "https://github.com/ct-Open-Source/tuya-convert", difficulty: "medium",
        tools: ["Linux computer with Wi-Fi (e.g. Raspberry Pi)"], opens_device: false, brick_risk: "low", reversible: "partial",
        firmware_constraints: "tuya-convert only works on Tuya firmware released before its 2020 patch; patched devices must be flashed over serial." });
    } else if (m === "mgos" || m === "mgos32") {
      routes.push({ ...base, method: "vendor-upload", installer: OTA_TOOLS[m].installer, difficulty: "easy", opens_device: false,
        brick_risk: "low", reversible: "partial", notes: OTA_TOOLS[m].notes });
    } else if (m === "switchbota") {
      routes.push({ ...base, method: "ota-exploit", installer: "https://github.com/kendallgoto/switchbota", difficulty: "medium",
        opens_device: false, brick_risk: "low", reversible: "partial" });
    } else if (m === "replace") {
      routes.push({ ...opened(["The stock Wi-Fi module is not ESP-based: it must be desoldered and replaced with an ESP module before flashing."]),
        method: "other", tools: ["Soldering iron", "Replacement ESP module (e.g. ESP-12F)"], brick_risk: "medium", reversible: "partial" });
    } else if (m === "usb" || (m === "serial" && devBoard)) {
      routes.push({ ...base, method: "web-serial", installer: WEB_INSTALLER, difficulty: "medium", tools: ["USB cable"],
        opens_device: false, brick_risk: "low", reversible: "yes" });
    } else if (diy) {
      // bare modules and adapter boards: no case to open, wired to a USB-serial adapter
      routes.push({ ...base, method: "serial", installer: WEB_INSTALLER, difficulty: "medium", tools: ["USB-serial adapter, 3.3 V"],
        opens_device: false, brick_risk: "low", reversible: "yes" });
    } else {
      routes.push({ ...opened(), method: "serial", ...(mains ? {} : { installer: WEB_INSTALLER }),
        tools: ["USB-serial adapter, 3.3 V", "Jumper wires or soldering iron"], brick_risk: "low", reversible: "partial" });
    }
  }
  return routes;
}

const truthy = (v: unknown) => v === true || clean(v).toLowerCase() === "true";

/** One template file → record (or null when it has no usable frontmatter). */
export function fromTemplate(path: string, text: string, date = today()): DeviceRecord | null {
  const fm = frontmatter(text);
  if (!fm || !clean(fm.title)) return null;
  const { vendor, model, aliases } = splitTitle(fm.title, fm.model);
  if (!vendor || !model) return null;
  // Jekyll publishes a space in the file name as "-", collapsing repeats ("TT-OTPW- STTIP" → TT-OTPW-STTIP.html)
  const page = path.replace(/^_templates\//, "").replace(/\.md$/, "").replace(/\s+/g, "-").replace(/-{2,}/g, "-");
  const url = `https://templates.blakadder.com/${encodeURIComponent(page)}.html`;
  const module = clean(fm.chip);
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases,
    category: tasmotaCategory(fm.category),
    identifiers: { chips: [tasmotaChip(fm), ...(module && module !== "solo1" ? [module] : module ? ["ESP32-SOLO1"] : [])] },
    status: "open-firmware",
    projects: [{ name: "Tasmota", url, kind: "firmware", license: "GPL-3.0", freedom: espWifiFreedom() }],
    // Jekyll only renders files that start with the "---" fence; the lenient parser also reads
    // a few that start with a blank line, whose page is never published: the route then links
    // the Tasmota getting-started guide instead.
    install: tasmotaInstall(fm, /^\uFEFF?---/.test(text) ? url : "https://tasmota.github.io/docs/Getting-Started/"),
    provenance: { sources: ["tasmota"] },
    updated: date,
  };
}

const source: Source = {
  source: "tasmota",
  name: "Tasmota Device Templates Repository",
  url: "https://templates.blakadder.com/",
  license: "EPL-2.0",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => p.startsWith("_templates/"));
    const out = await mapLimit(files, 16, async (p) => fromTemplate(p, await githubRaw(REPO, BRANCH, p)));
    const ok = out.filter((r): r is DeviceRecord => !!r);
    console.error(`tasmota: ${files.length} template files, ${files.length - ok.length} without usable frontmatter`);
    return ok;
  },
};
export default source;
