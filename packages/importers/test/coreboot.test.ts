import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import {
  parseBoardInfo, parseKconfigName, parseVendorName, parseVariantDirs, corebootCategory, normVendor,
  splitLabel, productVendor, chromeCategory, googleProducts, fromBoard, boardDoc, corebootInstall, COREBOOT_FLASHING,
} from "../src/sources/coreboot.ts";

const D = "2026-10-17";
const allValid = (rs: DeviceRecord[]) => {
  for (const r of rs) assert.deepEqual(validate(r), [], JSON.stringify(r));
};

const BRYA_NAME = `## SPDX-License-Identifier: GPL-2.0-only

comment "Brya (Intel AlderLake/RaptorLake/TwinLake (12 - 13th Gen))"

config BOARD_GOOGLE_AGAH
	bool "->  Agah"

config BOARD_GOOGLE_ANAHERA
	bool "->  Anahera (HP Elite c640 14 inch G3 Chromebook)"

config BOARD_GOOGLE_CROTA
	bool "->  Crota (Multiple devices - See help text)"
	help
	  The Crota board supports the following devices:
	  - Dell Latitude 5430 Chromebook
	  - Dell Latitude 5430 2-in-1 Chromebook

config BOARD_GOOGLE_KINOX
	bool "->  Kinox (Lenovo ThinkCentre M60q Chromebox)"

config BOARD_GOOGLE_PEACH
	bool "->  Peach Pit (Samsung Chromebook 2 11\\")"
`;

test("coreboot board_info and Kconfig parsing", () => {
  assert.deepEqual(parseBoardInfo("Vendor name: 51NB\nBoard name: Thinkpad X210\nCategory: laptop\nRelease year: 2017\nROM socketed: n\n"), {
    "vendor name": "51NB", "board name": "Thinkpad X210", category: "laptop", "release year": "2017", "rom socketed": "n",
  });
  const e = parseKconfigName(BRYA_NAME);
  assert.deepEqual(e.map((x) => x.symbol), ["BOARD_GOOGLE_AGAH", "BOARD_GOOGLE_ANAHERA", "BOARD_GOOGLE_CROTA", "BOARD_GOOGLE_KINOX", "BOARD_GOOGLE_PEACH"]);
  assert.deepEqual(e[2].help, ["The Crota board supports the following devices:", "- Dell Latitude 5430 Chromebook", "- Dell Latitude 5430 2-in-1 Chromebook"]);
  assert.equal(e[4].label, '->  Peach Pit (Samsung Chromebook 2 11")');
  assert.equal(parseVendorName('## SPDX\n\nconfig VENDOR_DELL\n\tbool "Dell Inc."\n'), "Dell Inc.");
  const vd = parseVariantDirs(`config VARIANT_DIR
	default "h61m-cs"            if BOARD_ASUS_H61M_CS
	default "p8h61-m_lx"         if BOARD_ASUS_P8H61_M_LX || BOARD_ASUS_P8H61_M_LX_B

config MAINBOARD_PART_NUMBER
	default "H61M-CS"            if BOARD_ASUS_H61M_CS
`);
  assert.deepEqual([...vd], [["BOARD_ASUS_H61M_CS", "h61m-cs"], ["BOARD_ASUS_P8H61_M_LX", "p8h61-m_lx"], ["BOARD_ASUS_P8H61_M_LX_B", "p8h61-m_lx"]]);
});

test("coreboot category, vendor and label normalisation", () => {
  assert.equal(corebootCategory("laptop"), "laptop");
  assert.equal(corebootCategory("half"), "desktop");
  assert.equal(corebootCategory("sbc"), "single-board");
  assert.equal(corebootCategory("eval"), null);
  assert.equal(corebootCategory("emulation"), null);
  assert.equal(normVendor("Dell Inc."), "Dell");
  assert.equal(normVendor("Bostentech (Shenzhen Bostrontium Teng Technology)"), "Bostentech");
  assert.deepEqual(splitLabel("51NB X210", ["51NB"]), { model: "X210", aliases: [] });
  assert.deepEqual(splitLabel("ThinkPad X200 / X200s / X200t", ["Lenovo"]), {
    model: "ThinkPad X200", aliases: ["ThinkPad X200 / X200s / X200t", "ThinkPad X200s", "ThinkPad X200t"],
  });
  assert.deepEqual(splitLabel("EPIA-EX (work in progress)", ["VIA"]).model, "EPIA-EX");
  assert.deepEqual(splitLabel("-> MC APL1", ["Siemens"]).model, "MC APL1");
});

