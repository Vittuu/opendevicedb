import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { fromTemplate, tasmotaFlash, tasmotaMains, tasmotaInstall, MAINS_WARNING } from "../src/sources/tasmota.ts";

const D = "2026-10-17";
const tpl = (file: string, fm: string) => fromTemplate(`_templates/${file}`, `---\n${fm}\n---\nbody`, D)!;
const G = "https://templates.blakadder.com/x.html";

test("tasmota flash field and mains detection", () => {
  assert.deepEqual(tasmotaFlash({ flash: "tuya-convert" }), ["tuya-convert"]);
  assert.deepEqual(tasmotaFlash({ flash: "tuya-convert or serial" }), ["tuya-convert", "serial"]);
  assert.deepEqual(tasmotaFlash({ flash: "Serial Flashing", flash2: "tuya-convert" }), ["tuya-convert", "serial"]);
  assert.deepEqual(tasmotaFlash({ flash: "mgos32" }), ["mgos32"]);
  assert.deepEqual(tasmotaFlash({ flash: "replace module" }), ["replace"]);
  assert.deepEqual(tasmotaFlash({ flash: "" }), []);
  assert.equal(tasmotaMains({ category: "plug", type: "Plug" }), true);
  assert.equal(tasmotaMains({ category: "light", type: "Ceiling Light" }), true);
  assert.equal(tasmotaMains({ category: "light", type: "LED Controller" }), false);
  assert.equal(tasmotaMains({ category: "relay", type: "DIN Relay" }), true);
  assert.equal(tasmotaMains({ category: "relay", type: "Relay Board" }), false);
});

test("tasmota install routes", () => {
  const tc = tpl("ce_smart_home-LQ-2-W3.md", "title: CE Smart Home LQ-2-W3\nmodel: 2AMQ8-WIFI-008\nflash: tuya-convert\ncategory: plug\ntype: Wall Outlet");
  assert.deepEqual(validate(tc), []);
  assert.deepEqual(tc.install, [{
    project: "Tasmota", guide: "https://templates.blakadder.com/ce_smart_home-LQ-2-W3.html", method: "ota-exploit",
    installer: "https://github.com/ct-Open-Source/tuya-convert", difficulty: "medium", tools: ["Linux computer with Wi-Fi (e.g. Raspberry Pi)"],
    opens_device: false, brick_risk: "low", reversible: "partial",
    firmware_constraints: "tuya-convert only works on Tuya firmware released before its 2020 patch; patched devices must be flashed over serial.",
  }]);

  // mains plug opened for serial flashing: warning, no installer link
  const serial = tpl("gosund_SP111.md", "title: Gosund SP111\nflash: serial\ncategory: plug\ntype: Plug");
  assert.deepEqual(validate(serial), []);
  assert.deepEqual(serial.install, [{
    project: "Tasmota", guide: "https://templates.blakadder.com/gosund_SP111.html", difficulty: "hard", opens_device: true, mains_powered: true,
    notes: MAINS_WARNING, method: "serial", tools: ["USB-serial adapter, 3.3 V", "Jumper wires or soldering iron"], brick_risk: "low", reversible: "partial",
  }]);

  const pre = tpl("athom_PG01V2.md", "title: Athom Smart Plug\nmodel: PG01V2\nflash: preflashed\ncategory: plug\ntype: Plug");
  assert.deepEqual(pre.install, [{ project: "Tasmota", guide: "https://templates.blakadder.com/athom_PG01V2.html", method: "other", difficulty: "easy",
    brick_risk: "none", notes: "Sold with Tasmota already installed: apply the template from the guide." }]);

  const both = tasmotaInstall({ flash: "tuya-convert or serial", category: "bulb", type: "RGBCCT" }, G);
  assert.deepEqual(both.map((r) => [r.method, r.difficulty, r.mains_powered]), [["ota-exploit", "medium", undefined], ["serial", "hard", true]]);

  const shelly = tasmotaInstall({ flash: "mgos32", category: "relay", type: "Relay Module" }, G);
  assert.deepEqual(shelly.map((r) => [r.method, r.difficulty, r.installer]), [["vendor-upload", "easy", "https://github.com/tasmota/mgos32-to-tasmota32"]]);

  const swap = tasmotaInstall({ flash: "replace", category: "switch", type: "Switch" }, G);
  assert.equal(swap[0].method, "other");
  assert.match(swap[0].notes!, /^Mains-powered.*desoldered and replaced with an ESP module/);

  // development boards: USB, no opening; bare modules: USB-serial adapter, no case
  const board = tasmotaInstall({ flash: "serial", category: "diy", type: "Development Board" }, G);
  assert.deepEqual(board.map((r) => [r.method, r.difficulty, r.opens_device, r.installer]), [["web-serial", "medium", false, "https://tasmota.github.io/install/"]]);
  const module = tasmotaInstall({ category: "diy", type: "Module" }, G);
  assert.deepEqual(module.map((r) => [r.method, r.difficulty, r.opens_device]), [["serial", "medium", false]]);

  // no flash field: serial; a relay board of unknown supply keeps the web installer
  const relay = tasmotaInstall({ category: "relay", type: "Relay Board" }, G);
  assert.deepEqual(relay.map((r) => [r.method, r.difficulty, r.mains_powered, r.installer]), [["serial", "hard", undefined, "https://tasmota.github.io/install/"]]);

  // newer hardware with an incompatible chip: no route
  assert.deepEqual(tasmotaInstall({ flash: "serial", category: "bulb", unsupported: true }, G), []);
  assert.equal(tpl("aisirer_X.md", "title: Aisirer X\nflash: serial\ncategory: bulb\nunsupported: true").install!.length, 0);
});

test("tasmota page URL of a file name with a space (Jekyll slug)", () => {
  assert.equal(tpl("fontastic_ P22-2036563-DZB117435", "title: Fontastic P22\nflash: serial\ncategory: plug").projects![0].url, "https://templates.blakadder.com/fontastic_-P22-2036563-DZB117435.html");
  const r = tpl("tate_guard_TT-OTPW- STTIP", "title: Tate Guard STTIP\nflash: serial\ncategory: plug");
  assert.equal(r.projects![0].url, "https://templates.blakadder.com/tate_guard_TT-OTPW-STTIP.html");
  assert.equal(r.install![0].guide, r.projects![0].url);
  assert.deepEqual(r.projects![0].freedom, { nonfree: ["wifi"], cloud: "none", notes: "The ESP Wi-Fi stack ships as a binary blob from Espressif" });
});

test("tasmota template Jekyll does not publish (blank line before the fence): general guide", () => {
  const r = fromTemplate("_templates/TY-IR-01", "\n---\ntitle: TY-IR-01\nmodel: TY-IR-01\nflash: serial\ncategory: misc\ntype: IR Controller\n---\n", D)!;
  assert.deepEqual(validate(r), []);
  assert.equal(r.install![0].guide, "https://tasmota.github.io/docs/Getting-Started/");
});
