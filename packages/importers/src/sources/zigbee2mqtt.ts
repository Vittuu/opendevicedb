// Zigbee2MQTT supported devices, read from the zigbee-herdsman-converters npm package
// (the same definitions the zigbee2mqtt.io docgen renders). Only plain data is kept:
// vendor, model, zigbeeModel/fingerprint model IDs, and expose types for the category.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, firstMatch, type Source } from "../lib.ts";

/** The subset of a prepared converter definition this importer reads. */
export interface Z2mDefinition {
  vendor: string;
  model: string;
  description?: string;
  zigbeeModel?: string[];
  fingerprint?: { modelID?: string; manufacturerName?: string }[];
  /** top-level expose types and names, e.g. ["light", "switch", "temperature"] */
  exposes: string[];
  whiteLabel?: { vendor?: string; model: string; description?: string; whiteLabelOf?: string; fingerprint?: { modelID?: string; manufacturerName?: string }[] }[];
}

// Ordered: the first pattern matching the description wins.
export const DESCRIPTION_CATEGORIES: [RegExp, string][] = [
  [/\b(plug|socket|outlet|power ?strip|extension lead)s?\b/i, "smart-plug"],
  [/\b(gateway|hub|bridge|coordinator|repeater|range extender|zigbee router)s?\b/i, "hub"],
  [/\b(switch|relay|dimmer|button|remote|keypad|knob|scenes? control(ler)?|wall controller)s?\b/i, "switch"],
  [/\b(sensor|detector|thermometer|hygrometer|monitor|meter|multisensor|smoke alarm|co alarm|carbon monoxide alarm)s?\b/i, "sensor"],
  [/\b(bulb|lamp|light|led|downlight|spotlight|spot|strip|luminaire|lightstrip|ceiling|chandelier|lighting)s?\b/i, "light"],
];

// Fallback on expose types/names when the description says nothing.
const ACTUATORS = ["light", "switch", "cover", "climate", "lock", "fan"];
const SENSING = ["temperature", "humidity", "occupancy", "presence", "contact", "water_leak", "smoke", "illuminance", "co2", "pm25", "voc", "pressure", "vibration", "gas"];

export function z2mCategory(description: string, exposes: string[]): string {
  const byText = firstMatch(DESCRIPTION_CATEGORIES, description, "");
  if (byText) return byText;
  if (exposes.includes("light")) return "light";
  if (exposes.includes("switch")) return "switch";
  if (exposes.some((e) => ACTUATORS.includes(e))) return "other";
  if (exposes.some((e) => SENSING.includes(e))) return "sensor";
  return "other";
}

/** Page name used by the zigbee2mqtt.io docgen (utils.ts normalizeModel). */
export const z2mPage = (model: string) => `https://www.zigbee2mqtt.io/devices/${model.replace(/[/| :]/g, "_")}.html`;

const modelIds = (fp: Z2mDefinition["fingerprint"] = []) => fp.map((f) => f.modelID).filter((x): x is string => !!x);

export function fromDefinitions(defs: Z2mDefinition[], date = today()): DeviceRecord[] {
  const out: DeviceRecord[] = [];
  const record = (vendor: string, model: string, description: string, exposes: string[], zigbee: string[], page: string): DeviceRecord => ({
    id: makeId(vendor, model),
    vendor: clean(vendor),
    model: clean(model),
    category: z2mCategory(description, exposes),
    // some model IDs are NUL-padded as the device reports them
    identifiers: { zigbee_model: [...new Set(zigbee.map((z) => clean(z.replace(/\0/g, ""))).filter(Boolean))] },
    status: "controllable",
    projects: [{ name: "Zigbee2MQTT", url: z2mPage(page), kind: "integration", license: "GPL-3.0" }],
    provenance: { sources: ["zigbee2mqtt"] },
    updated: date,
  });
  for (const d of defs) {
    const base = [...(d.zigbeeModel ?? []), ...modelIds(d.fingerprint)];
    out.push(record(d.vendor, d.model, d.description ?? "", d.exposes, base, d.model));
    for (const w of d.whiteLabel ?? []) {
      // A white label with its own fingerprint has its own docs page and its own model IDs
      // (inherited from the base fingerprint with the same manufacturerName when omitted).
      let zigbee = base, page = w.whiteLabelOf ?? d.model;
      if (w.fingerprint?.length) {
        page = w.model;
        zigbee = w.fingerprint.flatMap((f) => f.modelID ? [f.modelID]
          : modelIds((d.fingerprint ?? []).filter((b) => b.manufacturerName && b.manufacturerName === f.manufacturerName)));
      }
      out.push(record(w.vendor ?? d.vendor, w.model, w.description ?? d.description ?? "", d.exposes, zigbee, page));
    }
  }
  return out;
}

/** Load and flatten the converter definitions (executes the published npm package). */
async function loadDefinitions(): Promise<Z2mDefinition[]> {
  const devices: any = await import("zigbee-herdsman-converters/devices/index");
  const { prepareDefinition }: any = await import("zigbee-herdsman-converters");
  const all: any[] = devices.default?.default ?? devices.default ?? devices;
  return all.map((raw) => {
    const d = prepareDefinition(raw);
    let ex: any[] = [];
    try {
      ex = typeof d.exposes === "function" ? d.exposes({ isDummyDevice: true }, {}) : (d.exposes ?? []);
    } catch { /* dynamic exposes that need a real device */ }
    return {
      vendor: d.vendor, model: d.model, description: d.description, zigbeeModel: d.zigbeeModel,
      fingerprint: d.fingerprint, whiteLabel: d.whiteLabel,
      exposes: [...new Set(ex.flatMap((e: any) => [e.type, e.name]).filter(Boolean))] as string[],
    };
  });
}

const source: Source = {
  source: "zigbee2mqtt",
  name: "Zigbee2MQTT",
  url: "https://www.zigbee2mqtt.io/supported-devices/",
  license: "MIT",
  fetch: async () => fromDefinitions(await loadDefinitions()),
};
export default source;
