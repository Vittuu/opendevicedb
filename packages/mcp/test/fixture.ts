// A throwaway fake repository: schema/ copied from the real one, two curated records, one snapshot.
import { mkdtempSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT, stringifyRecordYaml, type DeviceRecord } from "@opendevicedb/core";

export const SKY: DeviceRecord = {
  id: "acme/sky-1",
  vendor: "Acme",
  model: "Sky 1",
  category: "drone",
  identifiers: { fcc_id: ["2ABCD-SKY1"], usb: ["1234:abcd"] },
  status: "partial-protocol",
  summary: "Toy drone; telemetry over Wi-Fi is documented, control is not.",
  interfaces: [{ name: "telemetry", transport: "wifi", status: "partial", confidence: "medium" }],
  projects: [{ name: "skylib", url: "https://example.org/skylib", kind: "library", license: "MIT" }],
  provenance: { sources: ["curated"], ai_assisted: true, tools: ["rea"] },
  updated: "2026-09-01",
};

export const TELLO: DeviceRecord = {
  id: "ryze/tello",
  vendor: "Ryze Tech",
  model: "Tello",
  aliases: ["DJI Tello"],
  category: "drone",
  status: "controllable",
  projects: [{ name: "DJITelloPy", url: "https://github.com/damiafuentes/DJITelloPy", kind: "library" }],
  updated: "2026-09-01",
};

export const ARCHER: DeviceRecord = {
  id: "tp-link/archer-c7-v5",
  vendor: "TP-Link",
  model: "Archer C7 v5",
  category: "router",
  status: "open-firmware",
  projects: [{ name: "OpenWrt", url: "https://openwrt.org/toh/tp-link/archer_c7", kind: "firmware", license: "GPL-2.0" }],
  provenance: { sources: ["openwrt"] },
  updated: "2026-10-01",
};

export function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "odb-mcp-test-"));
  cpSync(join(REPO_ROOT, "schema"), join(root, "schema"), { recursive: true });
  for (const r of [SKY, TELLO]) {
    const file = join(root, "data/devices", `${r.id}.yaml`);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, stringifyRecordYaml(r));
  }
  mkdirSync(join(root, "data/imported"), { recursive: true });
  writeFileSync(join(root, "data/imported/openwrt.json"), JSON.stringify({
    source: "openwrt", name: "OpenWrt Table of Hardware", url: "https://openwrt.org/toh", license: "CC-BY-SA-4.0",
    fetched_at: "2026-10-01T00:00:00Z", records: [ARCHER],
  }));
  return root;
}
