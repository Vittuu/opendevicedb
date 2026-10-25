import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { parseDesc, fromModel, saneVendor, manPage } from "../src/sources/sane.ts";

const D = "2026-10-25";
const allValid = (rs: DeviceRecord[]) => { for (const r of rs) assert.deepEqual(validate(r), [], JSON.stringify(r)); };

const GENESYS = `:backend "genesys"                ; name of backend
:url "http://www.meier-geinitz.de/sane/genesys-backend/"
:devicetype :scanner

:mfg "Plustek"
:url "http://www.plustek.de/"

:model "OpticFilm 7200i"
:interface "USB"
:usbid "0x07b3" "0x0c04"
:status :complete
:comment "Infrared mode supported"

:model "OpticBook 3600"
:interface "USB"
:usbid "0x07b3" "0x0900"
:status     :basic

:mfg "Hewlett-Packard"
:model "ScanJet 2400c"
:interface "USB"
:usbid "0x03f0" "0x0a01"
:status :untested

:model "ScanJet 4850C"
:interface "USB"
:usbid "0x3f0" "0x1b05"
:status :good
:comment "Needs the firmware file from the Windows driver"
`;

test("sane .desc parsing", () => {
  const ms = parseDesc(GENESYS);
  assert.equal(ms.length, 4);
  assert.deepEqual(ms[0], {
    backend: "genesys", devicetype: "scanner", mfg: "Plustek", model: "OpticFilm 7200i",
    interfaces: ["USB"], usb: ["07b3:0c04"], status: "complete", comment: "Infrared mode supported",
  });
  assert.equal(ms[1].status, "basic");
  assert.equal(ms[2].mfg, "Hewlett-Packard");
  assert.deepEqual(ms[3].usb, ["03f0:1b05"]); // short hex padded
});

test("sane records: status mapping, skipped entries and backends", () => {
  const ms = parseDesc(GENESYS);
  const [a, b, c, d] = ms.map((m) => fromModel(m, D));
  assert.equal(a!.id, "plustek/opticfilm-7200i");
  assert.equal(a!.status, "controllable");
  assert.equal(a!.projects![0].url, manPage("genesys"));
  assert.deepEqual(a!.projects![0].freedom, { nonfree: ["device-firmware"], cloud: "none" });
  assert.equal(a!.install![0].difficulty, "easy");
  assert.equal(b!.status, "partial-protocol");
  assert.equal(c, null); // untested
  assert.equal(d!.vendor, "HP");
  assert.equal(d!.install![0].difficulty, "medium"); // firmware file needed
  assert.equal(fromModel({ ...ms[0], backend: "escl" }, D), null);
  assert.equal(fromModel({ ...ms[0], backend: "gphoto2", devicetype: "stillcam" }, D), null);
  assert.equal(fromModel({ ...ms[0], devicetype: "stillcam", backend: "dc240" }, D)!.category, "camera");
  assert.equal(saneVendor("hewlett-packard"), "HP");
  const f = finalize([a, b, d].filter(Boolean) as DeviceRecord[]);
  assert.equal(f.invalid, 0);
  allValid(f.records);
});
