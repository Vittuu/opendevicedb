import { test } from "node:test";
import assert from "node:assert/strict";
import {
  usbId, parseUsbId, knownUsb, matchUsb, bleStrength, matchBleName, bleSearchQuery, type IndexEntry,
} from "../src/browser.ts";

const entry = (id: string, identifiers: IndexEntry["identifiers"], status: IndexEntry["status"] = "unknown"): IndexEntry => ({
  id, vendor: id.split("/")[0], model: id.split("/")[1], aliases: [], category: "other", status,
  sources: [], identifiers, claims: 0, verified: false, updated: "2026-10-17",
});

test("usbId formats vendor and product ids as lowercase 4-digit hex", () => {
  assert.equal(usbId(0x2ca3, 0x1f), "2ca3:001f");
  assert.equal(usbId(0x10c4, 0xea60), "10c4:ea60");
  assert.equal(usbId(0, 0), "0000:0000");
  assert.equal(usbId(0x1ffff, 0xabcd), "ffff:abcd"); // masked to 16 bits
});

test("parseUsbId accepts lsusb and 0x forms, rejects the rest", () => {
  assert.equal(parseUsbId("2CA3:001F"), "2ca3:001f");
  assert.equal(parseUsbId("0x2ca3:0x001f"), "2ca3:001f");
  assert.equal(parseUsbId("Bus 001 Device 004: ID 18d1:4ee0 Google Inc. Nexus/Pixel Device (fastboot)"), "18d1:4ee0");
  assert.equal(parseUsbId("2ca3 001f"), null);
  assert.equal(parseUsbId("12345:abcd"), null);
  assert.equal(parseUsbId("tello"), null);
});

test("common USB-serial adapters, chips and generic modes are recognised", () => {
  for (const id of ["10c4:ea60", "1a86:7523", "0403:6001", "0403:6015", "067b:2303", "1A86:55D4"]) {
    assert.equal(knownUsb(id)?.kind, "serial-adapter", id);
  }
  assert.equal(knownUsb("303a:1001")?.kind, "chip");
  assert.equal(knownUsb("18d1:4ee0")?.kind, "bootloader");
  assert.equal(knownUsb("05c6:9008")?.kind, "bootloader");
  assert.equal(knownUsb("1a86:e30b"), undefined); // a real product on a WCH chip, not the adapter id
  assert.equal(knownUsb("2ca3:001f"), undefined);
});

test("matchUsb: exact vid:pid, furthest status first, generic when shared or known", () => {
  const entries = [
    entry("acme/a", { usb: ["1234:abcd"] }, "unknown"),
    entry("acme/b", { usb: ["5678:0001", "1234:ABCD"] }, "open-firmware"),
    entry("acme/c", { usb: ["1234:abce"] }),
    entry("google/pixel", { usb: ["18d1:4ee0"] }, "open-firmware"),
  ];
  const r = matchUsb(entries, "1234:ABCD");
  assert.equal(r.id, "1234:abcd");
  assert.deepEqual(r.matches.map((e) => e.id), ["acme/b", "acme/a"]);
  assert.equal(r.generic, true);
  assert.equal(r.known, undefined);
  const one = matchUsb(entries, "5678:0001");
  assert.deepEqual(one.matches.map((e) => e.id), ["acme/b"]);
  assert.equal(one.generic, false);
  const fastboot = matchUsb(entries, "18d1:4ee0");
  assert.equal(fastboot.known?.kind, "bootloader");
  assert.equal(fastboot.generic, true);
  const cp = matchUsb(entries, "10c4:ea60");
  assert.equal(cp.known?.kind, "serial-adapter");
  assert.deepEqual(cp.matches, []);
});

test("bleStrength: exact, prefix both ways, contains; short names only exact", () => {
  assert.equal(bleStrength("Amazfit Bip", "amazfit  bip"), "exact");
  assert.equal(bleStrength("AAWireless-3F2C", "AAWireless-"), "prefix");
  assert.equal(bleStrength("Amazfit", "Amazfit Bip"), "prefix");
  assert.equal(bleStrength("My Mi Band 4", "Mi Band"), "contains");
  assert.equal(bleStrength("SE1", "SE1"), "exact");
  assert.equal(bleStrength("XSE1Y", "SE1"), null); // 3 chars: not enough for contains
  assert.equal(bleStrength("ab", "abc"), null);
  assert.equal(bleStrength("", "x"), null);
  assert.equal(bleStrength("Tello", "Amazfit"), null);
});

test("matchBleName ranks exact before prefix before contains", () => {
  const entries = [
    entry("x/contains", { ble_names: ["Bip"] }),
    entry("x/prefix-short", { ble_names: ["Amazfit"] }),
    entry("x/prefix-long", { ble_names: ["Amazfit Bip"] }, "unknown"),
    entry("x/exact", { ble_names: ["Other", "Amazfit Bip 3"] }),
    entry("x/none", { ble_names: ["Tello"] }),
    entry("x/no-ble", { usb: ["1234:abcd"] }),
  ];
  const m = matchBleName(entries, "amazfit bip 3");
  assert.deepEqual(m.map((x) => [x.entry.id, x.strength]), [
    ["x/exact", "exact"],
    ["x/prefix-long", "prefix"],
    ["x/prefix-short", "prefix"],
  ]);
  assert.equal(m[0].name, "Amazfit Bip 3");
  // "Bip" (3 chars) is too short for a contains match.
  assert.deepEqual(matchBleName(entries, "Smart Bip 3").map((x) => x.entry.id), []);
  assert.deepEqual(matchBleName(entries, "   "), []);
  assert.equal(matchBleName(entries, "Amazfit Bip 3", 1).length, 1);
});

test("bleSearchQuery drops a trailing serial or MAC suffix", () => {
  assert.equal(bleSearchQuery("Mi Smart Band 5_A1B2"), "Mi Smart Band 5");
  assert.equal(bleSearchQuery("AAWireless-3F2C9A"), "AAWireless");
  assert.equal(bleSearchQuery("Tracker (A4:C1:38:12:34:56)"), "Tracker");
  assert.equal(bleSearchQuery("Pixel Buds Pro"), "Pixel Buds Pro");
  assert.equal(bleSearchQuery("Amazfit Bip 3"), "Amazfit Bip 3");
  assert.equal(bleSearchQuery(" Tello "), "Tello");
});
