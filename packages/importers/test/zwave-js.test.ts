import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { parseJsonc, zwaveVendor, zwaveCategory, conditional, labelVariants, fromDeviceFile, zwaveDbPage } from "../src/sources/zwave-js.ts";

const D = "2026-10-17";
const DIR = "packages/config/config/devices";
const allValid = (rs: DeviceRecord[]) => {
  for (const r of rs) assert.deepEqual(validate(r), [], JSON.stringify(r));
};

test("zwave-js device files: comments and trailing commas", () => {
  const j = parseJsonc(`// shared by several manufacturers
{
  "manufacturer": "HomePro", /* block */ "label": "ZDW103",
  "url": "https://example.com/a//b", // a // inside a string is kept
  "devices": [{ "productType": "0x4457", "productId": "0x3033" },],
}`);
  assert.equal(j.manufacturer, "HomePro");
  assert.equal(j.url, "https://example.com/a//b");
  assert.equal(j.devices.length, 1);
});

test("zwave-js vendor names", () => {
  assert.equal(zwaveVendor("Philio Technology Corp"), "Philio");
  assert.equal(zwaveVendor("McoHome Technology Co., Ltd."), "McoHome");
  assert.equal(zwaveVendor("Shenzhen Neo Electronics Co., Ltd."), "Neo");
  assert.equal(zwaveVendor("Wenzhou MTLC Electric Appliances Co., Ltd."), "MTLC");
  assert.equal(zwaveVendor("First Alert (BRK Brands Inc)"), "First Alert");
  assert.equal(zwaveVendor("Enerwave / Wenzhou MTLC Electric Appliances Co., Ltd."), "Enerwave");
  assert.equal(zwaveVendor("Fibargroup"), "Fibaro");
  assert.equal(zwaveVendor("AEON Labs"), "Aeotec");
  assert.equal(zwaveVendor("Aeotec Ltd."), "Aeotec");
  assert.equal(zwaveVendor("Kamstrup A/S"), "Kamstrup");
  assert.equal(zwaveVendor("TP-Link Technologies Co., Ltd."), "TP-Link");
  assert.equal(zwaveVendor("Yale"), "Yale");
  assert.equal(zwaveVendor("Remote Technologies Incorporated"), "Remote Technologies");
});

test("zwave-js category keywords", () => {
  assert.equal(zwaveCategory("Wall Mounted 3-Way Dimmer Receiver"), "light");
  assert.equal(zwaveCategory("Mini Plug with Power Meter"), "smart-plug");
  assert.equal(zwaveCategory("In-Wall Paddle Switch, QFSW, 500S"), "switch");
  assert.equal(zwaveCategory("Fan Coil Thermostat"), "appliance");
  assert.equal(zwaveCategory("Assure Touchscreen Deadbolt"), "other");
  assert.equal(zwaveCategory("Door/Window Sensor"), "sensor");
  assert.equal(zwaveCategory("USB Controller"), "hub");
  assert.equal(zwaveCategory("Range Extender (1st Generation)"), "hub");
  assert.equal(zwaveCategory("Roller Shutter"), "other");
  assert.equal(zwaveCategory("Wireless Remote Control Dimmer"), "switch");
  assert.equal(zwaveCategory("TOASTCAM"), "ip-camera");
  assert.equal(zwaveCategory("", "Atomic"), "other");
});

test("zwave-js conditional labels and variants", () => {
  const c = conditional([{ $if: "productId === 0x89d1", value: "YRD410-F-ZW4" }, { $if: "firmwareVersion >= 1.1", value: "X 700" }, "YRD4X0-F-ZW4"]);
  assert.equal(c.default, "YRD4X0-F-ZW4");
  assert.deepEqual(c.variants, [{ value: "YRD410-F-ZW4", productId: "0x89d1" }, { value: "X 700", productId: undefined }]);
  assert.deepEqual(labelVariants("YRL226 / YRL256"), ["YRL226", "YRL256"]);
  assert.deepEqual(labelVariants("FGWPA/B-111"), ["FGWPA/B-111"]);
});

test("zwave-js device file → record", () => {
  const recs = fromDeviceFile(`${DIR}/0x0129/yrl226.json`, {
    manufacturer: "Yale", manufacturerId: "0x0129", label: "YRL226 / YRL256", description: "Assure Key Free Lever Touchscreen",
    devices: [{ productType: "0x8002", productId: "0x0600" }, { productType: 32770, productId: 1536 }],
  }, D);
  allValid(recs);
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.id, "yale/yrl226");
  assert.equal(r.model, "YRL226");
  assert.equal(r.category, "other");
  assert.equal(r.status, "controllable");
  assert.deepEqual(r.identifiers!.sku, ["YRL226", "YRL256", "zwave:0x0129:0x8002:0x0600"]);
  assert.deepEqual(r.aliases, ["Yale YRL256", "Yale Assure Key Free Lever Touchscreen"]);
  assert.equal(r.projects![0].url, "https://github.com/zwave-js/zwave-js/blob/master/packages/config/config/devices/0x0129/yrl226.json");
  assert.deepEqual(r.provenance, { sources: ["zwave-js"] });
});

