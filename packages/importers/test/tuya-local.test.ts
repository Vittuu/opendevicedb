import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { parseConfig, fromConfigs, fromFileName, brandSpellings, tuyaCategory, modelName, splitBrands } from "../src/sources/tuya-local.ts";

const D = "2026-10-17";
const P = "custom_components/tuya_local/devices/";

const DEHUMIDIFIER = `name: Dehumidifier
products:
  - id: ifasqsxbghku3bwk
    manufacturer: Aktobis
    model: WDH-310EKW
  - id: ifbnzf2j2rwr0upp
    manufacturer: AKTOBIS
    model: Aktobis WDH-930EEW
entities:
  - entity: humidifier
    class: dehumidifier
    dps:
      - id: 1
        name: switch
        type: boolean
`;
const THERMOSTAT = `name: Thermostat
products:
  - id: daltzmaeoxybutqs
    manufacturer: Beok / Avatto
    model: SH-TGM50 WP
    model_id: TGM50
entities:
  - entity: climate
`;
const NO_PRODUCTS = `name: Heater
entities:
  - entity: climate
`;
const NO_BRAND = `name: Dehumidifier
products:
  - id: msopwdnvklxbrnw9
    model: LDH-7700
entities:
  - entity: humidifier
`;
const NAME_ONLY = `name: Glass wall switch
products:
  - id: kopqi7ax9pwi7nr2
    manufacturer: Briliiant Smart
    name: Glass wall switch 4-gang
  - id: x
    manufacturer: Arlec
entities:
  - entity: switch
`;

const configs = () => [
  parseConfig(P + "aktobis_wdh_310ek_dehumidifier.yaml", DEHUMIDIFIER)!,
  parseConfig(P + "beok_tgm50wp_thermostat.yaml", THERMOSTAT)!,
  parseConfig(P + "aktobis_wdh930_heater.yaml", NO_PRODUCTS)!,
  parseConfig(P + "aktobis_heater.yaml", NO_PRODUCTS)!,
  parseConfig(P + "ldh7700_dehumidifier.yaml", NO_BRAND)!,
  parseConfig(P + "brilliant_quad_switch.yaml", NAME_ONLY)!,
  parseConfig(P + "x.yaml", "name: Brilliant Smart thing\nproducts:\n  - id: y\n    manufacturer: Brilliant Smart\n    model: B1\nentities:\n  - entity: light\n")!,
];

test("tuya-local parseConfig", () => {
  const c = parseConfig(P + "beok_tgm50wp_thermostat.yaml", THERMOSTAT)!;
  assert.equal(c.file, "beok_tgm50wp_thermostat.yaml");
  assert.equal(c.entity, "climate");
  assert.deepEqual(c.products, [{ id: "daltzmaeoxybutqs", manufacturer: "Beok / Avatto", model: "SH-TGM50 WP", model_id: "TGM50", name: undefined }]);
  assert.equal(parseConfig("x.yaml", "name: [unclosed"), null);
  assert.equal(parseConfig("x.yaml", "entities: []"), null);
});

test("tuya-local brands: one spelling per brand, slash lists, typos, file-name brands", () => {
  const brands = brandSpellings(configs());
  assert.equal(brands.get("aktobis"), "Aktobis", "tie broken against all capitals");
  assert.equal(brands.get("brilliantsmart"), "Brilliant Smart", "typo folded into the real spelling");
  assert.deepEqual(splitBrands("Beok / Avatto"), ["Beok", "Avatto"]);
  assert.deepEqual(fromFileName("aktobis_wdh930_heater.yaml", brands), { vendor: "Aktobis", model: "WDH930" });
  assert.deepEqual(fromFileName("aktobis_heater.yaml", brands), { vendor: "Aktobis", model: undefined });
  assert.equal(fromFileName("ldh7700_dehumidifier.yaml", brands), null);
  assert.equal(modelName("Aktobis", "Aktobis WDH-930EEW"), "WDH-930EEW");
  assert.equal(modelName("Petree", "Petree 2.0"), "Petree 2.0");
  assert.equal(modelName("Beca", "BHP-6000 (mapped °C)"), "BHP-6000");
  assert.equal(modelName("Leo's Loo", "Too (MEET firmware)"), "Too");
  assert.equal(modelName("Airton", "Reversible 2500W (409730)"), "Reversible 2500W (409730)");
});

