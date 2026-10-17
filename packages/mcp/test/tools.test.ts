import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseRecordYaml, validate } from "@opendevicedb/core";
import { LocalBackend, RemoteBackend, backendFromEnv, CACHE_TTL_MS, type FetchLike } from "../src/backend.ts";
import { lookupDevice, searchDevices, claimDevice, publishFindings, listSources, type Context } from "../src/tools.ts";
import { makeRepo, SKY, TELLO, ARCHER } from "./fixture.ts";

const TODAY = "2026-10-17";

function withRepo(fn: (ctx: Context, root: string) => Promise<void>) {
  return async () => {
    const root = makeRepo();
    try { await fn({ backend: new LocalBackend(root), today: TODAY }, root); }
    finally { rmSync(root, { recursive: true, force: true }); }
  };
}

const read = (root: string, id: string) => readFileSync(join(root, "data/devices", `${id}.yaml`), "utf8");

// ---------- lookup / search ----------

test("lookup by identifier finds the curated record with a recommendation", withRepo(async (ctx) => {
  const r: any = await lookupDevice(ctx, { fcc_id: "2abcd-sky1" });
  assert.equal(r.found, true);
  assert.equal(r.id, "acme/sky-1");
  assert.equal(r.effective_status, "partial-protocol");
  assert.match(r.recommendation, /Part of the protocol is already documented.*skylib/);
  assert.match(r.recommendation, /Remote ID/); // drone policy reminder
  assert.equal(r.curated_file, "data/devices/acme/sky-1.yaml");
  assert.equal((await lookupDevice(ctx, { usb: "1234:ABCD" }) as any).id, "acme/sky-1");
}));

