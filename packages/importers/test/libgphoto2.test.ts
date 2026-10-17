import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "@opendevicedb/core";
import { finalize } from "../src/lib.ts";
import {
  stripComments, stripIfZero, arrayBody, initialisers, usbNumber,
  normaliseVendor, normaliseModel, gphotoCategory, parsePtp2, parseCanon, parseSierra, fromEntry,
} from "../src/sources/libgphoto2.ts";

const D = "2026-10-17";

const PTP2 = `
static struct {
	const char *model;
	unsigned short usb_vendor;
	unsigned short usb_product;
	unsigned long device_flags;
} models[] = {
#ifndef FUZZING_BUILD_MODE_UNSAFE_FOR_PRODUCTION
	/* reported by someone, http://example.org/x */
	{"Kodak:DX3900", 0x040a, 0x0170, 0},
	{"Nikon:DSC D90 (PTP mode)",	0x04b0, 0x0421, PTP_CAP|PTP_CAP_PREVIEW},
	{"Nikon:DSC D90 (alternate id)",0x04b0, 0x0422, PTP_CAP_PREVIEW},
	{"Fuji:Fujifilm X-S10",	0x04cb, 0x02ea, PTP_CAP_PREVIEW},	/* only webcam mode */
	{ "GoPro:HERO4 Silver" , 0x2672, 0x000D, 0 },
	{"Apple:iPhone 4 (PTP mode)", 0x05ac, 0x1297, 0},
	{"HP:PhotoSmart ... ", 0x03f0, 0x4002, 0},
#if 0
	{"Canon:Old (PTP mode)", 0x04a9, 0x0001, 0},
#endif
	// {"Sony:Commented", 0x054c, 0x0001, 0},
#endif
};
static struct { const char *model; unsigned long device_flags; } ptpip_models[] = {
	{"PTP/IP Camera", PTP_CAP},
};`;

const CANON = `
const struct canonCamModelData models[] = {
	{"Canon:PowerShot A5",		CANON_CLASS_3,	NO_USB, NO_USB, CAP_NON, SL_MOVIE_SMALL, SL_THUMB, SL_PICTURE, "DE300 Canon Inc."},
        {"Canon:EOS D30",               CANON_CLASS_4,  0x04A9, 0x3044, CAP_SUP, SL_MOVIE_SMALL, SL_THUMB, SL_PICTURE, NULL},
#if 0 /* served better by ptp2 driver */
        {"Canon:PowerShot S45 (normal mode)", CANON_CLASS_4, 0x04A9, 0x306C, CAP_SUP, 0, 0, 0, NULL},
#else
        {"Canon:PowerShot S45 (normal mode)", CANON_CLASS_4, 0x04A9, 0x306D, CAP_EXP, 0, 0, 0, NULL},
#endif
        {"Canon:PowerShot unknown 1",   CANON_CLASS_1,  0x04A9, 0x3050, CAP_SUP, 0, 0, 0, NULL},
        {NULL, CANON_CLASS_NONE, 0x0000, 0x0000, CAP_NON, 0U, 0U, 0U, NULL}
};`;

const SIERRA = `
static struct { const char *manuf; const char *model; } sierra_cameras[] = {
	{"Epson", "PhotoPC 500", SIERRA_MODEL_EPSON,	0, 0, 0, NULL },
	{"Nikon", "CoolPix 880",SIERRA_MODEL_CAM_DESC,	0x04b0, 0x0103, 0,
							&cp880_cam_desc},
/*
	{"Olympus", "E-520", 	SIERRA_MODEL_CAM_DESC,	0x07b4, 0x110, 0, NULL},
*/
	{"Konica-Minolta", "Dimage X (Sierra Mode)", SIERRA_MODEL_DEFAULT, 0, 0, 0, NULL },
	{NULL, NULL, 0,	0, 0, 0, NULL}
};`;

test("C helpers: comments, #if 0, array bodies, initialisers", () => {
  assert.equal(stripComments('a /* x */ b // y\n"http://k" c'), 'a   b \n"http://k" c');
  assert.equal(stripIfZero("a\n#if 0\nb\n#else\nc\n#endif\n#ifdef X\nd\n#endif"), "a\nc\nd");
  assert.equal(arrayBody("int x[] = { {1,{2}}, \"}\" };", "x"), ' {1,{2}}, "}" ');
  assert.deepEqual(initialisers('{"a,b", 0x1, F|G}, {"c", NO_USB}'), [['"a,b"', "0x1", "F|G"], ['"c"', "NO_USB"]]);
  assert.equal(usbNumber("0x04A9"), 0x04a9);
  assert.equal(usbNumber("NO_USB"), null);
  assert.equal(usbNumber("0"), null);
});

