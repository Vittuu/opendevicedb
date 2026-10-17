import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import { splitTitle, frontmatter, finalize, snapshot, stringifySnapshot, firstMatch } from "../src/lib.ts";
import { z2mCategory, z2mPage, fromDefinitions } from "../src/sources/zigbee2mqtt.ts";
import { tohCategory, fccFromUrl, fromToh } from "../src/sources/openwrt.ts";
import { fromTemplate, tasmotaCategory, tasmotaChip } from "../src/sources/tasmota.ts";
import { fromDevice, esphomeSlug, esphomeChips, esphomeCategory } from "../src/sources/esphome.ts";
import { parseCameraName, fromDefconfig } from "../src/sources/thingino.ts";

const D = "2026-10-17";
const allValid = (rs: (DeviceRecord | null)[]) => {
  for (const r of rs) assert.deepEqual(validate(r), [], JSON.stringify(r));
};

test("splitTitle", () => {
  assert.deepEqual(splitTitle("Athom Smart Plug PG01V2"), { vendor: "Athom", model: "Smart Plug PG01V2", aliases: [] });
  assert.deepEqual(splitTitle("2nice ", "SP111"), { vendor: "2nice", model: "SP111", aliases: [] });
  assert.deepEqual(splitTitle("ESP01 NeoPixel Ring", "ESP-01S-RGB-LED-v1.0"), { vendor: "ESP01", model: "ESP-01S-RGB-LED-v1.0", aliases: ["ESP01 NeoPixel Ring"] });
  assert.deepEqual(splitTitle("IOT4SH01DS"), { vendor: "Generic", model: "IOT4SH01DS", aliases: [] });
});

test("firstMatch is ordered with fallback", () => {
  const t: [RegExp, string][] = [[/a/, "first"], [/a|b/, "second"]];
  assert.equal(firstMatch(t, "ab", "none"), "first");
  assert.equal(firstMatch(t, "b", "none"), "second");
  assert.equal(firstMatch(t, "c", "none"), "none");
});

test("frontmatter is lenient like Jekyll", () => {
  assert.deepEqual(frontmatter("\n---  \ntitle: A\nlink: x\nlink: y\n---\nbody"), { title: "A", link: "y" });
  assert.equal(frontmatter("no frontmatter"), null);
  assert.equal(frontmatter("---\n: : bad\n  - [\n---\n"), null);
});

test("finalize drops invalid, merges duplicates, compacts and sorts", () => {
  const base = { vendor: "Acme", category: "light", status: "controllable", updated: D } as const;
  const f = finalize([
    { ...base, id: "acme/z", model: "Z", aliases: [] },
    { ...base, id: "acme/a", model: "A", identifiers: { zigbee_model: ["A1"] }, projects: [{ name: "p", url: "https://x/1", kind: "integration" }] },
    { ...base, id: "acme/a", model: "A", identifiers: { zigbee_model: ["A2"] }, projects: [{ name: "p", url: "https://x/2", kind: "integration" }] },
    { ...base, id: "Bad Id", model: "B" },
  ] as DeviceRecord[]);
  assert.equal(f.invalid, 1);
  assert.equal(f.merged, 1);
  assert.deepEqual(f.records.map((r) => r.id), ["acme/a", "acme/z"]);
  assert.deepEqual(f.records[0].identifiers, { zigbee_model: ["A1", "A2"] });
  assert.equal(f.records[0].projects!.length, 2);
  assert.equal("aliases" in f.records[1], false);
  assert.equal("claims" in f.records[0], false, "empty lists from mergeRecords are dropped");
  const s = snapshot({ source: "t", name: "T", url: "https://t", license: "MIT", fetch: async () => [] }, f.records, new Date(D));
  assert.deepEqual(JSON.parse(stringifySnapshot(s)), s);
});

