import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { radioName, fromTargets, latestMinors } from "../src/sources/edgetx.ts";

const D = "2026-10-25";

test("edgetx names and release selection", () => {
  assert.deepEqual(radioName("RadioMaster TX16S / TX16S Mark II"), { vendor: "RadioMaster", model: "TX16S", aliases: ["TX16S Mark II"] });
  assert.deepEqual(radioName("Flysky NB4+"), { vendor: "Flysky", model: "NB4+", aliases: [] });
  assert.equal(radioName("Lonely"), null);
  assert.deepEqual(latestMinors(["v2.12.4", "v2.12.5", "v2.11.8", "v2.10.6", "nightly", "v2.12.0-rc1"]), [
    { tag: "v2.12.5", minor: "2.12" }, { tag: "v2.11.8", minor: "2.11" },
  ]);
});

test("edgetx records keep radios dropped from development and flag nightly-only ones", () => {
  const rs = fromTargets([
    { ref: "main", label: "main", targets: [["RadioMaster TX16S / TX16S Mark II", "tx16s-"], ["RadioMaster TX16S MK3", "tx16smk3-"]] },
    { ref: "v2.12.5", label: "2.12", targets: [["RadioMaster TX16S", "tx16s-"]] },
    { ref: "v2.11.8", label: "2.11", targets: [["RadioMaster TX16S", "tx16s-"], ["FrSky X9D Plus", "x9d+-"]] },
  ], D);
  const by = new Map(rs.map((r) => [r.id, r]));
  assert.deepEqual([...by.keys()].sort(), ["frsky/x9d-plus", "radiomaster/tx16s", "radiomaster/tx16s-mk3"]);
  assert.equal(by.get("radiomaster/tx16s")!.install![0].firmware_constraints, undefined);
  assert.deepEqual(by.get("radiomaster/tx16s")!.aliases, ["TX16S Mark II"]);
  assert.match(by.get("radiomaster/tx16s-mk3")!.install![0].firmware_constraints!, /nightly/);
  assert.match(by.get("frsky/x9d-plus")!.install![0].firmware_constraints!, /2\.11 release/);
  for (const r of rs) assert.deepEqual(validate(r), []);
});