test("names and categories", () => {
  assert.equal(normaliseVendor("Fuji"), "Fujifilm");
  assert.equal(normaliseVendor("Konica-Minolta"), "Konica Minolta");
  assert.equal(normaliseVendor("TOPDON"), "Topdon");
  assert.equal(normaliseModel("Nikon", "DSC D90 (PTP mode)"), "DSC D90");
  assert.equal(normaliseModel("Sony", "Alpha-A7 III (PC Control)"), "Alpha-A7 III");
  assert.equal(normaliseModel("Fujifilm", "Fujifilm X-S10"), "X-S10");
  assert.equal(normaliseModel("Leica", "SL (Typ 601)"), "SL (Typ 601)");
  assert.equal(normaliseModel("Canon", "PowerShot S100 (2000)"), "PowerShot S100 (2000)");
  assert.equal(gphotoCategory("GoPro", "HERO9 Black"), "action-camera");
  assert.equal(gphotoCategory("Apple", "iPhone 4"), null);
  assert.equal(gphotoCategory("Apple", "QuickTake 200"), "camera");
  assert.equal(gphotoCategory("Nikon", "D850"), "camera");
});

test("ptp2 table → records; mode variants merge, PTP_CAP → controllable", () => {
  const entries = parsePtp2(PTP2);
  assert.deepEqual(entries.map((e) => `${e.vendor}:${e.model}`), [
    "Kodak:DX3900", "Nikon:DSC D90 (PTP mode)", "Nikon:DSC D90 (alternate id)", "Fuji:Fujifilm X-S10",
    "GoPro:HERO4 Silver", "Apple:iPhone 4 (PTP mode)", "HP:PhotoSmart ... ",
  ]);
  assert.deepEqual(entries[1], { vendor: "Nikon", model: "DSC D90 (PTP mode)", usb: [0x04b0, 0x0421], capture: true });
  assert.equal(entries[3].capture, false, "PTP_CAP_PREVIEW alone is not capture");
  const f = finalize(entries.map((e) => fromEntry("ptp2", e, D)).filter((r) => r !== null));
  assert.equal(f.invalid, 0);
  assert.equal(f.merged, 1);
  assert.deepEqual(f.records.map((r) => r.id), ["fujifilm/x-s10", "gopro/hero4-silver", "kodak/dx3900", "nikon/dsc-d90"]);
  const d90 = f.records[3];
  assert.equal(d90.status, "controllable");
  assert.deepEqual(d90.identifiers, { usb: ["04b0:0421", "04b0:0422"] });
  assert.equal(d90.projects![0].url, "https://github.com/gphoto/libgphoto2/blob/master/camlibs/ptp2/library.c");
  assert.equal(f.records[0].status, "partial-protocol");
  assert.equal(f.records[1].category, "action-camera");
  assert.deepEqual(f.records[1].identifiers!.usb, ["2672:000d"]);
  for (const r of f.records) assert.deepEqual(validate(r), [], JSON.stringify(r));
});

test("canon and sierra tables", () => {
  const canon = parseCanon(CANON);
  assert.deepEqual(canon.map((e) => [e.model, e.usb, e.capture]), [
    ["PowerShot A5", null, false],
    ["EOS D30", [0x04a9, 0x3044], true],
    ["PowerShot S45 (normal mode)", [0x04a9, 0x306d], false],
    ["PowerShot unknown 1", [0x04a9, 0x3050], true],
  ]);
  const recs = canon.map((e) => fromEntry("canon", e, D));
  assert.equal(recs[3], null, "placeholder 'unknown' models are dropped");
  assert.equal(recs[0]!.identifiers!.usb!.length, 0);
  assert.equal(recs[0]!.interfaces![0].transport, "other");
  assert.equal(recs[2]!.model, "PowerShot S45");

  const sierra = parseSierra(SIERRA);
  assert.deepEqual(sierra.map((e) => [e.vendor, e.model, e.usb]), [
    ["Epson", "PhotoPC 500", null],
    ["Nikon", "CoolPix 880", [0x04b0, 0x0103]],
    ["Konica-Minolta", "Dimage X (Sierra Mode)", null],
  ]);
  const s = sierra.map((e) => fromEntry("sierra", e, D))!;
  assert.equal(s[2]!.id, "konica-minolta/dimage-x");
  assert.equal(s[2]!.vendor, "Konica Minolta");
  assert.equal(s[1]!.status, "controllable");
  for (const r of [...recs, ...s]) if (r) assert.deepEqual(validate(r), [], JSON.stringify(r));
});
