import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { parseExampleDir, fromPaths } from "../src/sources/marlin.ts";
import { fromConfig } from "../src/sources/klipper.ts";

const D = "2026-10-17";
const E = "config/examples/";

test("marlin example directories", () => {
  assert.deepEqual(parseExampleDir(`${E}Creality/Ender-3 V2/CrealityV422/MarlinUI/Configuration.h`), { dir: "Creality/Ender-3 V2", vendor: "Creality", model: "Ender-3 V2", aliases: [] });
  assert.deepEqual(parseExampleDir(`${E}AnyCubic/i3 Mega/Trigorilla AVR/Configuration.h`), { dir: "AnyCubic/i3 Mega", vendor: "Anycubic", model: "i3 Mega", aliases: [] });
  assert.equal(parseExampleDir(`${E}Sovol/SV-06/Configuration.h`)!.model, "SV06");
  assert.equal(parseExampleDir(`${E}Kingroon/KP3S_Pro/Configuration.h`)!.model, "KP3S Pro");
  assert.equal(parseExampleDir(`${E}Ultimaker/Ultimaker Original (1.5.7)/Configuration.h`)!.model, "Original (1.5.7)");
  assert.equal(parseExampleDir(`${E}Ultimaker/Ultimaker 2/Configuration.h`)!.model, "Ultimaker 2");
  assert.deepEqual(parseExampleDir(`${E}delta/FLSUN/QQ-S/Configuration.h`), { dir: "delta/FLSUN/QQ-S", vendor: "FLSUN", model: "QQ-S", aliases: [] });
  assert.deepEqual(parseExampleDir(`${E}delta/Malyan M300/Configuration.h`), { dir: "delta/Malyan M300", vendor: "Malyan", model: "M300", aliases: [] });
  assert.equal(parseExampleDir(`${E}delta/Micromake-D1/RAMPS-1.4/Configuration.h`)!.model, "D1");
  assert.equal(parseExampleDir(`${E}Anet/A8plus/Configuration.h`)!.model, "A8 Plus");
  // not printers / no vendor
  for (const p of ["FoamCutter/generic", "Mks/Robin", "SCARA/Morgan", "delta/generic", "delta/kossel_mini", "Geeetech/GT2560", "RigidBot"]) {
    assert.equal(parseExampleDir(`${E}${p}/Configuration.h`), null, p);
  }
  assert.equal(parseExampleDir("config/default/Configuration.h"), null);
});

test("marlin paths → records, board variants merged, same ids as Klipper", () => {
  const recs = fromPaths([
    `${E}Creality/CR-10/BigTreeTech SKR Mini E3 2.0/Configuration.h`,
    `${E}Creality/CR-10/BigTreeTech SKR Mini E3 2.0/Configuration_adv.h`,
    `${E}Creality/CR-10/CrealityV1/Configuration.h`,
    `${E}MakerGear/M2 Rev H/Configuration.h`,
    `${E}FoamCutter/generic/Configuration.h`,
  ], D);
  for (const r of recs) assert.deepEqual(validate(r), [], JSON.stringify(r));
  assert.deepEqual(recs.map((r) => r.id), ["creality/cr-10", "makergear/m2"]);
  assert.equal(recs[0].projects![0].url, "https://github.com/MarlinFirmware/Configurations/tree/bugfix-2.1.x/config/examples/Creality/CR-10");
  assert.deepEqual(recs[1].aliases, ["M2 Rev H"]);
  assert.equal(recs[0].status, "open-firmware");
  assert.deepEqual(recs[0].provenance, { sources: ["marlin"] });
  assert.equal(fromConfig("config/printer-creality-cr10-2017.cfg", "", D)[0].id, recs[0].id);
  assert.equal(fromConfig("config/printer-makergear-m2-2016.cfg", "", D)[0].id, recs[1].id);
  assert.equal(fromPaths([`${E}Sovol/SV-01/CrealityV22/Configuration.h`], D)[0].id, fromConfig("config/printer-sovol-sv01-2020.cfg", "", D)[0].id);
});

test("marlin install route: SD card by default, the 8-bit exceptions in the notes", () => {
  const [r] = fromPaths([`${E}Creality/Ender-3 V2/CrealityV422/Configuration.h`], D);
  assert.deepEqual(validate(r), []);
  assert.equal(r.install!.length, 1);
  const i = r.install![0];
  assert.equal(i.project, "Marlin");
  assert.equal(i.method, "sd-card");
  assert.equal(i.guide, "https://marlinfw.org/docs/basics/install.html");
  assert.equal(i.difficulty, "medium");
  assert.equal(i.brick_risk, "low");
  assert.equal(i.reversible, "partial");
  assert.match(i.notes!, /8-bit boards are flashed over USB/);
});
