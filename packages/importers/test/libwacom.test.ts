import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { parseTablet, usbIds, tabletName, fromTablet } from "../src/sources/libwacom.ts";

const D = "2026-10-25";

const INTUOS = `# Wacom
# Intuos Pro M
[Device]
Name=Wacom Intuos Pro M
ModelName=PTH-660
DeviceMatch=usb|056a|0357;bluetooth|056a|0360;
Class=Intuos5
IntegratedIn=

[Features]
Stylus=true
`;

test("libwacom parsing and names", () => {
  const d = parseTablet(INTUOS);
  assert.equal(d.Name, "Wacom Intuos Pro M");
  assert.equal(d.Class, "Intuos5");
  assert.equal(d.Stylus, undefined); // other sections ignored
  assert.deepEqual(usbIds(d.DeviceMatch), ["056a:0357"]);
  assert.deepEqual(usbIds("usb|256c|006e||HUION_T153;usb|256c|006e|TABLET Pen"), ["256c:006e", "256c:006e"]);
  assert.deepEqual(tabletName("Wacom Intuos Pro M", "PTH-660", "data/wacom-intuos-pro-2-m.tablet"), { vendor: "Wacom", model: "Intuos Pro M (PTH-660)" });
  assert.deepEqual(tabletName("KAMVAS 19", "KAMVAS 19", "data/huion-kamvas-19.tablet"), { vendor: "Huion", model: "KAMVAS 19" });
  assert.deepEqual(tabletName("Hanvon Ugee Technology Co.,Ltd Deco L", "", "data/xp-pen-deco-l.tablet"), { vendor: "XP-Pen", model: "Deco L" });
  assert.deepEqual(tabletName("LetSketch LetSketch", "WP9620", "data/letsketch-wp9620.tablet"), { vendor: "LetSketch", model: "LetSketch (WP9620)" });
  assert.equal(tabletName("Mystery", "", "data/nobody-x.tablet"), null);
});

test("libwacom records skip built-in digitizers", () => {
  const r = fromTablet("data/wacom-intuos-pro-2-m.tablet", parseTablet(INTUOS), D)!;
  assert.equal(r.id, "wacom/intuos-pro-m-pth-660");
  assert.equal(r.status, "controllable");
  assert.equal(r.projects![0].url, "https://github.com/linuxwacom/libwacom/blob/master/data/wacom-intuos-pro-2-m.tablet");
  assert.deepEqual(validate(r), []);
  assert.equal(fromTablet("data/isdv4-5000.tablet", { Name: "Wacom ISDv4 5000", IntegratedIn: "Display;System", DeviceMatch: "usb|056a|5000" }, D), null);
});
