import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { fromCloudcutter, isModelCode, profileChip, stripFirmwareVersion, tuyaCategory, tuyaModel, tuyaVendor } from "../src/sources/cloudcutter.ts";

const D = "2026-10-17";

test("tuya helpers: vendor, firmware version, model code", () => {
  assert.equal(tuyaVendor("Tuya Generic"), "Tuya");
  assert.equal(tuyaVendor("Arlec Grid Connect"), "Arlec");
  assert.equal(tuyaVendor(" Gosund "), "Gosund");
  assert.equal(stripFirmwareVersion("N-WOT10-EU Plug v1.0.12"), "N-WOT10-EU Plug");
  assert.equal(stripFirmwareVersion("CB8P RGBCT Bulb 1.3.21"), "CB8P RGBCT Bulb");
  assert.equal(stripFirmwareVersion("429004.2 RGBCT Bulb"), "429004.2 RGBCT Bulb");
  for (const w of ["SP111", "BW-CLT1", "8044", "DCF4002WHA", "429004.2"]) assert.equal(isModelCode(w), true, w);
  for (const w of ["16W", "10A", "E27", "GU10", "A19", "3-Gang", "Smart", "G1", "BK7231T", "CB2S"]) assert.equal(isModelCode(w), false, w);
  assert.deepEqual(tuyaModel("DCF4002WHA Ceiling Fan OTA2 v2.1.3"), { model: "DCF4002WHA", description: "DCF4002WHA Ceiling Fan OTA2" });
  assert.deepEqual(tuyaModel("RGBCT Bulb v2.9.6"), { model: "RGBCT Bulb", description: "RGBCT Bulb" });
});

test("tuya category from free text", () => {
  assert.equal(tuyaCategory("Smart Plug with Energy Monitoring"), "smart-plug");
  assert.equal(tuyaCategory("6000HA Inline Switch"), "switch");
  assert.equal(tuyaCategory("DS02S Dimmer Switch"), "switch");
  assert.equal(tuyaCategory("AP6W-0324 6-Way Surge Protector"), "smart-plug");
  assert.equal(tuyaCategory("Power Strip"), "smart-plug");
  assert.equal(tuyaCategory("LED Strip Controller"), "light");
  assert.equal(tuyaCategory("E14 Candle RGBCT Bulb"), "light");
  assert.equal(tuyaCategory("DCF5242HA Ceiling Fan"), "appliance");
  assert.equal(tuyaCategory("YG400A Smoke Detector"), "sensor");
  assert.equal(tuyaCategory("AT2P DIN Rail Energy Meter"), "sensor");
  assert.equal(tuyaCategory("Universal IR Remote"), "other");
  assert.equal(tuyaCategory("Universal IR Remote", "light"), "light");
});

test("cloudcutter profile chip", () => {
  assert.equal(profileChip({ name: "1.0.3 - BK7231T", firmware: { chip: "BK7231T" } }), "BK7231T");
  assert.equal(profileChip({ name: "Lightleak - BK7231N - Type 1 (XOR) / Addr 1", firmware: null }), "BK7231N");
  assert.equal(profileChip({ name: "something" }), null);
});

test("cloudcutter device → record", () => {
  const chips = { "oem-bk7231n-light-ty-1.3.20-sdk-2.3.3-40.00": "BK7231N", "oem-bk7231s-dltj-1.3.5-sdk-1.0.2-40.00": "BK7231T" };
  const a = fromCloudcutter("3stone-ebe-baw550-16w-rgbct-bulb-v1.3.20", {
    manufacturer: "3Stone", name: "EBE-BAW550 16W RGBCT Bulb v1.3.20",
    profiles: ["oem-bk7231n-light-ty-1.3.20-sdk-2.3.3-40.00"],
    device_configuration: { category: "0505", module: "CB2L" },
  }, chips, D)!;
  assert.deepEqual(validate(a), []);
  assert.deepEqual(a, {
    id: "3stone/ebe-baw550", vendor: "3Stone", model: "EBE-BAW550", aliases: ["3Stone EBE-BAW550 16W RGBCT Bulb"],
    category: "light", identifiers: { chips: ["BK7231N", "CB2L"] }, status: "open-firmware",
    projects: [{ name: "tuya-cloudcutter", url: "https://github.com/tuya-cloudcutter/tuya-cloudcutter.github.io/blob/master/devices/3stone-ebe-baw550-16w-rgbct-bulb-v1.3.20.json", kind: "tool", license: "MIT" }],
    provenance: { sources: ["cloudcutter"] }, updated: D,
  });
  // white label, no model code, no device_configuration: category from the profile name
  const b = fromCloudcutter("tuya-generic-x", { manufacturer: "Tuya Generic", name: "Universal Thing v2.0.1", profiles: ["oem-bk7231s-dltj-1.3.5-sdk-1.0.2-40.00"] }, chips, D)!;
  assert.equal(b.id, "tuya/universal-thing");
  assert.equal(b.category, "smart-plug");
  assert.equal(fromCloudcutter("x", { manufacturer: "", name: "A" }, chips, D), null);
  // two firmware versions of one device merge into one record
  const v1 = fromCloudcutter("arlec-pc191ha-t", { manufacturer: "Arlec", name: "PC191HA Smart Plug BK7231T v1.3.5", profiles: ["oem-bk7231s-dltj-1.3.5-sdk-1.0.2-40.00"] }, chips, D)!;
  const v2 = fromCloudcutter("arlec-pc191ha-n", { manufacturer: "Arlec Grid Connect", name: "PC191HA Smart Plug v1.1.8", profiles: [] }, chips, D)!;
  const f = finalize([v1, v2]);
  assert.equal(f.merged, 1);
  assert.equal(f.records[0].id, "arlec/pc191ha");
  assert.equal(f.records[0].projects!.length, 2);
});
