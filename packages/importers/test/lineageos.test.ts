import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import { fromDevice, parseDeviceYaml, lineageCategory, lineageUrl, lineageInstall, lineageInstallUrl, normModel, normVendor, isQualifier } from "../src/sources/lineageos.ts";

const D = "2026-10-17";

test("vendor names are canonical", () => {
  assert.equal(normVendor("Asus"), "ASUS");
  assert.equal(normVendor("XiaoMi"), "Xiaomi");
  assert.equal(normVendor("Pine64"), "PINE64");
  assert.equal(normVendor("BananaPi"), "Banana Pi");
  assert.equal(normVendor("HardKernel"), "Hardkernel");
  assert.equal(normVendor("Odroid"), "Hardkernel");
  assert.equal(normVendor("fxtec"), "F(x)tec");
  assert.equal(normVendor("Acme Corp"), "Acme Corp");
});

test("model names drop vendor prefix and variant qualifiers, keep years and generations", () => {
  const cases: [string, string, string][] = [
    ["Samsung", "Samsung Galaxy S9", "Galaxy S9"],
    ["Samsung", "Galaxy S III (AT&T)", "Galaxy S III"],
    ["Samsung", "Galaxy S III (LTE / International)", "Galaxy S III"],
    ["Samsung", "Galaxy SIII (USA)", "Galaxy S III"],
    ["Samsung", "Galaxy Note 3 LTE (N9005/P)", "Galaxy Note 3"],
    ["Samsung", "Galaxy S5 LTE (G900F/M/R4/R7/T/T3/V/W8)", "Galaxy S5"],
    ["Samsung", "Galaxy Tab S7+ (LTE/5G)", "Galaxy Tab S7+"],
    ["Samsung", "Galaxy Tab 2 (10.1 inch)", "Galaxy Tab 2 10.1"],
    ["Samsung", "Galaxy Tab 2 10.1 (Wi-Fi / Wi-Fi + IR)", "Galaxy Tab 2 10.1"],
    ["Samsung", "Galaxy A5 (2016)", "Galaxy A5 (2016)"],
    ["LG", "G6 (EU Unlocked - ENG BL)", "G6"],
    ["LG", "LG G3 International", "G3"],
    ["Nothing", "Phone (1)", "Phone (1)"],
    ["HTC", "One (M8)", "One (M8)"],
    ["AYN", "Odin (M0)", "Odin (M0)"],
    ["ASUS", "ROG Phone 2 (ZS660KL)", "ROG Phone 2"],
    ["Hardkernel", "ODROID-C4 (S905X3, eMMC Only) [Android TV]", "ODROID-C4"],
    ["Nubia", "Red Magic 5G (Global)", "Red Magic 5G"],
    ["Motorola", "moto e5 plus (XT1924-3/9)", "moto e5 plus"],
    ["Fairphone", "The Fairphone (Gen. 6)", "Fairphone (Gen. 6)"],
    ["Fairphone", "Fairphone (Gen. 6)", "Fairphone (Gen. 6)"],
    ["Dell", "dell Dell Wyse 3020", "Wyse 3020"],
    ["SHIFT", "SHIFT6mq", "SHIFT6mq"],
  ];
  for (const [v, n, want] of cases) assert.equal(normModel(v, n), want, n);
  assert.equal(isQualifier("2015 / 2015 Pro"), false);
  assert.equal(isQualifier("Gen. 6"), false);
  assert.equal(isQualifier("T-Mobile"), true);
});

test("type → category, wiki urls", () => {
  assert.equal(lineageCategory("phone"), "phone");
  assert.equal(lineageCategory("phone (slider)"), "phone");
  assert.equal(lineageCategory("foldable"), "phone");
  assert.equal(lineageCategory("tablet"), "tablet");
  assert.equal(lineageCategory("Set top box"), "media-player");
  assert.equal(lineageCategory("TV"), "tv");
  assert.equal(lineageCategory("Handheld game console"), "game-console");
  assert.equal(lineageCategory("Devkit"), "single-board");
  assert.equal(lineageCategory("robot"), "other");
  assert.equal(lineageUrl("bluejay"), "https://wiki.lineageos.org/devices/bluejay/");
  assert.equal(lineageUrl("A6020", 1), "https://wiki.lineageos.org/devices/A6020/variant1/");
});

const STARLTE = `codename: starlte
current_branch: 20
maintainers: []
models: [SM-G960F, SM-G960F/DS, SM-G960N]
name: Galaxy S9
soc: Samsung Exynos 9810
type: phone
vendor: Samsung
versions: [15.1, 17.1, 20]
`;
const BLUEJAY = `codename: bluejay
current_branch: 24.0
maintainers: [mikeioannina]
name: Pixel 6a
type: phone
vendor: Google
versions: [20, 21, 22.1, 24.0]
`;

