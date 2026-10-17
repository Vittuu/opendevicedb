import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { parseBuilds, configCpu, splitName, fromBuild } from "../src/sources/rockbox.ts";

const D = "2026-10-17";

const BUILDS = `
$publicrelease="4.0";
# 'modelname' => {
#    name => 'Full Name',
#    status => 1,                        # 0=retired, 1=unusable, 2=unstable, 3=stable
# }

%builds = (
    'archosplayer' => {
        name => 'Archos Player/Studio',
        status => 0,
        ram => 2,
        release => '3.15',
    },
    'sansaclipplus' => {
        name => 'SanDisk Sansa Clip+',
        status => 3,
    },
    'fiiom3klinux' => {
        name => 'FiiO M3K (Linux)',
        status => 1,
    },
    'fiiom3k' => {
        name => 'FiiO M3K',
        status => 3,
    },
    'rk27generic' => {
        name => 'Rockchip rk27xx',
        status => 1,
    },
    'aigoerosq' => {
        name => 'AIGO EROS Q / K (Hosted)',
	sim => 0,
        status => 2, # Do we promote this to stable?
    },
);

%voices = (
    'english' => { 'lang' => 'english', 'name' => 'UK English', },
);
`;

test("parseBuilds reads only the %builds hash", () => {
  const b = parseBuilds(BUILDS);
  assert.deepEqual(b.map((x) => [x.key, x.status]), [
    ["archosplayer", 0], ["sansaclipplus", 3], ["fiiom3klinux", 1], ["fiiom3k", 3], ["rk27generic", 1], ["aigoerosq", 2],
  ]);
  assert.equal(b[0].release, "3.15");
  assert.equal(b[5].name, "AIGO EROS Q / K (Hosted)");
});

test("splitName and configCpu", () => {
  assert.deepEqual(splitName("iPod 6th gen (Classic)"), { vendor: "Apple", model: "iPod 6th gen (Classic)", variant: null });
  assert.deepEqual(splitName("iAudio X5"), { vendor: "Cowon", model: "iAudio X5", variant: null });
  assert.deepEqual(splitName("HiFi E.T MA9C"), { vendor: "HiFi E.T", model: "MA9C", variant: null });
  assert.deepEqual(splitName("Packard Bell Vibe 500"), { vendor: "Packard Bell", model: "Vibe 500", variant: null });
  assert.deepEqual(splitName("AIGO EROS Q / K (Native)"), { vendor: "Aigo", model: "EROS Q / K", variant: "native" });
  assert.deepEqual(splitName("Hiby R1"), { vendor: "HiBy", model: "R1", variant: null });
  assert.equal(configCpu("#define CONFIG_CPU AS3525v2\n"), "AS3525v2");
  assert.equal(configCpu('#include "hibylinux.h"\n'), null);
});

test("builds → records: status mapping, variant merge, generic target dropped", () => {
  const cpu: Record<string, string> = { sansaclipplus: "AS3525v2", fiiom3k: "X1000" };
  const recs = parseBuilds(BUILDS).map((b) => fromBuild(b, cpu[b.key] ?? null, b.key !== "archosplayer", D));
  assert.equal(recs[4], null, "rk27generic is a development target");
  assert.equal(recs[2]!.status, "partial-protocol", "unusable port");
  const f = finalize(recs.filter((r) => r !== null));
  assert.equal(f.invalid, 0);
  assert.equal(f.merged, 1);
  assert.deepEqual(f.records.map((r) => [r.id, r.status]), [
    ["aigo/eros-q-k", "open-firmware"],
    ["archos/player-studio", "open-firmware"],
    ["fiio/m3k", "open-firmware"],
    ["sandisk/sansa-clip-plus", "open-firmware"],
  ]);
  const m3k = f.records[2];
  assert.deepEqual(m3k.identifiers, { chips: ["X1000"] });
  assert.deepEqual(m3k.projects!.map((p) => p.name).sort(), ["Rockbox fiiom3k (stable port)", "Rockbox fiiom3klinux (linux, unusable port)"]);
  assert.equal(f.records[1].projects![0].name, "Rockbox archosplayer (retired port, last release 3.15)");
  assert.equal(f.records[1].projects![0].url, "https://github.com/Rockbox/rockbox/blob/master/tools/builds.pm");
  assert.equal(f.records[3].projects![0].url, "https://github.com/Rockbox/rockbox/blob/master/firmware/export/config/sansaclipplus.h");
  for (const r of f.records) {
    assert.equal(r.category, "media-player");
    assert.equal(r.projects![0].kind, "firmware");
    assert.deepEqual(validate(r), [], JSON.stringify(r));
  }
});
