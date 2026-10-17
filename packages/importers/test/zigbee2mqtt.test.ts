import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { fromDefinitions, z2mInstall } from "../src/sources/zigbee2mqtt.ts";

const D = "2026-10-17";

test("zigbee2mqtt install route: pairing, guided by the device's docs page", () => {
  const recs = fromDefinitions([{
    vendor: "IKEA", model: "LED1545G12", description: "TRADFRI bulb E26/E27", exposes: ["light"], zigbeeModel: ["TRADFRI bulb E27 WS opal 980lm"],
    whiteLabel: [{ vendor: "IKEA", model: "LED1546G12", fingerprint: [{ modelID: "TRADFRI bulb E27 WS clear 950lm" }] }, { vendor: "Other", model: "X1" }],
  }], D);
  for (const r of recs) assert.deepEqual(validate(r), [], JSON.stringify(r));
  assert.deepEqual(recs[0].install, [{
    project: "Zigbee2MQTT", method: "pairing", guide: "https://www.zigbee2mqtt.io/devices/LED1545G12.html", difficulty: "medium",
    tools: ["Zigbee USB coordinator", "Computer or Raspberry Pi running Zigbee2MQTT"], brick_risk: "none", reversible: "yes",
    notes: "No flashing: the device keeps its firmware and is paired to your own Zigbee network; remove it from Zigbee2MQTT to undo.",
  }]);
  // the guide is the docs page the record links to: its own for a fingerprinted white label, else the base model's
  assert.deepEqual(recs.map((r) => r.install![0].guide), recs.map((r) => r.projects![0].url));
  assert.equal(recs[1].install![0].guide, "https://www.zigbee2mqtt.io/devices/LED1546G12.html");
  assert.equal(recs[2].install![0].guide, "https://www.zigbee2mqtt.io/devices/LED1545G12.html");
  assert.equal(z2mInstall("ZNCZ02LM/ZNCZ03LM").guide, "https://www.zigbee2mqtt.io/devices/ZNCZ02LM_ZNCZ03LM.html");
  assert.equal(z2mInstall("FUT035Z+").guide, "https://www.zigbee2mqtt.io/devices/FUT035Z_.html", "the site publishes + and & as _");
  assert.equal(z2mInstall("L1(ZW)").guide, "https://www.zigbee2mqtt.io/devices/L1(ZW).html");
  assert.equal(z2mInstall("_TZ3000_o1jzcxou").guide, "https://www.zigbee2mqtt.io/devices/TZ3000_o1jzcxou.html", "leading _ dropped");
});

test("zigbee2mqtt install guide: the general pairing guide while the docs site has no page yet", () => {
  const pages = new Set(["FUT035Z+", "ZNCZ02LM_ZNCZ03LM", "_TZ3000_o1jzcxou"]);
  assert.equal(z2mInstall("_TZ3000_o1jzcxou", pages).guide, "https://www.zigbee2mqtt.io/devices/TZ3000_o1jzcxou.html");
  assert.equal(z2mInstall("FUT035Z+", pages).guide, "https://www.zigbee2mqtt.io/devices/FUT035Z_.html");
  assert.equal(z2mInstall("ZNCZ02LM/ZNCZ03LM", pages).guide, "https://www.zigbee2mqtt.io/devices/ZNCZ02LM_ZNCZ03LM.html");
  assert.equal(z2mInstall("MS01", pages).guide, "https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html");
  const [r] = fromDefinitions([{ vendor: "Besisglas", model: "MS01", exposes: ["occupancy"] }], D, pages);
  assert.deepEqual(validate(r), []);
  assert.equal(r.install![0].guide, "https://www.zigbee2mqtt.io/guide/usage/pairing_devices.html");
  assert.equal(r.projects![0].url, "https://www.zigbee2mqtt.io/devices/MS01.html", "the project link is unchanged");
});