test("tuya-local configs → records", () => {
  const recs = fromConfigs(configs(), D);
  for (const r of recs) assert.deepEqual(validate(r), [], JSON.stringify(r));
  assert.deepEqual(recs.map((r) => r.id), [
    "aktobis/wdh-310ekw", "aktobis/wdh-930eew", "beok/sh-tgm50-wp", "avatto/sh-tgm50-wp", "aktobis/wdh930",
    "brilliant-smart/glass-wall-switch-4-gang", "brilliant-smart/b1",
  ], "no record without a brand, without a model, or named only 'Heater'");
  const [d, , t] = recs;
  assert.equal(d.category, "appliance");
  assert.equal(d.status, "controllable");
  assert.deepEqual(d.identifiers, { sku: ["tuya:ifasqsxbghku3bwk"] });
  assert.equal(d.projects![0].url, "https://github.com/make-all/tuya-local/blob/main/custom_components/tuya_local/devices/aktobis_wdh_310ek_dehumidifier.yaml");
  assert.deepEqual(d.provenance, { sources: ["tuya-local"] });
  assert.equal(t.category, "other", "thermostats are not appliances");
  assert.deepEqual(t.identifiers!.sku, ["TGM50", "tuya:daltzmaeoxybutqs"]);
  assert.equal(recs[5].category, "switch");
});

test("tuya-local categories", () => {
  assert.equal(tuyaCategory("Dehumidifier", "humidifier"), "appliance");
  assert.equal(tuyaCategory("Kettle", "water_heater"), "appliance");
  assert.equal(tuyaCategory("Dishwasher", "switch"), "appliance");
  assert.equal(tuyaCategory("Coffee maker", "binary_sensor"), "appliance");
  assert.equal(tuyaCategory("Air purifier", "fan"), "appliance");
  assert.equal(tuyaCategory("Ceiling fan light", "light"), "appliance");
  assert.equal(tuyaCategory("Fan speed switch", "fan"), "switch");
  assert.equal(tuyaCategory("Robot vacuum", "vacuum"), "vacuum-robot");
  assert.equal(tuyaCategory("Workshop vacuum", "vacuum"), "appliance");
  assert.equal(tuyaCategory("Thermostat", "climate"), "other");
  assert.equal(tuyaCategory("Camera pet feeder", "light"), "appliance");
  assert.equal(tuyaCategory("Video doorbell", "switch"), "ip-camera");
  assert.equal(tuyaCategory("Refrigerator thermometer", "sensor"), "sensor");
  assert.equal(tuyaCategory("Power clamp meter", "sensor"), "sensor");
  assert.equal(tuyaCategory("Floodlight with sensor", "light"), "light");
  assert.equal(tuyaCategory("USB+3 outlet powerstrip", "switch"), "smart-plug");
  assert.equal(tuyaCategory("EV charger", "sensor"), "other");
  assert.equal(tuyaCategory("Solar water heater", "water_heater"), "appliance");
  assert.equal(tuyaCategory("Relay", "switch", "outlet"), "switch");
  assert.equal(tuyaCategory("Thing", "switch", "outlet"), "smart-plug");
  assert.equal(tuyaCategory("Curtain", "cover"), "other");
  assert.equal(tuyaCategory("Radiator", "climate", undefined, "TRV06"), "other");
});

test("tuya-local reads the head of a config whose DP mappings do not parse", () => {
  const c = parseConfig(P + "p.yaml", `name: Pool heat pump\nproducts:\n  - id: abc\n    manufacturer: Poolsana\n    model: InverPro\nentities:\n  - entity: climate\n    dps:\n      - value: "broken \\\n`)!;
  assert.equal(c.entity, "climate");
  assert.equal(c.products[0].model, "InverPro");
});

test("tuya-local install route: local control from Home Assistant, stock firmware", () => {
  const recs = fromConfigs(configs(), D);
  for (const r of recs) {
    assert.equal(r.install!.length, 1);
    assert.deepEqual(validate(r), [], JSON.stringify(r));
  }
  const i = recs[0].install![0];
  assert.equal(i.project, "tuya-local");
  assert.equal(i.method, "host-software");
  assert.equal(i.guide, "https://github.com/make-all/tuya-local");
  assert.equal(i.difficulty, "medium");
  assert.equal(i.brick_risk, "none");
  assert.equal(i.reversible, "yes");
  assert.match(i.notes!, /local key/);
  assert.notEqual(recs[0].install![0].tools, recs[1].install![0].tools, "records do not share mutable lists");
});
