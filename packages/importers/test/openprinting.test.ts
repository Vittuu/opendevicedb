import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { parsePrinter, parseDriver, fromDatabase, printerPage } from "../src/sources/openprinting.ts";

const D = "2026-10-25";

const LJ1020 = `<printer id="printer/HP-LaserJet_1020">
  <make>HP</make>
  <model>LaserJet 1020</model>
  <lang><proprietary /><pjl /></lang>
  <functionality>B</functionality>
  <driver>foo2zjs-z1</driver>
  <comments><en>&lt;b&gt;Needs firmware&lt;/b&gt; <driver>not-this</driver></en></comments>
</printer>`;
const HL2140 = `<printer id="printer/Brother-HL-2140">
  <make>Brother</make><model>HL-2140</model>
  <lang><postscript level="2" /><pcl level="5e" /></lang>
  <functionality>B</functionality><driver>hpijs-pcl5e</driver>
</printer>`;
const KM = `<printer id="printer/KONICA_MINOLTA-magicolor_2300W">
  <make>KONICA MINOLTA</make><model>magicolor 2300W</model>
  <functionality>D</functionality><driver>m2300w</driver>
</printer>`;
const FOO = `<driver id="driver/foo2zjs-z1">
  <name>foo2zjs-z1</name><url>https://github.com/OpenPrinting/foo2zjs</url>
  <printers>
    <printer><id>printer/HP-LaserJet_1020</id><comments><en>ok</en></comments></printer>
    <printer><id>printer/KONICA_MINOLTA-magicolor_2300W</id></printer>
  </printers>
</driver>`;
const LJET4 = `<driver id="driver/ljet4"><name>ljet4</name><printers><printer><id>printer/HP-LaserJet_1020</id></printer></printers></driver>`;

test("openprinting XML parsing", () => {
  const p = parsePrinter(LJ1020)!;
  assert.deepEqual(p, { id: "HP-LaserJet_1020", make: "HP", model: "LaserJet 1020", functionality: "B", driver: "foo2zjs-z1", langs: ["proprietary", "pjl"] });
  assert.deepEqual(parsePrinter(HL2140)!.langs, ["postscript", "pcl"]);
  assert.deepEqual(parseDriver(FOO), { name: "foo2zjs-z1", url: "https://github.com/OpenPrinting/foo2zjs", printers: ["HP-LaserJet_1020", "KONICA_MINOLTA-magicolor_2300W"] });
  assert.equal(printerPage(parsePrinter(KM)!), "https://openprinting.github.io/foomatic/printer/KONICA_MINOLTA/KONICA_MINOLTA-magicolor_2300W");
});

test("openprinting keeps working printers that need a specific driver", () => {
  const rs = fromDatabase([LJ1020, HL2140, KM].map((x) => parsePrinter(x)!), [FOO, LJET4].map((x) => parseDriver(x)!), D);
  assert.deepEqual(rs.map((r) => r.id), ["hp/laserjet-1020"]); // PostScript/PCL and rating D dropped
  const r = rs[0];
  assert.deepEqual(r.projects!.map((p) => p.name), ["foo2zjs-z1", "OpenPrinting: HP LaserJet 1020"]); // generic ljet4 not listed
  assert.equal(r.install![0].project, "foo2zjs-z1");
  assert.equal(r.interfaces![0].status, "partial");
  assert.deepEqual(validate(r), []);
});