test("zigbee2mqtt category heuristics", () => {
  assert.equal(z2mCategory("Smart light switch - 1 gang (US)", ["switch"]), "switch");
  assert.equal(z2mCategory("Light sensor", ["illuminance"]), "sensor");
  assert.equal(z2mCategory("Hue white ambiance GU10", ["light"]), "light");
  assert.equal(z2mCategory("Power strip with 4 sockets", ["switch"]), "smart-plug");
  assert.equal(z2mCategory("TRADFRI signal repeater", []), "hub");
  assert.equal(z2mCategory("Water valve", ["switch", "battery"]), "switch");
  assert.equal(z2mCategory("Thermostatic radiator valve", ["climate", "battery"]), "other");
  assert.equal(z2mCategory("Air quality station", ["co2", "temperature"]), "sensor");
  assert.equal(z2mPage("Pro Line X10"), "https://www.zigbee2mqtt.io/devices/Pro_Line_X10.html");
});

test("zigbee2mqtt definitions → records, white labels inherit fingerprint model IDs", () => {
  const recs = fromDefinitions([{
    vendor: "Tuya", model: "TS0601_trv", description: "Thermostatic radiator valve", exposes: ["climate"],
    zigbeeModel: ["TRV\u0000\u0000"],
    fingerprint: [{ modelID: "TS0601", manufacturerName: "_TZE200_a" }, { modelID: "TS0601", manufacturerName: "_TZE200_b" }],
    whiteLabel: [
      { vendor: "Girier", model: "ME168", fingerprint: [{ manufacturerName: "_TZE200_b" }] },
      { vendor: "Moes", model: "BRT-100" },
    ],
  }], D);
  allValid(recs);
  assert.deepEqual(recs.map((r) => r.id), ["tuya/ts0601-trv", "girier/me168", "moes/brt-100"]);
  assert.deepEqual(recs[0].identifiers!.zigbee_model, ["TRV", "TS0601"]);
  assert.deepEqual(recs[1].identifiers!.zigbee_model, ["TS0601"]);
  assert.equal(recs[1].projects![0].url, z2mPage("ME168"));
  assert.equal(recs[2].projects![0].url, z2mPage("TS0601_trv"));
  assert.equal(recs[0].status, "controllable");
});

test("openwrt mapping and parsing", () => {
  assert.equal(tohCategory("WiFi Router"), "router");
  assert.equal(tohCategory("Single Board Computer"), "single-board");
  assert.equal(tohCategory("Something new"), "other");
  assert.equal(tohCategory("Emulator"), null);
  assert.equal(fccFromUrl("https://fcc.io/R7F/A1"), "R7FA1");
  assert.equal(fccFromUrl("https://fcc.report/FCC-ID/MSQ-RTAC4A00"), "MSQ-RTAC4A00");
  assert.equal(fccFromUrl("https://fccid.io/2APRGRT02"), "2APRGRT02");
  assert.equal(fccFromUrl("http://No FCC"), null);
  assert.equal(fccFromUrl("http://-"), null);
  const columns = ["deviceid", "brand", "model", "version", "devicetype", "cpu", "fccid", "supportedcurrentrel", "devicepage"];
  const { records, skipped } = fromToh({ columns, entries: [
    ["tp-link:archer_c7_v5", "TP-Link", "Archer C7", ["v5"], "WiFi Router", "Qualcomm Atheros QCA9563", ["https://fcc.io/TE7/C7V5"], "25.12.2", "toh:tp-link:archer_c7"],
    ["hame:mpr-a1", "HAME", "MPR-A1", null, "Travel Router", "Ralink RT5350", null, "EOL", null],
    ["qemu:x86", "QEMU", "x86", null, "Emulator", "-", null, "25.12.2", null],
    ["foo:bar", "Foo", "Bar", null, "NAS", "-", null, "24.10.5", null],
  ] }, D);
  allValid(records);
  assert.equal(skipped, 2);
  assert.deepEqual(records[0], {
    id: "tp-link/archer-c7-v5", vendor: "TP-Link", model: "Archer C7 v5", category: "router",
    identifiers: { chips: ["Qualcomm Atheros QCA9563"], fcc_id: ["TE7C7V5"] }, status: "open-firmware",
    projects: [{ name: "OpenWrt", url: "https://openwrt.org/toh/tp-link/archer_c7", kind: "firmware", license: "GPL-2.0" }],
    provenance: { sources: ["openwrt"] }, updated: D,
  });
  assert.equal(records[1].projects![0].url, "https://openwrt.org/toh/hwdata/foo/bar");
  assert.deepEqual(records[1].identifiers!.chips, []);
});

