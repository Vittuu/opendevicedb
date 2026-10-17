import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import { extractDecoders, expandSlashes, splitDeviceName, rtlCategory, rtlStatus, fromDecoderFile } from "../src/sources/rtl_433.ts";

const D = "2026-10-17";
const allValid = (rs: DeviceRecord[]) => {
  for (const r of rs) assert.deepEqual(validate(r), [], JSON.stringify(r));
};
const pairs = (name: string) => splitDeviceName(name).map((p) => `${p.vendor} | ${p.model}`);

const FILE = `/** @file Decoder. */
static char const *const output_fields[] = { "model", "id", "temperature_C", "humidity", NULL };
r_device const acurite_606 = {
        .name        = "Acurite 606TX / Technoline TX960 Temperature Sensor",
        .modulation  = OOK_PULSE_PPM,
        .decode_fn   = &acurite_606_decode,
        .fields      = output_fields,
};
r_device const maverick = {
        .name        = "Maverick ET-732/733 BBQ Sensor",
        .disabled    = 1, // payload undecoded, see issue #2584
        .fields      = output_fields};
r_device const tmpl = {
        .name        = "Template decoder",
        .disabled    = 3, // disabled and hidden
};
`;

test("rtl_433 r_device structs", () => {
  assert.deepEqual(extractDecoders(FILE), [
    { name: "Acurite 606TX / Technoline TX960 Temperature Sensor", disabled: 0, note: "" },
    { name: "Maverick ET-732/733 BBQ Sensor", disabled: 1, note: "payload undecoded, see issue #2584" },
    { name: "Template decoder", disabled: 3, note: "disabled and hidden" },
  ]);
});

test("rtl_433 slash lists expand", () => {
  assert.deepEqual(expandSlashes("ET-732/733"), ["ET-732", "ET-733"]);
  assert.deepEqual(expandSlashes("990040/50/51"), ["990040", "990050", "990051"]);
  assert.deepEqual(expandSlashes("WH1080/WH3080"), ["WH1080", "WH3080"]);
  assert.deepEqual(expandSlashes("TX29IT"), ["TX29IT"]);
});

test("rtl_433 names → vendor + model", () => {
  assert.deepEqual(pairs("Acurite 896 Rain Gauge"), ["AcuRite | 896"]);
  assert.deepEqual(pairs("Ambient Weather TX-8300 Temperature/Humidity Sensor"), ["Ambient Weather | TX-8300"]);
  assert.deepEqual(pairs("LaCrosse TX29IT, TFA Dostmann 30.3159.IT Temperature sensor"), ["La Crosse Technology | TX29IT", "TFA Dostmann | 30.3159.IT"]);
  assert.deepEqual(pairs("Auriol HG02832, HG05124A-DCF, Rubicson 48957 temperature/humidity sensor"), ["Auriol | HG02832", "Auriol | HG05124A-DCF", "Rubicson | 48957"]);
  assert.deepEqual(pairs("Fine Offset Electronics WH1080/WH3080 Weather Station (FSK)"), ["Fine Offset | WH1080", "Fine Offset | WH3080"]);
  assert.deepEqual(pairs("Auriol AFT 77 B2 temperature sensor"), ["Auriol | AFT 77 B2"]);
  assert.deepEqual(pairs("Audiovox PRO-OE3B Car Remote (-f 303.4M)"), ["Audiovox | PRO-OE3B"]);
  assert.deepEqual(pairs("ESIC EMT7110 power meter"), ["ESIC | EMT7110"]);
  assert.deepEqual(pairs("ThermoPro TP28b Super Long Range Wireless Meat Thermometer for Smoker BBQ Grill"), ["ThermoPro | TP28b"]);
  assert.deepEqual(pairs("Ford TPMS"), ["Ford | TPMS"]);
  assert.deepEqual(pairs("Watts Vision thermostat (-f 868.3M)"), ["Watts | Vision Thermostat"]);
  // overrides and skips
  assert.deepEqual(pairs("Acurite/Chaney 985 Refrigerator / Freezer Thermometer"), ["AcuRite | 985", "Chaney | 985"]);
  assert.deepEqual(pairs("Microchip HCS200/HCS300 KeeLoq Hopping Encoder based remotes"), []);
  assert.deepEqual(pairs("Wireless M-Bus, Mode T, 32.768kbps (-f 868.3M -s 1000k)"), []);
  assert.deepEqual(pairs("Generic Remote SC226x EV1527"), []);
  assert.deepEqual(pairs("Somfy RTS"), []);
});