test("coreboot Google products", () => {
  assert.deepEqual(productVendor("HP Elite c640 14 inch G3 Chromebook"), { vendor: "HP", model: "Elite c640 14 inch G3 Chromebook" });
  assert.deepEqual(productVendor("IdeaPad Flex 5/5i Chromebook"), { vendor: "Lenovo", model: "IdeaPad Flex 5/5i Chromebook" });
  assert.deepEqual(productVendor("Asus Chromebook Flip C101PA"), { vendor: "ASUS", model: "Chromebook Flip C101PA" });
  assert.equal(productVendor("Positivo Chromebook N2320"), null);
  assert.deepEqual(productVendor("Positivo Chromebook N2320", true), { vendor: "Positivo", model: "Chromebook N2320" });
  assert.equal(productVendor("Education Chromebook", true), null);
  assert.equal(chromeCategory("Lenovo ThinkCentre M60q Chromebox"), "desktop");
  assert.equal(chromeCategory("Lenovo IdeaPad Duet Chromebook"), "tablet");
  assert.equal(chromeCategory("Google WiFi"), "router");
  assert.equal(chromeCategory("Dell Chromebook 11"), "laptop");
  const crota = parseKconfigName(BRYA_NAME)[2];
  assert.deepEqual(googleProducts(crota).products.map((p) => p.name), ["Dell Latitude 5430 Chromebook", "Dell Latitude 5430 2-in-1 Chromebook"]);
  const fizz = { symbol: "BOARD_GOOGLE_FIZZ", label: "->  Fizz (Multiple devices - See help text)", help: ["- HP Chromebox G2 (Kench)", "- Fizz Reference"] };
  assert.deepEqual(googleProducts(fizz).products, [{ name: "HP Chromebox G2", codename: "Kench", fromHelp: true }]);
  assert.deepEqual(googleProducts({ symbol: "X", label: "->  Agah", help: [] }), { codenames: ["Agah"], products: [] });
});

test("coreboot boards → records", () => {
  const google = fromBoard({ dir: "google/brya", vendorName: "Google", kconfigName: BRYA_NAME, boardInfo: "Vendor name: Google\nBoard name: Brya\nCategory: laptop\n" }, D);
  allValid(google);
  assert.deepEqual(google.map((r) => r.id), [
    "hp/elite-c640-14-inch-g3-chromebook", "dell/latitude-5430-chromebook", "dell/latitude-5430-2-in-1-chromebook",
    "lenovo/thinkcentre-m60q-chromebox", "samsung/chromebook-2-11",
  ]);
  assert.equal(google[3].category, "desktop");
  assert.deepEqual(google[0].aliases, ["Google Anahera"]);
  assert.equal(google[0].status, "open-firmware");
  assert.equal(google[0].projects![0].url, "https://github.com/coreboot/coreboot/tree/main/src/mainboard/google/brya");

  const asus = fromBoard({
    dir: "asus/h61-series", vendorName: "ASUS",
    kconfigName: 'config BOARD_ASUS_H61M_CS\n\tbool "H61M-CS"\n\nconfig BOARD_ASUS_P8H61_M_LX\n\tbool "P8H61-M LX"\n',
    boardInfo: "Category: desktop\n",
    variantDirs: new Map([["BOARD_ASUS_H61M_CS", "h61m-cs"]]),
    variantInfo: new Map([["h61m-cs", "Category: desktop\nRelease year: 2011\nROM protocol: SPI\nROM package: DIP-8\nROM socketed: y\nFlashrom support: y\n"]]),
  }, D);
  allValid(asus);
  assert.deepEqual(asus.map((r) => [r.id, r.vendor, r.model, r.category]), [
    ["asus/h61m-cs", "ASUS", "H61M-CS", "desktop"], ["asus/p8h61-m-lx", "ASUS", "P8H61-M LX", "desktop"],
  ]);
  assert.equal(asus[0].summary, "Supported by coreboot (src/mainboard/asus/h61-series). Released 2011. Flash: SPI DIP-8, socketed. flashrom: yes.");
  assert.match(asus[0].projects![0].url, /h61-series\/variants\/h61m-cs$/);
  assert.deepEqual(asus[0].provenance, { sources: ["coreboot"] });

  // eval, emulation and reference boards are skipped
  assert.deepEqual(fromBoard({ dir: "amd/birman", vendorName: "AMD", kconfigName: 'config BOARD_AMD_BIRMAN\n\tbool "Birman"\n', boardInfo: "Category: eval\n" }, D), []);
  assert.deepEqual(fromBoard({ dir: "emulation/qemu-q35", vendorName: "Emulation", kconfigName: 'config BOARD_EMULATION_QEMU_Q35\n\tbool "QEMU q35"\n', boardInfo: "Category: laptop\n" }, D), []);
  assert.deepEqual(fromBoard({ dir: "intel/x", vendorName: "Intel", kconfigName: 'config BOARD_INTEL_X\n\tbool "Kabylake RVP3"\n', boardInfo: "Category: laptop\n" }, D), []);
  // Dell Inc. → Dell, vendor prefix stripped from the label
  const dell = fromBoard({ dir: "dell/snb_ivb_workstations", vendorName: "Dell Inc.", kconfigName: 'config BOARD_DELL_PRECISION_T1650\n\tbool "Dell Precision T1650"\n', boardInfo: "Category: desktop\n" }, D);
  assert.deepEqual(dell.map((r) => r.id), ["dell/precision-t1650"]);
});

