import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { fromSources, parseDefines, parseDetectors, parseDocCategories, resolveNumber, resolveString, splitDeviceName, stripComments } from "../src/sources/openrgb.ts";

const D = "2026-10-17";

test("openrgb C scanning", () => {
  assert.equal(stripComments('a // x\n"b // c" /* d */e'), 'a \n"b // c"        e');
  const defs = parseDefines("#define RAZER_VID 0x1532 // Razer\n#define NAGA_PID RAZER_NAGA\n#define RAZER_NAGA 0x008F\n#define NAME \"Razer \" \"Naga\"\n#define F(x) x\n");
  const lk = (n: string) => defs.get(n);
  assert.equal(resolveNumber("RAZER_VID", lk), 0x1532);
  assert.equal(resolveNumber("NAGA_PID", lk), 0x8f);
  assert.equal(resolveNumber("HID_PID_ANY", lk), null);
  assert.equal(resolveString("NAME", lk), "Razer Naga");
  assert.equal(defs.has("F"), false, "function-like macros are not values");
  const dets = parseDetectors([
    "#define REGISTER_HID_DETECTOR(name, func, vid, pid) static X y(name, func, vid, pid)",
    'REGISTER_HID_DETECTOR_IPU("Razer Naga (Wired)", DetectRazer, RAZER_VID, 0x0091, 0x00, F(1), 0x02);',
    '// REGISTER_HID_DETECTOR("Commented", DetectX, 1, 2);',
  ].join("\n"));
  assert.deepEqual(dets, [{ macro: "REGISTER_HID_DETECTOR_IPU", args: ['"Razer Naga (Wired)"', "DetectRazer", "RAZER_VID", "0x0091", "0x00", "F(1)", "0x02"] }]);
  const cats = parseDocCategories("/**------\n    @name Razer\n    @category Keyboard,Mouse\n    @detectors DetectRazer,DetectRazerKraken\n\\*------*/");
  assert.deepEqual(cats.get("DetectRazerKraken"), ["keyboard", "mouse"]);
});

test("openrgb name split", () => {
  const v = ["Razer", "Cooler Master", "Cooler"];
  assert.deepEqual(splitDeviceName("Razer Naga Pro V2 (Wired)", v), { vendor: "Razer", model: "Naga Pro V2" });
  assert.deepEqual(splitDeviceName("Cooler Master MP750 Large", v), { vendor: "Cooler Master", model: "MP750 Large" });
  assert.deepEqual(splitDeviceName("Thermaltake Riing (PID 0x1FB3)", v), { vendor: "Thermaltake", model: "Riing" });
  assert.deepEqual(splitDeviceName("Wooting", v), { vendor: "Wooting", model: "Wooting" });
});

test("openrgb sources → records", () => {
  const files = new Map([
    ["Controllers/RazerController/RazerDevices.h", "#define RAZER_VID 0x1532\n#define RAZER_NAGA_WIRED_PID 0x008F\n#define RAZER_NAGA_WIRELESS_PID 0x0090\n"],
    ["Controllers/RazerController/RazerControllerDetect.cpp", [
      'REGISTER_HID_DETECTOR_IPU("Razer Naga Pro (Wired)", DetectRazerControllers, RAZER_VID, RAZER_NAGA_WIRED_PID, 0x00, 0x01, 0x02);',
      'REGISTER_HID_DETECTOR_IPU("Razer Naga Pro (Wireless)", DetectRazerControllers, RAZER_VID, RAZER_NAGA_WIRELESS_PID, 0x00, 0x01, 0x02);',
      'REGISTER_HID_DETECTOR_BPU("Logitech HID++ 2.0", DetectLogitechHIDPP20, LOGITECH_VID, HID_PID_ANY, HID_API_BUS_USB, 0xFF00, 2);',
      'REGISTER_DETECTOR("Philips Hue", DetectPhilipsHueControllers);',
    ].join("\n")],
    ["Controllers/RazerController/RGBController_Razer.cpp", '/**\n    @name Razer\n    @category Mouse\n    @detectors DetectRazerControllers\n\\*/\nvendor = "Razer";'],
    ["Controllers/EVGAGPUController/EVGAGPUDetect.cpp", 'REGISTER_I2C_PCI_DETECTOR("EVGA GeForce RTX 2080 Ti XC Ultra", DetectEVGA, NVIDIA_VEN, NVIDIA_RTX2080TI_DEV, EVGA_SUB_VEN, EVGA_SUB_DEV, 0x49);'],
  ]);
  const { records, detectors, skipped } = fromSources(files, D);
  assert.equal(detectors, 5);
  assert.equal(skipped, 2);
  const f = finalize(records);
  assert.equal(f.invalid, 0);
  assert.equal(f.merged, 1, "wired and wireless are one product");
  for (const r of f.records) assert.deepEqual(validate(r), [], JSON.stringify(r));
  assert.deepEqual(f.records.map((r) => r.id), ["evga/geforce-rtx-2080-ti-xc-ultra", "razer/naga-pro"]);
  const razer = f.records[1];
  assert.deepEqual(razer.identifiers, { usb: ["1532:008f", "1532:0090"] });
  assert.equal(razer.category, "peripheral");
  assert.equal(razer.status, "controllable");
  assert.deepEqual(razer.projects, [{ name: "OpenRGB", url: "https://gitlab.com/CalcProgrammer1/OpenRGB/-/tree/master/Controllers/RazerController", kind: "driver", license: "GPL-2.0-or-later", freedom: { nonfree: ["device-firmware"], cloud: "none" } }]);
  assert.equal(f.records[0].identifiers, undefined, "SMBus GPUs have no USB id");
  assert.equal(f.records[0].interfaces![0].transport, "other");
});

test("openrgb install route: host software, SMBus devices need access set up first", () => {
  const files = new Map([
    ["Controllers/RazerController/RazerControllerDetect.cpp", 'REGISTER_HID_DETECTOR_IPU("Razer Naga Pro (Wired)", DetectRazerControllers, 0x1532, 0x008F, 0x00, 0x01, 0x02);'],
    ["Controllers/EVGAGPUController/EVGAGPUDetect.cpp", 'REGISTER_I2C_PCI_DETECTOR("EVGA GeForce RTX 2080 Ti XC Ultra", DetectEVGA, NVIDIA_VEN, NVIDIA_RTX2080TI_DEV, EVGA_SUB_VEN, EVGA_SUB_DEV, 0x49);'],
  ]);
  const { records } = fromSources(files, D);
  const [usb] = records.filter((r) => r.vendor === "Razer"), [smbus] = records.filter((r) => r.vendor === "EVGA");
  for (const r of [usb, smbus]) assert.deepEqual(validate(r), [], JSON.stringify(r));
  assert.deepEqual(usb.install, [{
    project: "OpenRGB", method: "host-software",
    guide: "https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Documentation/USBAccess.md",
    installer: "https://openrgb.org/releases.html", difficulty: "easy", brick_risk: "low", reversible: "yes",
    notes: "Nothing is flashed: OpenRGB sets the lighting over USB from your computer. OpenRGB warns that its reverse-engineered protocols have damaged some hardware in the past.",
  }]);
  assert.equal(smbus.install![0].guide, "https://gitlab.com/CalcProgrammer1/OpenRGB/-/blob/master/Documentation/SMBusAccess.md");
  assert.equal(smbus.install![0].difficulty, "medium");
  assert.match(smbus.install![0].notes!, /SMBus\/I2C access must be enabled/);
});