test("rtl_433 category and status", () => {
  assert.equal(rtlCategory("Ford TPMS"), "vehicle");
  assert.equal(rtlCategory("Chrysler Car Remote (-f 315.1M -s 920k)"), "vehicle");
  assert.equal(rtlCategory("Elro DB286A Doorbell"), "other");
  assert.equal(rtlCategory("Honeywell CM921 Wireless Programmable Room Thermostat"), "appliance");
  assert.equal(rtlCategory("Fine Offset Electronics WS90 weather station"), "sensor");
  assert.equal(rtlCategory("McPower Kinetic battery-less wall switch"), "switch");
  assert.equal(rtlCategory("DirecTV RC66RX Remote Control"), "other");
  assert.equal(rtlCategory("Vauno EN8822C", `"temperature_C",`), "sensor", "measurement fields");
  assert.equal(rtlCategory("Vauno EN8822C", `"button",`), "other");
  assert.equal(rtlCategory("Bresser SmartHome Garden soil moisture and water timer valve", "", "SmartHome Garden soil moisture sensor"), "sensor", "model first");
  const d = (name: string, note = "") => ({ name, disabled: note ? 1 : 0, note });
  assert.equal(rtlStatus(d("Acurite 896 Rain Gauge"), "sensor"), "controllable");
  assert.equal(rtlStatus(d("Ford Car Key"), "vehicle"), "partial-protocol");
  assert.equal(rtlStatus(d("2GIG-KEY2E-345 encrypted keyfob"), "other"), "partial-protocol");
  assert.equal(rtlStatus(d("Danfoss CFR Thermostat"), "appliance"), "partial-protocol");
  assert.equal(rtlStatus(d("X Y1 sensor", "payload undecoded, see issue #2584"), "sensor"), "partial-protocol");
  assert.equal(rtlStatus(d("X Y1 sensor", "default disabled because there is no checksum"), "sensor"), "controllable");
});

test("rtl_433 decoder file → records", () => {
  const recs = fromDecoderFile("src/devices/acurite.c", FILE, D);
  allValid(recs);
  assert.deepEqual(recs.map((r) => `${r.id} ${r.category} ${r.status}`), [
    "acurite/606tx sensor controllable",
    "technoline/tx960 sensor controllable",
    "maverick/et-732 sensor partial-protocol",
    "maverick/et-733 sensor partial-protocol",
  ]);
  const r = recs[0];
  assert.deepEqual(r.identifiers, { sku: ["606TX"] });
  assert.equal(r.projects![0].url, "https://github.com/merbanan/rtl_433/blob/master/src/devices/acurite.c");
  assert.equal(r.projects![0].license, "GPL-2.0-or-later");
  assert.deepEqual(r.provenance, { sources: ["rtl_433"] });
  assert.deepEqual(fromDecoderFile("include/r_device.h", FILE, D), []);
});

test("rtl_433 install route: listen with an SDR receiver, receive only", () => {
  const recs = fromDecoderFile("src/devices/acurite.c", FILE, D);
  allValid(recs);
  for (const r of recs) assert.equal(r.install!.length, 1);
  assert.deepEqual(recs[0].install, [{
    project: "rtl_433", method: "host-software", guide: "https://github.com/merbanan/rtl_433", difficulty: "medium",
    tools: ["RTL-SDR USB receiver (or another SDR rtl_433 supports)"], brick_risk: "none", reversible: "yes",
    notes: "Receive only: rtl_433 decodes the radio messages the device sends; it does not change or command the device.",
  }]);
});
