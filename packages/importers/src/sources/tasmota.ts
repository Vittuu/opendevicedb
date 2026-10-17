// Tasmota device templates (templates.blakadder.com), one markdown file with YAML
// frontmatter per device in github.com/blakadder/templates/_templates.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, frontmatter, githubFiles, githubRaw, mapLimit, splitTitle, type Source } from "../lib.ts";

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

/** One template file → record (or null when it has no usable frontmatter). */
export function fromTemplate(path: string, text: string, date = today()): DeviceRecord | null {
  const fm = frontmatter(text);
  if (!fm || !clean(fm.title)) return null;
  const { vendor, model, aliases } = splitTitle(fm.title, fm.model);
  if (!vendor || !model) return null;
  const page = path.replace(/^_templates\//, "").replace(/\.md$/, "");
  const module = clean(fm.chip);
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases,
    category: tasmotaCategory(fm.category),
    identifiers: { chips: [tasmotaChip(fm), ...(module && module !== "solo1" ? [module] : module ? ["ESP32-SOLO1"] : [])] },
    status: "open-firmware",
    projects: [{ name: "Tasmota", url: `https://templates.blakadder.com/${encodeURIComponent(page)}.html`, kind: "firmware", license: "GPL-3.0" }],
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
