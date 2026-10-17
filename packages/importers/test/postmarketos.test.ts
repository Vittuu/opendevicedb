import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { fromDeviceinfo, parseDeviceinfo, isGeneric, pmosCategory, socFromDtb, splitPmosName, wikiTitle, wikiUrl, pmaportsUrl, pmosInstall, PMOS_INSTALL_GUIDE } from "../src/sources/postmarketos.ts";
import { fromDevice } from "../src/sources/lineageos.ts";

const D = "2026-10-17";

const FP4 = `# Reference: <https://postmarketos.org/deviceinfo>
deviceinfo_format_version="0"
deviceinfo_name="Fairphone 4"
deviceinfo_manufacturer="Fairphone"
deviceinfo_codename="fairphone-fp4"
deviceinfo_year="2021"
deviceinfo_dtb="qcom/sm7225-fairphone-fp4"
deviceinfo_chassis="handset"
`;

test("deviceinfo parsing", () => {
  const i = parseDeviceinfo(FP4 + `deviceinfo_name_x='single'\ndeviceinfo_esc="Chromebook 2 11.6\\""\n# deviceinfo_commented="no"\n`);
  assert.equal(i.name, "Fairphone 4");
  assert.equal(i.chassis, "handset");
  assert.equal(i.name_x, "single");
  assert.equal(i.esc, 'Chromebook 2 11.6"');
  assert.equal(i.commented, undefined);
});

test("generic ports are skipped", () => {
  assert.equal(isGeneric({ name: "QEMU amd64", manufacturer: "QEMU", chassis: "vm" }), true);
  assert.equal(isGeneric({ name: "Qualcomm msm8916-based device", manufacturer: "Qualcomm" }), true);
  assert.equal(isGeneric({ name: "generic x86_64 system", manufacturer: "generic" }), true);
  assert.equal(isGeneric({ name: "Samsung Exynos 9820 Generic Device", manufacturer: "Samsung", chassis: "handset" }), true);
  assert.equal(isGeneric({ name: "Fairphone 4", manufacturer: "Fairphone", chassis: "handset" }), false);
});

test("chassis and name → category", () => {
  assert.equal(pmosCategory("handset", "Fairphone 4"), "phone");
  assert.equal(pmosCategory("tablet", "Kobo Clara HD"), "e-reader");
  assert.equal(pmosCategory("tablet", "Amazon Kindle Fire HD (2nd Generation)"), "tablet");
  assert.equal(pmosCategory("tablet", "AYN Odin"), "game-console");
  assert.equal(pmosCategory("watch", "LG G Watch R"), "wearable");
  assert.equal(pmosCategory("convertible", "Google Kukui Chromebook"), "laptop");
  assert.equal(pmosCategory("", "Google Gru Chromebook"), "laptop");
  assert.equal(pmosCategory("embedded", "Amazon Fire TV Stick Lite"), "media-player");
  assert.equal(pmosCategory("embedded", "Linksys WRT1900ACS/WRT1900ACS V2"), "router");
  assert.equal(pmosCategory("embedded", "Xunlong Orange Pi PC"), "single-board");
  assert.equal(pmosCategory("desktop", "Hardkernel ODROID N2+"), "single-board");
  assert.equal(pmosCategory("embedded", "WD MyCloud Gen2"), "other");
  assert.equal(pmosCategory("", "Mystery"), "other");
});

test("SoC from dtb", () => {
  assert.deepEqual(socFromDtb("qcom/sdm845-oneplus-enchilada qcom/sdm845-oneplus-fajita"), ["SDM845", "SDM845"]);
  assert.deepEqual(socFromDtb("allwinner/sun50i-a64-pinephone-1.2"), ["Allwinner A64"]);
  assert.deepEqual(socFromDtb("exynos4412-i9300"), ["Exynos4412"]);
  assert.deepEqual(socFromDtb("rockchip/rk3399-pinebook-pro"), ["RK3399"]);
  assert.deepEqual(socFromDtb("meson-g12b-odroid-n2-plus"), []);
});

test("brand in the marketing name wins over the ODM", () => {
  assert.deepEqual(splitPmosName("LG", "Google Nexus 5X"), { vendor: "Google", model: "Nexus 5X" });
  assert.deepEqual(splitPmosName("HMD Global", "HMD Global Nokia 6.1"), { vendor: "Nokia", model: "6.1" });
  assert.deepEqual(splitPmosName("Reeder", "Jolla C2"), { vendor: "Jolla", model: "C2" });
  assert.deepEqual(splitPmosName("XiaoMi", "Xiaomi Poco F1"), { vendor: "Xiaomi", model: "Poco F1" });
  assert.deepEqual(splitPmosName("Odroid", "Odroid XU4"), { vendor: "Hardkernel", model: "Odroid XU4" });
});

