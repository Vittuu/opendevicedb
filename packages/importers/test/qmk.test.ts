import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { fromKeyboards, qmkName, usbId, qmkFreedom, type QmkKeyboard } from "../src/sources/qmk.ts";

const D = "2026-10-25";
const allValid = (rs: DeviceRecord[]) => { for (const r of rs) assert.deepEqual(validate(r), [], JSON.stringify(r)); };

const kb = (folder: string, name: string, mfr: string, vid: string, pid: string, boot = "stm32-dfu", proc = "STM32L432"): QmkKeyboard =>
  ({ keyboard_folder: folder, keyboard_name: name, manufacturer: mfr, usb: { vid, pid }, bootloader: boot, processor: proc });

test("qmk names and USB ids", () => {
  assert.deepEqual(qmkName(kb("keychron/q1v2/ansi", "Keychron Q1", "Keychron", "0x3434", "0x0106")), { vendor: "Keychron", model: "Q1" });
  assert.equal(qmkName(kb("x/y", "Thing", "QMK", "0x1", "0x2")), null);
  assert.equal(usbId(kb("a", "A", "M", "0x3434", "0x106")), "3434:0106");
  assert.equal(usbId(kb("a", "A", "M", "0xFEED", "0x6060")), null); // QMK placeholder vendor
});

test("qmk freedom from the bootloader", () => {
  assert.deepEqual(qmkFreedom(["caterina"]), { nonfree: [], cloud: "none" });
  assert.deepEqual(qmkFreedom(["atmel-dfu"]).nonfree, ["bootloader"]);
  assert.deepEqual(qmkFreedom(["something-new"]), { cloud: "none" });
});

test("qmk records: variants merged, shared ids and handwired builds dropped", () => {
  const { records, skipped } = fromKeyboards([
    kb("keychron/q1v2/ansi", "Keychron Q1", "Keychron", "0x3434", "0x0106"),
    kb("keychron/q1v2/iso", "Keychron Q1", "Keychron", "0x3434", "0x0107"),
    kb("acme/one", "One", "Acme", "0x1234", "0x0001", "caterina", "atmega32u4"),
    kb("other/two", "Two", "Other", "0x1234", "0x0001", "caterina", "atmega32u4"), // same id as acme/one
    kb("handwired/foo", "Foo", "me", "0x4444", "0x0001"),
  ], D);
  assert.equal(skipped, 1);
  const q1 = records.find((r) => r.id === "keychron/q1")!;
  assert.deepEqual(q1.identifiers!.usb, ["3434:0106", "3434:0107"]);
  assert.equal(q1.projects![0].url, "https://github.com/qmk/qmk_firmware/tree/master/keyboards/keychron/q1v2");
  assert.equal(q1.status, "open-firmware");
  assert.equal(q1.install![0].method, "usb-bootloader");
  assert.deepEqual(records.find((r) => r.id === "acme/one")!.identifiers!.usb, []);
  const f = finalize(records);
  assert.equal(f.invalid, 0);
  allValid(f.records);
});
