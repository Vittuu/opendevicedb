import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { anchorOf, parseSupportedRobots, fromRobot, modelCodes, robotBrand, valetudoInstall } from "../src/sources/valetudo.ts";

const D = "2026-10-17";

const MD = `---
title: Supported Robots
---

# Supported Robots

## Robots that aren't supported

Some text.

## Xiaomi

### Xiaomi 1C

<img src="../img/robots/xiaomi/xiaomi_1c.jpg"/>

The Xiaomi 1C is made by Dreame. It is sold as:
- Mi Robot Vacuum-Mop
- Xiaomi 1C
- STYTJ01ZHM

The serial number should start with \`P1904\`.

#### Comments

Something made by Someone Else.
- not a sold-as entry

#### Details

**Valetudo Binary**: \`armv7\`
**Secure Boot**: \`no\`

#### Rooting instructions

- [UART](/pages/installation/dreame/#uart-shell)
- [Init override (may be patched)](https://gist.github.com/x/y)

### Xiaomi Vacuum-Mop P

These are sold under the names:
- Mi Robot Vacuum-Mop Pro (not the ijai one!!)
- Mijia STYJ02YM

#### Details

## MOVA

### MOVA Z500

The MOVA Z500 is made by Dreame. It is sold as:
- MOVA Z500

## Eureka

Eureka is a brand of Midea.

### Eureka J15 Ultra

#### Comments

#### Details

**Valetudo Binary**: \`aarch64\`
`;

test("anchors follow the site's heading ids", () => {
  assert.equal(anchorOf("Xiaomi Vacuum-Mop 2 Ultra"), "xiaomi-vacuum-mop-2-ultra");
  assert.equal(anchorOf("L10s Pro Ultra Heat "), "l10s-pro-ultra-heat");
});

test("supported-robots.md → robots", () => {
  const rs = parseSupportedRobots(MD);
  assert.deepEqual(rs.map((r) => [r.brand, r.heading, r.anchor]), [
    ["Xiaomi", "Xiaomi 1C", "xiaomi-1c"],
    ["Xiaomi", "Xiaomi Vacuum-Mop P", "xiaomi-vacuum-mop-p"],
    ["MOVA", "MOVA Z500", "mova-z500"],
    ["Eureka", "Eureka J15 Ultra", "eureka-j15-ultra"],
  ]);
  assert.deepEqual(rs[0].soldAs, ["Mi Robot Vacuum-Mop", "Xiaomi 1C", "STYTJ01ZHM"]);
  assert.equal(rs[0].madeBy, "Dreame");
  assert.equal(rs[0].binary, "armv7");
  assert.equal(rs[0].secureBoot, "no");
  assert.deepEqual(rs[0].rooting, [
    { name: "UART", url: "https://valetudo.cloud/pages/installation/dreame/#uart-shell" },
    { name: "Init override (may be patched)", url: "https://gist.github.com/x/y" },
  ]);
  assert.deepEqual(rs[1].soldAs, ["Mi Robot Vacuum-Mop Pro", "Mijia STYJ02YM"]);
  assert.equal(rs[3].madeBy, "Midea");
});

test("robot → record", () => {
  const [c1, p, z500, j15] = parseSupportedRobots(MD).map((r) => fromRobot(r, D)!);
  for (const r of [c1, p, z500, j15]) assert.deepEqual(validate(r), []);
  assert.deepEqual(c1, {
    id: "xiaomi/1c", vendor: "Xiaomi", model: "1C", aliases: ["Mi Robot Vacuum-Mop", "STYTJ01ZHM"],
    category: "vacuum-robot", identifiers: { sku: ["STYTJ01ZHM"] }, status: "controllable",
    summary: "Rooted, then runs Valetudo for cloud-free local control. Made by Dreame. Valetudo binary: armv7. Secure boot: no.",
    projects: [
      { name: "Valetudo", url: "https://valetudo.cloud/pages/general/supported-robots/#xiaomi-1c", kind: "integration", license: "Apache-2.0" },
      { name: "Valetudo rooting instructions (UART)", url: "https://valetudo.cloud/pages/installation/dreame/#uart-shell", kind: "other" },
      { name: "Valetudo rooting instructions (Init override (may be patched))", url: "https://gist.github.com/x/y", kind: "other" },
    ],
    install: c1.install, // see "rooting links → install routes"
    provenance: { sources: ["valetudo"] }, updated: D,
  });
  assert.equal(p.id, "xiaomi/vacuum-mop-p");
  assert.deepEqual(p.identifiers!.sku, ["STYJ02YM"]);
  assert.equal(p.summary, undefined);
  assert.deepEqual([z500.id, z500.aliases], ["mova/z500", []]);
  assert.equal(j15.id, "eureka/j15-ultra");
  assert.match(j15.summary!, /Made by Midea/);
});

test("helpers", () => {
  assert.deepEqual(modelCodes("Mijia STYJ02YM"), ["STYJ02YM"]);
  assert.deepEqual(modelCodes("Xiaomi Mi Roborock S502-00"), ["S502-00"]);
  assert.deepEqual(modelCodes("V-RVCLM21B"), ["V-RVCLM21B"]);
  assert.deepEqual(modelCodes("Dreame X40 Ultra"), []);
  assert.equal(robotBrand("Mova"), "MOVA");
  assert.equal(robotBrand("Dreame"), "Dreame");
});

test("rooting links → install routes", () => {
  const [c1] = parseSupportedRobots(MD).map((r) => fromRobot(r, D)!);
  // the UART page is a Valetudo route; the third-party gist is not
  assert.deepEqual(c1.install, [{
    project: "Valetudo", guide: "https://valetudo.cloud/pages/installation/dreame/#uart-shell", method: "serial", difficulty: "hard",
    tools: ["USB-serial adapter (3.3 V)", "Dreame Breakout PCB", "USB stick"],
    notes: "Through the robot's debug connector with the Dreame Breakout PCB; on robots with secure boot it must be defeated first or the robot is bricked.",
  }]);
  const robot = (rooting: { name: string; url: string }[]) => valetudoInstall({ brand: "Roborock", heading: "S5", anchor: "s5", soldAs: [], rooting });
  const rr = robot([
    { name: "OTA (before 2020-03)", url: "https://valetudo.cloud/pages/installation/roborock/#ota" },
    { name: "Vinda (after 2020-03)", url: "https://valetudo.cloud/pages/installation/roborock/#vinda" },
    { name: "FEL", url: "https://valetudo.cloud/pages/installation/roborock/#fel-rooting" },
    { name: "Fastboot", url: "https://valetudo.cloud/pages/installation/dreame/#fastboot" },
    { name: "ADB", url: "https://valetudo.cloud/pages/installation/midea/#adb" },
    { name: "ADB", url: "https://github.com/Hypfer/valetudo-crl200s-root" },
  ]);
  assert.deepEqual(rr.map((r) => [r.method, r.difficulty, r.opens_device, r.brick_risk]), [
    ["ota-exploit", "medium", false, undefined],
    ["serial", "hard", true, undefined],
    ["usb-bootloader", "hard", true, undefined],
    ["usb-bootloader", "hard", undefined, "high"],
    ["other", "hard", true, "high"],
    ["other", "medium", undefined, "high"],
  ]);
  assert.equal(rr[0].firmware_constraints, 'Valetudo qualifies this method: "before 2020-03".');
  assert.equal(rr[2].firmware_constraints, undefined);
  for (const r of rr) assert.equal(r.reversible, undefined);
});
