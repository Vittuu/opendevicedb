import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { printerVendor, canonModel, prettyBoard, headerChips, parseConfigName, parseBoardName, fromConfig } from "../src/sources/klipper.ts";

const D = "2026-10-17";
const allValid = (rs: DeviceRecord[]) => {
  for (const r of rs) assert.deepEqual(validate(r), [], JSON.stringify(r));
};

const CR10 = `# This file contains common pin mappings for the 2017 Creality
# CR-10. To use this config, the firmware should be compiled for the
# AVR atmega1284p.

[stepper_x]
step_pin: PD7
`;

test("klipper shared names", () => {
  assert.equal(printerVendor("AnyCubic"), "Anycubic");
  assert.equal(printerVendor("twotrees"), "Two Trees");
  assert.equal(printerVendor("Prusa Research"), "Prusa");
  assert.equal(printerVendor("Some New Brand"), "Some New Brand");
  assert.equal(canonModel("Creality", "Ender 3 V2"), "Ender-3 V2");
  assert.equal(canonModel("Creality", "cr10s Pro"), "CR-10s Pro");
  assert.equal(canonModel("Creality", "Sermoon D1"), "Sermoon D1");
  assert.equal(canonModel("Sovol", "SV-06 Plus"), "SV06 Plus");
  assert.equal(canonModel("Anet", "A8 Plus"), "A8 Plus");
});

test("klipper config names", () => {
  assert.deepEqual(parseConfigName("config/printer-creality-ender3pro-2020.cfg"), { vendor: "Creality", models: [{ model: "Ender-3 Pro", aliases: [] }], year: "2020", kind: "printer" });
  assert.equal(parseConfigName("config/printer-anet-a8-2019.cfg")!.models[0].model, "A8 Plus");
  assert.equal(parseConfigName("config/printer-anet-a8-2017.cfg")!.models[0].model, "A8");
  assert.deepEqual(parseConfigName("config/printer-creality-ender3-s1-2021.cfg")!.models.map((m) => m.model), ["Ender-3 S1", "Ender-3 S1 Pro"]);
  // unknown file: model words from the name
  assert.deepEqual(parseConfigName("config/printer-newco-zoom-x2-2025.cfg"), { vendor: "Newco", models: [{ model: "Zoom X2" }], year: "2025", kind: "printer" });
  assert.equal(parseConfigName("config/kit-voron2-250mm.cfg")!.vendor, "Voron Design");
  assert.equal(parseConfigName("config/generic-ramps.cfg"), null);
  assert.equal(parseConfigName("config/example-cartesian.cfg"), null);
  assert.equal(parseConfigName("docs/printer-x-2020.cfg"), null);
});

test("klipper controller boards", () => {
  assert.equal(prettyBoard("skr-mini-e3-v3.0"), "SKR Mini E3 V3.0");
  assert.equal(prettyBoard("octopus-max-ez"), "Octopus Max EZ");
  assert.equal(prettyBoard("monster8"), "Monster8");
  assert.deepEqual(parseBoardName("config/generic-bigtreetech-manta-m8p-v1.1.cfg"), { vendor: "BigTreeTech", model: "Manta M8P V1.1" });
  assert.deepEqual(parseBoardName("config/generic-duet3-mini.cfg"), { vendor: "Duet3D", model: "Duet 3 Mini 5+" });
  assert.equal(parseBoardName("config/generic-ramps.cfg"), null, "open designs are skipped");
  assert.equal(parseBoardName("config/printer-creality-cr10-2017.cfg"), null);
});

test("klipper header chips", () => {
  assert.deepEqual(headerChips(CR10), ["ATmega1284P"]);
  assert.deepEqual(headerChips("# Anycubic Vyper. It uses a clone of the STM32F103 chip named GD32F103.\n"), ["STM32F103", "GD32F103"]);
  assert.deepEqual(headerChips("[mcu]\n# compiled for the STM32F103\n"), [], "only the header comment counts");
});

test("klipper configs → records, year variants merge", () => {
  const a = fromConfig("config/printer-makergear-m2-2012.cfg", "# Support for Makergear M2 printers circa 2012\n# compiled for the AVR atmega2560.\n", D);
  const b = fromConfig("config/printer-makergear-m2-2016.cfg", "# Support for Makergear M2 printers circa 2016\n", D);
  const cr10 = fromConfig("config/printer-creality-cr10-2017.cfg", CR10, D);
  const board = fromConfig("config/generic-bigtreetech-skr-mini-e3-v2.0.cfg", "# BIGTREETECH SKR mini E3 v2.0, compiled for the STM32F103\n", D);
  allValid([...a, ...b, ...cr10, ...board]);
  assert.deepEqual(cr10[0], {
    id: "creality/cr-10", vendor: "Creality", model: "CR-10", aliases: ["CR-10 (2017)"], category: "3d-printer",
    summary: "Klipper ships a config for this printer (config/printer-creality-cr10-2017.cfg); its controller board is flashed with the Klipper firmware (MCU: ATmega1284P).",
    identifiers: { chips: ["ATmega1284P"] }, status: "open-firmware",
    projects: [{ name: "Klipper (printer-creality-cr10-2017.cfg)", url: "https://github.com/Klipper3d/klipper/blob/master/config/printer-creality-cr10-2017.cfg", kind: "firmware", license: "GPL-3.0" }],
    provenance: { sources: ["klipper"] }, updated: D,
  });
  assert.equal(board[0].id, "bigtreetech/skr-mini-e3-v2-0");
  assert.equal(board[0].category, "other");
  const f = finalize([...a, ...b]);
  assert.equal(f.merged, 1);
  assert.deepEqual(f.records[0].aliases, ["M2 (2012)", "M2 (2016)"]);
  assert.equal(f.records[0].projects!.length, 2);
  assert.deepEqual(fromConfig("config/generic-simulavr.cfg", "# simulavr\n", D), []);
});