test("device yaml → record", () => {
  const s9 = fromDevice(parseDeviceYaml(STARLTE), D)!;
  assert.deepEqual(validate(s9), []);
  assert.equal(s9.id, "samsung/galaxy-s9");
  assert.equal(s9.status, "open-firmware");
  assert.deepEqual(s9.identifiers, { sku: ["SM-G960F", "SM-G960F/DS", "SM-G960N"], chips: ["Samsung Exynos 9810"] });
  assert.ok(s9.aliases!.includes("starlte"));
  assert.equal(s9.projects![0].name, "LineageOS, discontinued after 20 (starlte)");
  assert.equal(s9.projects![0].url, "https://wiki.lineageos.org/devices/starlte/");
  assert.deepEqual(s9.projects![0].freedom, {
    nonfree: ["vendor-blobs"], cloud: "none",
    notes: "LineageOS uses proprietary files extracted from the stock firmware (modem, camera, GPU…)",
  });
  assert.deepEqual(s9.provenance, { sources: ["lineageos"] });

  const p6a = fromDevice(parseDeviceYaml(BLUEJAY), D)!;
  assert.equal(p6a.id, "google/pixel-6a");
  assert.equal(p6a.projects![0].name, "LineageOS 24.0 (bluejay)");

  assert.equal(fromDevice(parseDeviceYaml("name: X\ntype: phone\n"), D), null);
  assert.equal(parseDeviceYaml(": : bad\n  - ["), null);
});

test("carrier variants merge into one record with all model numbers", () => {
  const att = fromDevice({ vendor: "Samsung", name: "Galaxy S III (AT&T)", codename: "d2att", models: ["SGH-I747"], type: "phone", maintainers: [] }, D)!;
  const intl = fromDevice({ vendor: "Samsung", name: "Galaxy S III (International)", codename: "i9300", models: ["GT-I9300"], type: "phone", maintainers: [] }, D)!;
  const v2 = fromDevice({ vendor: "Lenovo", name: "Vibe K5 Plus", codename: "A6020", variant: 2, type: "phone", maintainers: [] }, D)!;
  const f = finalize([att, intl, v2]);
  assert.equal(f.merged, 1);
  const s3 = f.records.find((r) => r.id === "samsung/galaxy-s-iii")!;
  assert.deepEqual(s3.identifiers!.sku, ["SGH-I747", "GT-I9300"]);
  assert.equal(s3.projects!.length, 2);
  assert.ok(s3.aliases!.includes("Galaxy S III (AT&T)"));
  assert.equal(f.records.find((r) => r.id === "lenovo/vibe-k5-plus")!.projects![0].url, "https://wiki.lineageos.org/devices/A6020/variant2/");
});

test("install route from install_method", () => {
  assert.equal(lineageInstallUrl("bluejay"), "https://wiki.lineageos.org/devices/bluejay/install/");
  assert.equal(lineageInstallUrl("A6020", 1), "https://wiki.lineageos.org/devices/A6020/install/variant1/");

  const p6a = fromDevice(parseDeviceYaml(BLUEJAY + "install_method: fastboot_nexus\n"), D)!;
  assert.deepEqual(validate(p6a), []);
  assert.equal(p6a.install!.length, 1);
  const r = p6a.install![0];
  assert.equal(r.project, "LineageOS");
  assert.equal(r.method, "usb-bootloader");
  assert.equal(r.guide, "https://wiki.lineageos.org/devices/bluejay/install/");
  assert.equal(r.difficulty, "medium");
  assert.deepEqual(r.tools, ["Computer with adb and fastboot", "USB cable"]);
  assert.equal(r.reversible, "partial");
  assert.match(r.notes!, /bootloader must be unlocked/);
  assert.match(r.notes!, /wipes all data/);
  assert.doesNotMatch(r.notes!, /No longer maintained/);

  // Samsung: Download mode; unmaintained device: build it yourself
  const s9 = fromDevice(parseDeviceYaml(STARLTE + "install_method: samloader_rs\n"), D)!;
  const s = s9.install![0];
  assert.equal(s.method, "usb-bootloader");
  assert.deepEqual(s.tools, ["Computer with adb and samloader-rs", "USB cable"]);
  assert.match(s.notes!, /^No longer maintained/);
  assert.match(s.notes!, /Download mode/);

  const xiaomi = lineageInstall({ codename: "lmi", install_method: "fastboot_xiaomi", maintainers: ["x"] });
  assert.match(xiaomi.notes!, /Mi Unlock/);
  const dd = lineageInstall({ codename: "x", install_method: "dd", maintainers: ["x"] });
  assert.equal(dd.method, "other");
  assert.match(dd.notes!, /rooted first/);
  assert.equal(dd.reversible, undefined);
  const sw = lineageInstall({ codename: "nx", install_method: "nintendo", maintainers: ["x"] });
  assert.equal(sw.method, "other");
  assert.match(sw.firmware_constraints!, /first-revision/);
  assert.equal(lineageInstall({ codename: "y", maintainers: ["x"] }).method, "other");

  // variants keep their own install page through the merge
  const v1 = fromDevice({ vendor: "Lenovo", name: "Vibe K5 Plus", codename: "A6020", variant: 1, type: "phone", maintainers: [], install_method: "fastboot_unlocked" }, D)!;
  const v2 = fromDevice({ vendor: "Lenovo", name: "Vibe K5 Plus", codename: "A6020", variant: 2, type: "phone", maintainers: [], install_method: "fastboot_unlocked" }, D)!;
  const merged = finalize([v1, v2]).records[0];
  assert.deepEqual(merged.install!.map((i) => i.guide), [
    "https://wiki.lineageos.org/devices/A6020/install/variant1/",
    "https://wiki.lineageos.org/devices/A6020/install/variant2/",
  ]);
});