test("lookup of an imported device recommends its open firmware", withRepo(async (ctx) => {
  const r: any = await lookupDevice(ctx, { vendor: "TP-Link", model: "Archer C7 v5" });
  assert.equal(r.found, true);
  assert.match(r.recommendation, /^Open firmware exists: use OpenWrt \(https:\/\/openwrt\.org/);
  assert.equal(r.curated_file, undefined);
}));

test("lookup not found says nothing is known and suggests claim_device", withRepo(async (ctx) => {
  const r: any = await lookupDevice(ctx, { vendor: "Nobody", model: "Zzz 9" });
  assert.equal(r.ok, true);
  assert.equal(r.found, false);
  assert.match(r.recommendation, /Nothing is known/);
  assert.match(r.recommendation, /claim_device/);
  const empty: any = await lookupDevice(ctx, {});
  assert.equal(empty.ok, false);
}));

test("search ranks by name and filters", withRepo(async (ctx) => {
  const r: any = await searchDevices(ctx, { query: "tello" });
  assert.equal(r.results[0].id, "ryze/tello");
  const drones: any = await searchDevices(ctx, { query: "", category: "drone" });
  assert.deepEqual(drones.results.map((x: any) => x.id).sort(), ["acme/sky-1", "ryze/tello"]);
}));

// ---------- claim_device ----------

test("claim creates a schema-valid stub for an unknown device", withRepo(async (ctx, root) => {
  const r: any = await claimDevice(ctx, { vendor: "Foo", model: "Bar 3", category: "toy", who: "alice", contact: "alice@example.org", scope: "BLE control" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.action, "created");
  assert.equal(r.id, "foo/bar-3");
  assert.equal(r.file_changed, "data/devices/foo/bar-3.yaml");
  assert.match(r.next_step, /git checkout -b .* && git commit .* && gh pr create/);
  assert.equal(r.claim.expires, "2026-11-16");
  const rec = parseRecordYaml(read(root, "foo/bar-3"));
  assert.deepEqual(validate(rec), []);
  assert.equal(rec.status, "unknown");
  assert.equal(rec.updated, TODAY);
  assert.equal(r.effective_status, "in-progress");

  const l: any = await lookupDevice(ctx, { vendor: "Foo", model: "Bar 3" });
  assert.equal(l.live_claims.length, 1);
  assert.match(l.recommendation, /^Claimed by alice \(scope: BLE control\) until 2026-11-16, contact alice@example\.org/);
}));

test("claim of an imported-only device creates the curated file with copied fields", withRepo(async (ctx, root) => {
  const r: any = await claimDevice(ctx, { id: ARCHER.id, who: "bob", contact: "@bob", scope: "bootloader UART", days: 7 });
  assert.equal(r.ok, true, r.error);
  const rec = parseRecordYaml(read(root, ARCHER.id));
  assert.equal(rec.vendor, "TP-Link");
  assert.equal(rec.category, "router");
  assert.equal(rec.status, "open-firmware");
  assert.equal(rec.claims!.length, 1);
  assert.equal(rec.projects, undefined); // projects stay in the snapshot
}));

test("claim refuses more than 90 days, missing category, near-duplicates", withRepo(async (ctx, root) => {
  const long: any = await claimDevice(ctx, { vendor: "Foo", model: "Bar", category: "toy", who: "a", contact: "b", scope: "c", days: 91 });
  assert.equal(long.ok, false);
  assert.match(long.error, /90/);
  assert.equal(existsSync(join(root, "data/devices/foo/bar.yaml")), false);
  const noCat: any = await claimDevice(ctx, { vendor: "Foo", model: "Bar", who: "a", contact: "b", scope: "c" });
  assert.match(noCat.error, /category/);
  const dup: any = await claimDevice(ctx, { vendor: "DJI", model: "Tello", who: "a", contact: "b", scope: "c" });
  assert.equal(dup.ok, false);
  assert.equal(dup.similar.id, "ryze/tello");
}));

test("claims expire: an expired claim is no longer reported", withRepo(async (ctx) => {
  const early = { ...ctx, today: "2026-10-01" };
  const c: any = await claimDevice(early, { id: TELLO.id, who: "carol", contact: "c@x", scope: "video", days: 10 });
  assert.equal(c.claim.expires, "2026-10-11");
  const during: any = await lookupDevice({ ...ctx, today: "2026-10-05" }, { id: TELLO.id });
  assert.equal(during.live_claims.length, 1);
  assert.match(during.recommendation, /Live claim: carol/);
  const after: any = await lookupDevice({ ...ctx, today: "2026-10-12" }, { id: TELLO.id });
  assert.equal(after.live_claims.length, 0);
  assert.doesNotMatch(after.recommendation, /carol/);
}));

test("claim with stub status unknown flips back to unknown after expiry", withRepo(async (ctx) => {
  await claimDevice({ ...ctx, today: "2026-01-01" }, { vendor: "Foo", model: "Old", category: "toy", who: "d", contact: "e", scope: "f", days: 1 });
  const r: any = await lookupDevice(ctx, { id: "foo/old" });
  assert.equal(r.effective_status, "unknown");
  assert.match(r.recommendation, /nothing public is known/);
}));

// ---------- publish_findings ----------

test("publish merges findings, validates and tells the agent to open a PR", withRepo(async (ctx, root) => {
  await claimDevice(ctx, { id: SKY.id, who: "alice", contact: "a@x", scope: "control" });
  const r: any = await publishFindings(ctx, {
    id: SKY.id,
    patch: {
      status: "controllable",
      summary: "Toy drone fully controllable over Wi-Fi UDP.",
      interfaces: [{ name: "control", transport: "wifi", status: "documented", confidence: "medium", spec: "https://example.org/sky-proto" }],
      verification: [{ method: "hardware-replay", by: "alice", date: TODAY, firmware: "1.0.3" }],
      provenance: { ai_assisted: true, tools: ["claude-code"] },
    },
    release_claim_of: "alice",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.file_changed, "data/devices/acme/sky-1.yaml");
  assert.match(r.next_step, /gh pr create/);
  assert.equal(r.released_claims, 1);
  const rec = parseRecordYaml(read(root, SKY.id));
  assert.deepEqual(validate(rec), []);
  assert.equal(rec.status, "controllable");
  assert.equal(rec.updated, TODAY);
  assert.equal(rec.interfaces!.length, 2);
  assert.deepEqual(rec.provenance!.tools, ["rea", "claude-code"]);
  assert.equal(rec.claims, undefined);
  assert.equal(rec.identifiers!.fcc_id![0], "2ABCD-SKY1");
}));

test("publish returns validation errors and writes nothing", withRepo(async (ctx, root) => {
  const before = read(root, SKY.id);
  const r: any = await publishFindings(ctx, { id: SKY.id, patch: { identifiers: { usb: ["NOT-A-USB-ID"] } } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e: string) => e.startsWith("/identifiers/usb")), r.errors);
  assert.equal(read(root, SKY.id), before);
  const bad: any = await publishFindings(ctx, { id: SKY.id, patch: { claims: [] } as any });
  assert.match(bad.error, /cannot contain claims/);
  const missing: any = await publishFindings(ctx, { id: "nobody/nothing", patch: {} });
  assert.match(missing.error, /claim_device/);
}));

test("publish refuses a status downgrade unless allowed", withRepo(async (ctx, root) => {
  const before = read(root, SKY.id);
  const r: any = await publishFindings(ctx, { id: SKY.id, patch: { status: "unknown" } });
  assert.equal(r.ok, false);
  assert.match(r.error, /only move forward/);
  assert.equal(read(root, SKY.id), before);
  const ok: any = await publishFindings(ctx, { id: SKY.id, patch: { status: "unknown", summary: "Earlier telemetry doc was wrong." }, allow_downgrade: true });
  assert.equal(ok.ok, true);
  assert.equal(parseRecordYaml(read(root, SKY.id)).status, "unknown");
}));

test("publish refuses policy violations with a pointer to POLICY.md", withRepo(async (ctx, root) => {
  const before = read(root, SKY.id);
  for (const patch of [
    { summary: "Patch to disable the geofencing database." },
    { projects: [{ name: "Remote ID spoofer", url: "https://example.org/x", kind: "tool" as const }] },
    { interfaces: [{ name: "fw", transport: "usb" as const, status: "documented" as const, notes: "stock firmware dump mirrored at example.org" }] },
  ]) {
    const r: any = await publishFindings(ctx, { id: SKY.id, patch });
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.match(r.error, /POLICY\.md/);
    assert.match(r.policy, /Refused/);
  }
  assert.equal(read(root, SKY.id), before);
  const claim: any = await claimDevice(ctx, { id: SKY.id, who: "x", contact: "y", scope: "no-fly zone unlock" });
  assert.equal(claim.ok, false);
}));

// ---------- list_sources ----------

test("list_sources reports snapshots and curated count", withRepo(async (ctx) => {
  const r: any = await listSources(ctx);
  assert.equal(r.curated, 2);
  assert.equal(r.total, 3);
  assert.deepEqual(r.sources, [{ source: "openwrt", name: "OpenWrt Table of Hardware", url: "https://openwrt.org/toh", license: "CC-BY-SA-4.0", fetched_at: "2026-10-01T00:00:00Z", records: 1 }]);
}));

// ---------- remote backend ----------

test("remote backend reads the static API through a cached fake fetch", async () => {
  const docs: Record<string, any> = {
    "https://odb.test/api/index.json": [SKY, TELLO, ARCHER].map((r) => ({
      id: r.id, vendor: r.vendor, model: r.model, category: r.category, status: r.status,
      sources: r.provenance?.sources ?? [], identifiers: r.identifiers ?? {},
    })),
    "https://odb.test/api/devices/acme/sky-1.json": { ...SKY, claims: [{ who: "zed", contact: "z@x", scope: "control", since: "2026-10-01", expires: "2026-12-01" }] },
  };
  const calls: string[] = [];
  let now = 0;
  const fakeFetch: FetchLike = async (url) => {
    calls.push(url);
    const body = docs[url];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => body };
  };
  const backend = new RemoteBackend("https://odb.test/", { fetch: fakeFetch, now: () => now });
  const ctx: Context = { backend, today: TODAY };

  const r: any = await lookupDevice(ctx, { usb: "1234:abcd" });
  assert.equal(r.found, true);
  assert.equal(r.record.summary, SKY.summary);
  assert.match(r.recommendation, /Live claim: zed/);
  assert.equal(r.live_claims.length, 1);

  assert.equal((await lookupDevice(ctx, { vendor: "Nobody", model: "Nothing" }) as any).found, false);
  assert.equal((await searchDevices(ctx, { query: "archer" }) as any).results[0].id, "tp-link/archer-c7-v5");
  assert.equal(calls.filter((u) => u.endsWith("index.json")).length, 1, "index cached");

  now += CACHE_TTL_MS + 1;
  await searchDevices(ctx, { query: "x" });
  assert.equal(calls.filter((u) => u.endsWith("index.json")).length, 2, "cache expires after 10 min");

  const src: any = await listSources(ctx);
  assert.equal(src.curated, null);
  assert.deepEqual(src.sources, [{ source: "curated", records: 1 }, { source: "openwrt", records: 1 }]);

  for (const res of [
    await claimDevice(ctx, { id: SKY.id, who: "a", contact: "b", scope: "c" }),
    await publishFindings(ctx, { id: SKY.id, patch: { summary: "x" } }),
  ]) {
    assert.equal(res.ok, false);
    assert.match((res as any).error, /ODB_REPO/);
  }
});

test("backend selection from env", () => {
  assert.equal(backendFromEnv({ ODB_REPO: "/tmp/x", ODB_API_URL: "https://a" }).kind, "local");
  assert.equal(backendFromEnv({ ODB_API_URL: "https://a" }).kind, "remote");
  assert.equal(backendFromEnv({}).kind, "local");
});