test("deviceinfo → record, status by pmaports category", () => {
  const fp4 = fromDeviceinfo("community", "device-fairphone-fp4", FP4, "Fairphone 4 (fairphone-fp4)", D)!;
  assert.deepEqual(validate(fp4), []);
  assert.equal(fp4.id, "fairphone/4");
  assert.equal(fp4.category, "phone");
  assert.equal(fp4.status, "open-firmware");
  assert.deepEqual(fp4.identifiers, { chips: ["SM7225"] });
  assert.deepEqual(fp4.aliases, ["", "fairphone-fp4"]);
  assert.equal(fp4.projects![0].url, "https://gitlab.postmarketos.org/postmarketOS/pmaports/-/tree/main/device/community/device-fairphone-fp4");
  assert.equal(fp4.projects![1].url, "https://wiki.nura.eco/wiki/Fairphone_4_(fairphone-fp4)");
  assert.deepEqual(fp4.provenance, { sources: ["postmarketos"] });

  assert.equal(fromDeviceinfo("testing", "device-fairphone-fp4", FP4, null, D)!.status, "open-firmware");
  assert.equal(fromDeviceinfo("downstream", "device-fairphone-fp4", FP4, null, D)!.status, "partial-protocol");
  const arch = fromDeviceinfo("archived", "device-fairphone-fp4", FP4, null, D)!;
  assert.equal(arch.status, "partial-protocol");
  assert.equal(arch.projects!.length, 1);
  assert.match(arch.projects![0].name, /archived/);

  assert.equal(fromDeviceinfo("community", "device-qemu-amd64", 'deviceinfo_name="QEMU amd64"\ndeviceinfo_manufacturer="QEMU"\ndeviceinfo_chassis="vm"\n', null, D), null);
  assert.equal(fromDeviceinfo("testing", "device-x", "nothing here", null, D), null);
});

test("same phone gets the same id as in the LineageOS importer", () => {
  const pm = fromDeviceinfo("community", "device-samsung-starqltechn", 'deviceinfo_name="Samsung Galaxy S9"\ndeviceinfo_manufacturer="Samsung"\ndeviceinfo_codename="samsung-starqltechn"\ndeviceinfo_chassis="handset"\n', null, D)!;
  const lin = fromDevice({ vendor: "Samsung", name: "Galaxy S9", codename: "starlte", type: "phone", maintainers: [] }, D)!;
  assert.equal(pm.id, lin.id);
  const n5x = fromDeviceinfo("testing", "device-lg-bullhead", 'deviceinfo_name="Google Nexus 5X"\ndeviceinfo_manufacturer="LG"\ndeviceinfo_chassis="handset"\n', null, D)!;
  assert.equal(n5x.id, fromDevice({ vendor: "Google", name: "Nexus 5X", codename: "bullhead", type: "phone" }, D)!.id);
});

test("wiki and pmaports urls", () => {
  assert.equal(wikiTitle({ name: "PINE64 PinePhone", codename: "pine64-pinephone" }), "PINE64 PinePhone (pine64-pinephone)");
  assert.equal(wikiUrl('Samsung Chromebook 2 11.6" (google-peach-pit)'), "https://wiki.nura.eco/wiki/Samsung_Chromebook_2_11.6%22_(google-peach-pit)");
  assert.equal(pmaportsUrl("testing", "device-pine64-pinephone"), "https://gitlab.postmarketos.org/postmarketOS/pmaports/-/tree/main/device/testing/device-pine64-pinephone");
});

test("install route from deviceinfo_flash_method", () => {
  const fp4 = fromDeviceinfo("community", "device-fairphone-fp4", FP4 + 'deviceinfo_flash_method="fastboot"\n', "Fairphone 4 (fairphone-fp4)", D)!;
  assert.deepEqual(validate(fp4), []);
  assert.deepEqual(fp4.install, [{
    project: "Nura/postmarketOS", method: "usb-bootloader", guide: "https://wiki.nura.eco/wiki/Fairphone_4_(fairphone-fp4)", difficulty: "medium",
    tools: ["Computer with pmbootstrap and fastboot", "USB cable"],
    notes: "Uses the bootloader's fastboot mode. The bootloader must be unlocked first, which wipes the device. Installing replaces the stock system: back up your data first.",
  }]);
  // no wiki page: the general installation page; testing port: says so
  const noWiki = fromDeviceinfo("testing", "device-fairphone-fp4", FP4 + 'deviceinfo_flash_method="fastboot"\n', null, D)!;
  assert.equal(noWiki.install![0].guide, PMOS_INSTALL_GUIDE);
  assert.equal(PMOS_INSTALL_GUIDE, "https://wiki.nura.eco/wiki/Installation");
  assert.match(noWiki.install![0].notes!, /testing port/);
  // Samsung: Heimdall, no unlock claim
  const sam = pmosInstall("community", { flash_method: "heimdall-isorec", chassis: "handset" }, null)!;
  assert.deepEqual(sam.tools, ["Computer with pmbootstrap and Heimdall", "USB cable"]);
  assert.doesNotMatch(sam.notes!, /unlocked/);
  // no flasher (SBC, laptop): written to storage
  const sbc = pmosInstall("testing", { chassis: "embedded" }, null)!;
  assert.equal(sbc.method, "other");
  assert.match(sbc.notes!, /No flasher/);
  // a fastboot SBC is not told to unlock a phone bootloader
  assert.doesNotMatch(pmosInstall("main", { flash_method: "fastboot", chassis: "embedded" }, null)!.notes!, /unlocked/);
  // archived ports: no route
  assert.equal(pmosInstall("archived", { flash_method: "fastboot", chassis: "handset" }, null), null);
  assert.equal(fromDeviceinfo("archived", "device-fairphone-fp4", FP4, null, D)!.install!.length, 0);
});