test("tasmota template → record", () => {
  assert.equal(tasmotaCategory("Plug"), "smart-plug");
  assert.equal(tasmotaCategory("bulb"), "light");
  assert.equal(tasmotaCategory("whatever"), "other");
  assert.equal(tasmotaChip({ templatec3: "{}" }), "ESP32-C3");
  assert.equal(tasmotaChip({ template: "{}" }), "ESP8266");
  const r = fromTemplate("_templates/2nice_SP111", `---
date_added: 2020-01-10
title: 2nice
model: SP111
template: '{"NAME":"2NICE SP111","GPIO":[56,0,57],"FLAG":2,"BASE":18}'
category: plug
chip: CB2S
---
Free text that must not be copied.`, D)!;
  allValid([r]);
  assert.equal(r.id, "2nice/sp111");
  assert.deepEqual(r.identifiers, { chips: ["ESP8266", "CB2S"] });
  assert.equal(r.projects![0].url, "https://templates.blakadder.com/2nice_SP111.html");
  assert.equal(r.summary, undefined);
  assert.equal(fromTemplate("_templates/x", "no frontmatter", D), null);
});

test("esphome device page → record", () => {
  assert.equal(esphomeSlug("Anwio-A19-E26-RGBWW-8.5W-Light-Bulb"), "anwio-a19-e26-rgbww-85w-light-bulb");
  assert.equal(esphomeSlug("Apollo_Automation_BTN-1"), "apollo_automation_btn-1");
  assert.deepEqual(esphomeChips("esp32, RP2040"), ["ESP32", "RP2040"]);
  assert.deepEqual(esphomeChips(undefined), []);
  assert.equal(esphomeCategory("Relay"), "switch");
  const r = fromDevice("src/docs/devices/Arlec-PC399HA-Plug/index.md",
    "---\ntitle: Arlec PC399HA Plug\ndate-published: 2023-06-17\ntype: plug\nstandard: au\nboard: esp8266\n---\n# x", D)!;
  allValid([r]);
  assert.equal(r.id, "arlec/pc399ha-plug");
  assert.equal(r.category, "smart-plug");
  assert.equal(r.projects![0].url, "https://devices.esphome.io/devices/arlec-pc399ha-plug/");
});

test("thingino camera names and profiles", () => {
  assert.deepEqual(parseCameraName("tplink_tapo_c200_t23n_sc2336p_rtl8188ftv", "TP-Link Tapo C200 (T23N, SC2336P, RTL8188FTV)"),
    { vendor: "TP-Link", model: "Tapo C200", hardware: ["T23N", "SC2336P", "RTL8188FTV"] });
  assert.deepEqual(parseCameraName("wyze_cam3_t31al_gc2053_atbm6031", "Wyze Cam v3 (T31AL, GC2053, ATBM6031)").model, "Cam v3");
  assert.deepEqual(parseCameraName("jooan_w3u_x", "Jooan W3-U (T23N, SC2336P, ETH, ATBM6132U)").hardware, ["T23N", "SC2336P", "ATBM6132U"]);
  assert.deepEqual(parseCameraName("hc_3301ymt1_x", "HC-3301Y-MT1 (T31N)"), { vendor: "Generic", model: "HC-3301Y-MT1", hardware: ["T31N"] });
  const r = fromDefconfig("configs/cameras/wyze_cam3_t31al_gc2053_atbm6031/wyze_cam3_t31al_gc2053_atbm6031_defconfig",
    "# NAME: Wyze Cam v3 (T31AL, GC2053, ATBM6031)\n# FRAG: soc-xburst1\nBR2_SENSOR_1_NAME=\"gc2053\"\n", D)!;
  allValid([r]);
  assert.equal(r.id, "wyze/cam-v3");
  assert.equal(r.category, "ip-camera");
  assert.equal(fromDefconfig("configs/cameras/a/b_defconfig", "# NAME: X", D), null, "profile dir must match file name");
});
