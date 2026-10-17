import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { parseBuilds, configCpu, splitName, fromBuild, parseRbutil, rockboxInstall, manualInstallUrl, RBUTIL, MANUALS } from "../src/sources/rockbox.ts";

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

const RBUTIL_INI = `[general]
build_info_url=https://download.rockbox.org/build-info

[platforms]
platform01=archosplayer
platform57=sansaclipplus
platform60=ipodmini2g
platform61=ipod6g
platform134=aigoerosq.k
platform139=hidden

; devices sections
[archosplayer]
name="Jukebox Player 6000 / Jukebox Studio 5/10/20"
bootloadermethod=none
manualname=

[sansaclipplus]
name="Sansa Clip+"
bootloadermethod=ams
manualname=

[ipodmini2g]
name="iPod Mini 2G"
bootloadermethod=ipod
manualname=ipodmini1g

[ipod6g]
name="iPod Classic (6th gen)"
bootloadermethod=s5l
manualname=

[aigoerosq.k]
name="AIGO EROS K"
bootloadermethod=bspatch
manualname=aigoerosk

[hidden]
bootloadermethod=file
status=disabled

[notlisted]
bootloadermethod=file
`;

test("rbutil.ini targets and install routes", () => {
  const u = parseRbutil(RBUTIL_INI);
  assert.deepEqual([...u.keys()], ["archosplayer", "sansaclipplus", "ipodmini2g", "ipod6g", "aigoerosq"]);
  assert.deepEqual(u.get("ipodmini2g"), { methods: ["ipod"], manual: "ipodmini1g" });
  assert.deepEqual(u.get("aigoerosq"), { methods: ["bspatch"], manual: "aigoerosk" });
  assert.equal(manualInstallUrl("ipod6g"), "https://download.rockbox.org/daily/manual/rockbox-ipod6g/rockbox-buildch2.html");

  const manuals = new Set(["ipod6g", "sansaclipplus", "ipodmini1g"]);
  const ipod = rockboxInstall({ key: "ipod6g", name: "iPod 6th gen (Classic)", status: 3 }, u.get("ipod6g"), manuals)!;
  assert.deepEqual(ipod, {
    project: "Rockbox", method: "other", guide: "https://download.rockbox.org/daily/manual/rockbox-ipod6g/rockbox-buildch2.html",
    installer: RBUTIL, difficulty: "easy", tools: ["Computer with Rockbox Utility", "The player's USB cable"],
    opens_device: false, brick_risk: "low", reversible: "yes", revert: "https://download.rockbox.org/daily/manual/rockbox-ipod6g/rockbox-buildch2.html",
    notes: "On most players the original firmware stays available next to Rockbox.",
  });
  assert.equal(RBUTIL, "https://www.rockbox.org/wiki/RockboxUtility");
  // manualname is followed; original firmware needed for ams
  assert.equal(rockboxInstall({ key: "ipodmini2g", name: "iPod Mini 2nd gen", status: 3 }, u.get("ipodmini2g"), manuals)!.guide, manualInstallUrl("ipodmini1g"));
  assert.match(rockboxInstall({ key: "sansaclipplus", name: "SanDisk Sansa Clip+", status: 3 }, u.get("sansaclipplus"), manuals)!.notes!, /original firmware file/);
  // no daily manual: the utility page is the guide, no revert link
  const archos = rockboxInstall({ key: "archosplayer", name: "Archos Player/Studio", status: 0, release: "3.15" }, u.get("archosplayer"), manuals)!;
  assert.equal(archos.guide, RBUTIL);
  assert.equal(archos.revert, undefined);
  assert.match(archos.notes!, /installs no bootloader/);
  // not in the utility: manual install, medium; unusable: no route
  const manual = rockboxInstall({ key: "xduoox3", name: "xDuoo X3", status: 2 }, undefined, manuals)!;
  assert.deepEqual([manual.guide, manual.difficulty, manual.installer], [MANUALS, "medium", undefined]);
  assert.equal(rockboxInstall({ key: "fiiom3klinux", name: "FiiO M3K (Linux)", status: 1 }, undefined, manuals), null);

  const rec = fromBuild({ key: "ipod6g", name: "iPod 6th gen (Classic)", status: 3 }, "S5L8702", true, D, ipod)!;
  assert.deepEqual(validate(rec), []);
  assert.equal(rec.install!.length, 1);
  assert.equal(fromBuild({ key: "x", name: "Acme X", status: 1 }, null, false, D, null)!.install, undefined);
});
