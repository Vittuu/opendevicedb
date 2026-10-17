// DEV-ONLY scale test. Never commit its output.
//
// Writes a throwaway repository root containing the real curated records plus three fake
// importer snapshots (~N records in total, some ids present in several sources), so the
// site build can be timed at realistic scale:
//
//   node site/scripts/gen-fake-data.ts /tmp/odb-fake 20000
//   ODB_REPO=/tmp/odb-fake ODB_TIMING=1 npm run build -w site
//
import { cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, makeId, STATUSES, type DeviceRecord, type Snapshot } from "@opendevicedb/core";

const out = process.argv[2];
const total = Number(process.argv[3] ?? 20000);
if (!out) { console.error("usage: gen-fake-data.ts <out-dir> [count]"); process.exit(1); }

let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const hex4 = () => Math.floor(rnd() * 65536).toString(16).padStart(4, "0");

const vendors = ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Vandelay", "Stark", "Wayne", "Tyrell", "Cyberdyne",
  "Soylent", "Wonka", "Aperture", "Black Mesa", "Massive Dynamic", "Gringotts", "Oscorp", "Nakatomi", "Monarch", "Pied Piper"];
const words = ["Air", "Mini", "Pro", "Max", "Lite", "Neo", "Mesh", "Cam", "Plug", "Hub", "Bulb", "Sense", "Go", "One", "Ultra", "Nano"];
const categories = ["router", "smart-plug", "light", "switch", "sensor", "ip-camera", "drone", "hub", "vacuum-robot", "wearable", "media-player", "single-board"];
const sources = [
  { source: "fake-routers", name: "Fake Router DB", url: "https://example.org/routers", license: "CC BY-SA 4.0", share: 0.45 },
  { source: "fake-zigbee", name: "Fake Zigbee DB", url: "https://example.org/zigbee", license: "GPL-3.0", share: 0.35 },
  { source: "fake-plugs", name: "Fake Plug DB", url: "https://example.org/plugs", license: "MIT", share: 0.2 },
];

function fake(i: number, src: string): DeviceRecord {
  const vendor = vendors[i % vendors.length];
  // deterministic in i, so the same i in two sources is the same device id
  const model = `${words[i % words.length]} ${words[Math.floor(i / words.length) % words.length]} ${i}`;
  const r: DeviceRecord = {
    id: makeId(vendor, model),
    vendor, model,
    category: pick(categories),
    identifiers: { usb: [`${hex4()}:${hex4()}`], ...(rnd() < 0.3 ? { fcc_id: [`2A${hex4().toUpperCase()}-${i}`] } : {}), ...(rnd() < 0.3 ? { zigbee_model: [`ZB${i}`] } : {}) },
    status: pick(STATUSES.filter((s) => s !== "in-progress")),
    summary: rnd() < 0.5 ? `Synthetic record ${i} for scale testing.` : undefined,
    projects: [{ name: `${src} page`, url: `https://example.org/${src}/${i}`, kind: "integration" }],
    provenance: { sources: [src] },
    updated: "2026-10-01",
  };
  if (rnd() < 0.002) r.claims = [{ who: `tester${i}`, contact: "https://example.org", scope: "BLE protocol", since: "2026-10-10", expires: "2026-12-31" }];
  if (rnd() < 0.001) r.verification = [{ method: "hardware-replay", by: "tester", date: "2026-10-12", firmware: "1.0" }];
  if (!r.summary) delete r.summary;
  return r;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "data/imported"), { recursive: true });
cpSync(join(REPO_ROOT, "data/devices"), join(out, "data/devices"), { recursive: true });

let n = 0;
for (const s of sources) {
  const count = Math.round(total * s.share * 1.1); // ~10% overlap with other sources
  const records: DeviceRecord[] = [];
  for (let k = 0; k < count; k++) {
    // indices overlap across sources for a slice of the range, so some ids get >1 source
    const i = (n + k) % total;
    records.push(fake(i, s.source));
  }
  n += Math.round(total * s.share);
  const { share: _s, ...meta } = s;
  const snap: Snapshot = { ...meta, fetched_at: new Date().toISOString(), records };
  writeFileSync(join(out, "data/imported", `${s.source}.json`), JSON.stringify(snap));
  console.log(`${s.source}: ${records.length} records`);
}
