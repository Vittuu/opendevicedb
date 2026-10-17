import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { fromDefconfig, THINGINO_GUIDE } from "../src/sources/thingino.ts";

const D = "2026-10-17";

test("thingino: one generic programmer route, none for mains-wired lights", () => {
  const r = fromDefconfig("configs/cameras/wyze_cam3_t31x_gc2053_atbm6031/wyze_cam3_t31x_gc2053_atbm6031_defconfig",
    "# NAME: Wyze Cam v3 (T31X, GC2053, ATBM6031)\n", D)!;
  assert.deepEqual(validate(r), []);
  assert.equal(THINGINO_GUIDE, "https://github.com/themactep/thingino-firmware/wiki/Installation:-General");
  assert.deepEqual(r.install!.map(({ notes, ...x }) => x), [{
    project: "thingino", method: "spi-programmer", guide: THINGINO_GUIDE, difficulty: "hard",
    tools: ["SPI flash programmer (CH341A)", "SOIC-8 test clip"], opens_device: true, reversible: "yes",
  }]);
  assert.match(r.install![0].notes!, /Back up the stock flash first/);
  assert.match(r.install![0].notes!, /SD card/);
  // each record has its own route object
  const r2 = fromDefconfig("configs/cameras/wyze_cam3_x/wyze_cam3_x_defconfig", "# NAME: Wyze Cam v3 (T31N)\n", D)!;
  assert.notEqual(r.install![0], r2.install![0]);
  assert.notEqual(r.install![0].tools, r2.install![0].tools);

  const flood = fromDefconfig("configs/cameras/wyze_floodlight_x/wyze_floodlight_x_defconfig", "# NAME: Wyze Cam Floodlight v1 (T31X)\n", D)!;
  assert.deepEqual(flood.install, []);
});