test("zwave-js productId-bound labels become their own records", () => {
  const recs = fromDeviceFile(`${DIR}/0x0463/yrd4x0-f-zw4.json`, {
    manufacturer: "Fortune Brands", manufacturerId: "0x0463", description: "Assure 2 Biometric Deadbolt",
    label: [{ $if: "productId === 0x89d1", value: "YRD410-F-ZW4" }, "YRD4X0-F-ZW4"],
    devices: [{ productType: "0x0003", productId: "0x89d1" }, { productType: "0x0003", productId: "0x89d9" }],
  }, D);
  allValid(recs);
  assert.deepEqual(recs.map((r) => [r.id, r.identifiers!.sku]), [
    ["fortune-brands/yrd410-f-zw4", ["YRD410-F-ZW4", "zwave:0x0463:0x0003:0x89d1"]],
    ["fortune-brands/yrd4x0-f-zw4", ["YRD4X0-F-ZW4", "zwave:0x0463:0x0003:0x89d9"]],
  ]);
});

test("zwave-js skips templates and files without a label; duplicates merge", () => {
  assert.deepEqual(fromDeviceFile(`${DIR}/0x0001/templates/act_template.json`, { label: "x", manufacturer: "y" }, D), []);
  assert.deepEqual(fromDeviceFile(`${DIR}/0x0001/a.json`, { manufacturer: "HomePro" }, D), []);
  const one = (pid: string) => fromDeviceFile(`${DIR}/0x0001/zdw103-${pid}.json`, {
    manufacturer: "HomePro", label: "ZDW103", description: "Dimmer", devices: [{ productType: "0x4457", productId: pid }],
  }, D);
  const f = finalize([...one("0x3033"), ...one("0x3034")]);
  assert.equal(f.merged, 1);
  assert.equal(f.records[0].projects!.length, 2);
  assert.deepEqual(f.records[0].identifiers!.sku, ["ZDW103", "zwave:0x0001:0x4457:0x3033", "zwave:0x0001:0x4457:0x3034"]);
});

test("zwave-js install route: pairing, guided by the product's page in the config DB browser", () => {
  const [r] = fromDeviceFile(`${DIR}/0x0129/yrl226.json`, {
    manufacturer: "Yale", manufacturerId: "0x0129", label: "YRL226", firmwareVersion: { min: "1.10", max: "255.255" },
    devices: [{ productType: "0x8002", productId: "0x0600" }],
  }, D);
  allValid([r]);
  assert.equal(r.install!.length, 1);
  const i = r.install![0];
  assert.equal(i.project, "Z-Wave JS");
  assert.equal(i.method, "pairing");
  assert.equal(i.guide, "https://devices.zwave-js.io/?jumpTo=0x0129:0x8002:0x0600:1.10");
  assert.equal(i.difficulty, "medium");
  assert.equal(i.brick_risk, "none");
  assert.equal(i.reversible, "yes");
  assert.ok(i.tools!.some((t) => /Z-Wave USB controller/.test(t)));
  assert.equal(zwaveDbPage("0x0001", "0x4457", "0x3033"), "https://devices.zwave-js.io/?jumpTo=0x0001:0x4457:0x3033:0.0");
  // productId-bound labels link to their own product
  const recs = fromDeviceFile(`${DIR}/0x0463/yrd4x0-f-zw4.json`, {
    manufacturer: "Fortune Brands", manufacturerId: "0x0463",
    label: [{ $if: "productId === 0x89d1", value: "YRD410-F-ZW4" }, "YRD4X0-F-ZW4"],
    devices: [{ productType: "0x0003", productId: "0x89d1" }, { productType: "0x0003", productId: "0x89d9" }],
  }, D);
  assert.deepEqual(recs.map((x) => x.install![0].guide), [
    "https://devices.zwave-js.io/?jumpTo=0x0463:0x0003:0x89d1:0.0",
    "https://devices.zwave-js.io/?jumpTo=0x0463:0x0003:0x89d9:0.0",
  ]);
  // no product ids: the Z-Wave JS UI quick start
  const [bare] = fromDeviceFile(`${DIR}/0x0001/x.json`, { manufacturer: "HomePro", label: "ZDW103" }, D);
  assert.equal(bare.install![0].guide, "https://zwave-js.github.io/zwave-js-ui/#/getting-started/quick-start");
});