test("coreboot install routes", () => {
  const docs = new Set(["lenovo/t440p.md", "up/squared/index.md", "framework/azalea/azalea.md", "lenovo/x2xx_series.md"]);
  assert.equal(boardDoc("lenovo/t440p", docs), "https://doc.coreboot.org/mainboard/lenovo/t440p.html");
  assert.equal(boardDoc("up/squared", docs), "https://doc.coreboot.org/mainboard/up/squared/index.html");
  assert.equal(boardDoc("framework/azalea", docs), "https://doc.coreboot.org/mainboard/framework/azalea/azalea.html");
  assert.equal(boardDoc("lenovo/x230", docs), undefined, "series pages are not guessed");
  assert.equal(COREBOOT_FLASHING, "https://doc.coreboot.org/tutorial/flashing_firmware/index.html");

  const [t440p] = fromBoard({
    dir: "lenovo/t440p", vendorName: "Lenovo", kconfigName: 'config BOARD_LENOVO_THINKPAD_T440P\n\tbool "ThinkPad T440p"\n',
    boardInfo: "Category: laptop\nROM package: SOIC-8\nROM protocol: SPI\nROM socketed: n\nFlashrom support: n\n",
    doc: boardDoc("lenovo/t440p", docs),
  }, D);
  assert.deepEqual(validate(t440p), []);
  assert.deepEqual(t440p.install!.map(({ notes, ...r }) => r), [{
    project: "coreboot", method: "spi-programmer", guide: "https://doc.coreboot.org/mainboard/lenovo/t440p.html", difficulty: "hard",
    opens_device: true, brick_risk: "high", reversible: "yes", tools: ["SPI flash programmer (CH341A)", "SOIC-8 test clip"],
  }]);
  assert.match(t440p.install![0].notes!, /no official images/);
  assert.match(t440p.install![0].notes!, /Back up the original flash/);
  assert.doesNotMatch(t440p.install![0].notes!, /flashrom supports/);

  // socketed DIP chip: no clip; flashrom support mentioned; no doc page → generic guide
  const dip = corebootInstall({ "rom protocol": "SPI", "rom package": "DIP-8", "rom socketed": "y", "flashrom support": "y" }, "asus");
  assert.equal(dip.guide, COREBOOT_FLASHING);
  assert.deepEqual(dip.tools, ["SPI flash programmer (CH341A)"]);
  assert.match(dip.notes!, /socketed/);
  assert.match(dip.notes!, /flashrom supports the board/);
  // parallel / FWH flash: not an SPI programmer job
  const fwh = corebootInstall({ "rom protocol": "FWH", "rom package": "PLCC", "rom socketed": "y" }, "asus");
  assert.equal(fwh.method, "other");
  assert.deepEqual(fwh.tools, ["Flash programmer for FWH PLCC chips"]);
  // Chromebooks: write protection
  const cb = corebootInstall({}, "google");
  assert.equal(cb.method, "other");
  assert.equal(cb.difficulty, "hard");
  assert.match(cb.notes!, /write protection/);
  assert.equal(cb.opens_device, undefined);
});
