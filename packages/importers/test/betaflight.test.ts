import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { parseConfig, parseManufacturers, makerName, fromBoard } from "../src/sources/betaflight.ts";

const D = "2026-10-25";

const CONFIG = `/* This file is part of Betaflight. */
#pragma once

#define FC_TARGET_MCU     STM32H743

#define BOARD_NAME        MATEKH743
#define MANUFACTURER_ID   MTKS

#define USE_ACC
`;
const MD = `|Manufacturer Id|Name|Contact|
|-|-|-|
|CUST|'Custom', to be used for homebrew targets||
|MTKS|Matek Systems|http://www.mateksys.com/|
|CADX|CADDX TECHNOLOGY (SHENZHEN) Co., Ltd|https://caddxfpv.com/|
|SPBE|LangTian Technology (Shenzhen) Co. (SpeedyBee)|https://www.speedybee.com/|
`;

test("betaflight config and manufacturer parsing", () => {
  assert.deepEqual(parseConfig(CONFIG), { board: "MATEKH743", manufacturer: "MTKS", mcu: "STM32H743" });
  assert.equal(parseConfig("#pragma once\n"), null);
  const m = parseManufacturers(MD);
  assert.equal(m.get("MTKS"), "Matek Systems");
  assert.equal(m.get("CADX"), "CADDX");
  assert.equal(m.get("SPBE"), "SpeedyBee"); // brand, not the company name
  assert.equal(makerName("Shenzhen Jinhang Electronic Co., Ltd"), "Jinhang");
  assert.equal(makerName("Konex Drone, SL"), "Konex Drone");
});

test("betaflight records", () => {
  const makers = parseManufacturers(MD);
  const r = fromBoard(parseConfig(CONFIG)!, makers, D)!;
  assert.equal(r.id, "matek-systems/matekh743");
  assert.equal(r.category, "drone");
  assert.equal(r.status, "open-firmware");
  assert.deepEqual(r.identifiers!.chips, ["STM32H743"]);
  assert.equal(r.projects![0].url, "https://github.com/betaflight/config/tree/master/configs/MTKS/MATEKH743");
  assert.deepEqual(r.projects![0].freedom!.nonfree, ["bootloader"]);
  assert.deepEqual(validate(r), []);
  assert.equal(fromBoard({ board: "MYBOARD", manufacturer: "CUST", mcu: "STM32F405" }, makers, D), null);
  assert.equal(fromBoard({ board: "X", manufacturer: "ZZZZ", mcu: "" }, makers, D), null);
});
