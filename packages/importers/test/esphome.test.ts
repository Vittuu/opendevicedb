import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { fromDevice, esphomeDifficulty, esphomeMains, esphomeInstall, MAINS_WARNING } from "../src/sources/esphome.ts";

const D = "2026-10-17";
const page = (dir: string, fm: string) => fromDevice(`src/docs/devices/${dir}/index.md`, `---\n${fm}\n---\nbody`, D)!;
const G = "https://devices.esphome.io/devices/x/";

test("esphome difficulty and mains detection", () => {
  assert.equal(esphomeDifficulty(2), 2);
  assert.equal(esphomeDifficulty("4"), 4);
  assert.equal(esphomeDifficulty("Soldering required"), 4);
  assert.equal(esphomeDifficulty(undefined), undefined);
  assert.equal(esphomeDifficulty("lots"), undefined);
  assert.equal(esphomeMains("plug", "Athom PG01V2"), true);
  assert.equal(esphomeMains("light", "Mirabella Genio 9W A60 Bulb"), true);
  assert.equal(esphomeMains("light", "Generic RGB LED strip controller"), false);
  assert.equal(esphomeMains("relay", "Sonoff 4CH"), false, "relay boards: unknown supply");
});

test("esphome install routes from made-for-esphome and difficulty", () => {
  const made = page("Athom-Smart-Plug-V2", "title: Athom Smart Plug V2\ntype: plug\nboard: esp8266\nmade-for-esphome: True\ndifficulty: 1");
  assert.deepEqual(validate(made), []);
  assert.deepEqual(made.install, [{
    project: "ESPHome", guide: "https://devices.esphome.io/devices/athom-smart-plug-v2/", method: "other", difficulty: "easy", brick_risk: "none",
    notes: "Ships with ESPHome: adopt it in the ESPHome dashboard or Home Assistant; nothing to flash.",
  }]);

  const plugNFlash = page("M5Stack-Atom", "title: M5Stack Atom Lite\ntype: misc\nboard: esp32\ndifficulty: 2");
  assert.deepEqual(validate(plugNFlash), []);
  assert.deepEqual(plugNFlash.install, [{
    project: "ESPHome", guide: "https://devices.esphome.io/devices/m5stack-atom/", method: "web-serial", installer: "https://web.esphome.io/",
    difficulty: "medium", tools: ["USB cable"], opens_device: false, brick_risk: "low", reversible: "partial",
  }]);

  // mains device that must be opened: warning, no installer link
  const plug = page("Gosund-SP111", "title: Gosund SP111\ntype: plug\nboard: esp8266\ndifficulty: 4");
  assert.deepEqual(validate(plug), []);
  assert.deepEqual(plug.install, [{
    project: "ESPHome", guide: "https://devices.esphome.io/devices/gosund-sp111/", difficulty: "hard", opens_device: true, mains_powered: true,
    brick_risk: "low", reversible: "partial", method: "serial", tools: ["USB-serial adapter, 3.3 V", "Soldering iron"], notes: MAINS_WARNING,
  }]);

  // no difficulty: serial by default; a relay board of unknown supply keeps the web installer
  const relay = page("Sonoff-4CH", "title: Sonoff 4CH\ntype: relay\nboard: esp8266");
  assert.equal(relay.install![0].method, "serial");
  assert.equal(relay.install![0].difficulty, "hard");
  assert.equal(relay.install![0].installer, "https://web.esphome.io/");
  assert.equal(relay.install![0].mains_powered, undefined);
  assert.equal(relay.install![0].notes, undefined);

  // chip replacement
  const swap = esphomeInstall({ type: "light", difficulty: 5 }, G, ["BK72xx"], "Some Bulb");
  assert.equal(swap[0].method, "other");
  assert.equal(swap[0].brick_risk, "medium");
  assert.match(swap[0].notes!, /^Mains-powered.*replaced with a supported module.*ltchiptool/);
});

test("esphome web installer only for ESP chips", () => {
  const bk = esphomeInstall({ type: "misc", difficulty: 2 }, G, ["BK72xx"], "Board");
  assert.equal(bk[0].method, "other");
  assert.equal(bk[0].installer, undefined);
  assert.match(bk[0].notes!, /ltchiptool/);
  const rp = esphomeInstall({ type: "misc", difficulty: 2 }, G, ["RP2040"], "Pico board");
  assert.equal(rp[0].method, "usb-bootloader");
  assert.equal(rp[0].notes, undefined);
  assert.equal(esphomeInstall({ type: "misc", difficulty: 3 }, G, [], "Thing")[0].installer, undefined, "unknown chip: no installer");
});

test("esphome plug-n-flash: over the air for Tuya devices, USB for boards, else the page's steps", () => {
  const cc = fromDevice("src/docs/devices/Status-Wifi-Plug/index.md", "---\ntitle: Status Wifi Plug\ntype: plug\nboard: bk72xx\ndifficulty: 2\n---\nFlash with tuya-cloudcutter.", D)!;
  assert.deepEqual(validate(cc), []);
  assert.equal(cc.install![0].method, "ota-exploit");
  assert.equal(cc.install![0].installer, "https://github.com/tuya-cloudcutter/tuya-cloudcutter");
  assert.equal(cc.install![0].opens_device, false);
  assert.match(cc.install![0].firmware_constraints!, /vulnerable/);
  const tc = esphomeInstall({ type: "light", difficulty: 2 }, G, ["ESP8266"], "Cocoon Bulb", "Use tuya-convert to flash it.");
  assert.equal(tc[0].installer, "https://github.com/ct-Open-Source/tuya-convert");
  const shelly = esphomeInstall({ type: "relay", difficulty: 2 }, G, ["ESP32"], "Shelly 1PM Gen3", "Upload over OTA.");
  assert.deepEqual([shelly[0].method, shelly[0].installer, shelly[0].opens_device], ["other", undefined, false]);
  assert.match(shelly[0].notes!, /No disassembly needed/);
  const plug = esphomeInstall({ type: "plug", difficulty: 2 }, G, ["ESP8266"], "CurrySmarter Plug");
  assert.equal(plug[0].method, "other", "a plug is not flashed over a USB cable");
});
