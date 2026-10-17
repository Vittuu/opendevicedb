import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, makeId, mergeRecords, search, toIndexEntry, lookup, effectiveStatus, type DeviceRecord } from "../src/index.ts";

const r = (o: Partial<DeviceRecord>): DeviceRecord => ({ id: "a/b", vendor: "A", model: "B", category: "other", status: "unknown", updated: "2026-01-01", ...o });

test("slugify", () => {
  assert.equal(slugify("Neo 2"), "neo-2");
  assert.equal(slugify("Café+ Pro"), "cafe-plus-pro");
  assert.equal(makeId("TP-Link", "Archer C7 v5"), "tp-link/archer-c7-v5");
});

test("merge keeps furthest status and unions projects", () => {
  const m = mergeRecords(r({ status: "partial-protocol", projects: [{ name: "x", url: "https://x", kind: "sdk" }] }),
                         r({ status: "open-firmware", projects: [{ name: "y", url: "https://y", kind: "firmware" }], provenance: { sources: ["openwrt"] } }));
  assert.equal(m.status, "open-firmware");
  assert.equal(m.projects!.length, 2);
  assert.deepEqual(m.provenance!.sources, ["openwrt"]);
});

test("live claim makes unknown in-progress, expired claim does not", () => {
  const c = { who: "me", contact: "x", scope: "wifi", since: "2026-10-01" };
  assert.equal(effectiveStatus(r({ claims: [{ ...c, expires: "2026-11-01" }] }), "2026-10-17"), "in-progress");
  assert.equal(effectiveStatus(r({ claims: [{ ...c, expires: "2026-10-02" }] }), "2026-10-17"), "unknown");
});

test("search and lookup", () => {
  const recs = [
    r({ id: "dji/neo-2", vendor: "DJI", model: "Neo 2", identifiers: { fcc_id: ["SS3-NEO2"] } }),
    r({ id: "dji/mini-4-pro", vendor: "DJI", model: "Mini 4 Pro" }),
  ];
  const idx = recs.map((x) => toIndexEntry(x));
  assert.equal(search(idx, "neo 2")[0].id, "dji/neo-2");
  assert.equal(search(idx, "dji").length, 2);
  assert.equal(lookup(recs, { fcc_id: "ss3-neo2" })!.id, "dji/neo-2");
  assert.equal(lookup(recs, { vendor: "DJI", model: "Neo 2" })!.id, "dji/neo-2");
  assert.equal(lookup(recs, { vendor: "Acme", model: "Zzz" }), null);
});
