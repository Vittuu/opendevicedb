import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DeviceRecord } from "@opendevicedb/core";
import {
  parseDeviceSupport, parseGadgetPage, splitGadget, gadgetCategory, gadgetStatus, fromGadget, gadgetInstall,
  deviceTypeCoordinators, deviceTypeNames, stringConstants, parseCoordinator, coordinatorBleNames,
  literalPrefix, regexAlternatives, bleNamesFromRegex, attachBleNames,
} from "../src/sources/gadgetbridge.ts";

const D = "2026-10-17";

const YML = `
__aliases:
  - &flags_high_free [feature_high, pair_free]
  - &link_fitpro ../../../internals/specifics/fitpro-protocol
device_support:
  sony_wf-1000xm4:
    category: headphones
    vendor: sony
    flags: *flags_high_free
  fitpro_m6:
    vendor: fitpro
    category: wearables
    flags: [feature_poor, pair_free]
    flags: [feature_unknown, pair_free]
    links:
      protocol: *link_fitpro
  broken: 3
`;

test("device_support.yml: aliases resolved, duplicate keys last-wins, junk skipped", () => {
  const e = parseDeviceSupport(YML);
  assert.deepEqual(e.map((x) => x.key), ["sony_wf-1000xm4", "fitpro_m6"]);
  assert.deepEqual(e[0].flags, ["feature_high", "pair_free"]);
  assert.deepEqual(e[1].flags, ["feature_unknown", "pair_free"]);
  assert.equal(e[1].links.protocol, "../../../internals/specifics/fitpro-protocol");
});

test("gadget page: title and device() headings", () => {
  const p = parseGadgetPage(`---\ntitle: Huawei / Honor\n---\n\n# Huawei / Honor\n\n## Honor Band 3 {{ device("honor_band_3") }}\n\ntext\n\n## Not a device\n\n### Huawei Watch GT {{ device('huawei_watch_gt') }}\n`);
  assert.equal(p.title, "Huawei / Honor");
  assert.deepEqual([...p.headings], [["honor_band_3", "Honor Band 3"], ["huawei_watch_gt", "Huawei Watch GT"]]);
});

test("vendor/model split", () => {
  assert.deepEqual(splitGadget("sony", "Sony", "WH-1000XM4"), { vendor: "Sony", model: "WH-1000XM4", aliases: [] });
  assert.deepEqual(splitGadget("huawei-honor", "Huawei / Honor", "Honor Band 3"), { vendor: "Honor", model: "Band 3", aliases: [] });
  assert.deepEqual(splitGadget("garmin", "Garmin", "Garmin D2 Air"), { vendor: "Garmin", model: "D2 Air", aliases: [] });
  assert.deepEqual(splitGadget("fossil", "Fossil", "Skagen Jorn Gen 6"), { vendor: "Skagen", model: "Jorn Gen 6", aliases: [] });
  assert.deepEqual(splitGadget("moyoung", "Moyoung / Da Fit", "Colmi P76"), { vendor: "Colmi", model: "P76", aliases: [] });
  assert.deepEqual(splitGadget("moyoung", "Moyoung / Da Fit", "L70"), { vendor: "Moyoung", model: "L70", aliases: [] });
  assert.deepEqual(splitGadget("gloryfit", "GloryFit", "D3 (brandless)"), { vendor: "Generic", model: "D3", aliases: ["GloryFit D3"] });
  assert.deepEqual(splitGadget("keephealth", "Keep Health", "LIGE (C60)"), { vendor: "LIGE", model: "C60", aliases: [] });
  assert.deepEqual(splitGadget("other", "Others & unbranded", "ID115"), { vendor: "Generic", model: "ID115", aliases: [] });
  assert.deepEqual(splitGadget("ollee", "Ollee Watch One", "Ollee Watch One"), { vendor: "Ollee", model: "Watch One", aliases: [] });
  assert.deepEqual(splitGadget("banglejs", "Bangle.js", "Bangle.js 2"), { vendor: "Espruino", model: "Bangle.js 2", aliases: [] });
  assert.deepEqual(splitGadget("aawireless", "AAWireless", "AAWireless"), { vendor: "AAWireless", model: "AAWireless", aliases: [] });
  assert.deepEqual(splitGadget("flipper", "Flipper", "Zero", "flipper_zero"), { vendor: "Flipper Devices", model: "Flipper Zero", aliases: [] });
});

test("category and status", () => {
  assert.equal(gadgetCategory("headphones"), "audio");
  assert.equal(gadgetCategory("wearables"), "wearable");
  assert.equal(gadgetCategory("thermometers", "femometer_vinca_2"), "medical");
  assert.equal(gadgetCategory("something-new"), "other");
  assert.equal(gadgetStatus(["feature_high"]), "controllable");
  assert.equal(gadgetStatus(["feature_poor", "pair_free"]), "partial-protocol");
});

test("gadget → record with anchored page link and protocol doc", () => {
  const [, fitpro] = parseDeviceSupport(YML);
  const p = parseGadgetPage(`---\ntitle: FitPro\n---\n## M6 {{ device("fitpro_m6") }}\n`);
  const r = fromGadget(fitpro, "fitpro", p, D)!;
  assert.deepEqual(validate(r), []);
  assert.deepEqual(r, {
    id: "fitpro/m6", vendor: "FitPro", model: "M6", aliases: [], category: "wearable", status: "controllable",
    projects: [
      { name: "Gadgetbridge", url: "https://gadgetbridge.org/gadgets/wearables/fitpro/#device__fitpro_m6", kind: "integration", license: "AGPL-3.0" },
      { name: "Gadgetbridge protocol notes", url: "https://gadgetbridge.org/internals/specifics/fitpro-protocol/", kind: "protocol-doc", license: "AGPL-3.0" },
    ],
    install: [{
      project: "Gadgetbridge", method: "pairing", guide: "https://gadgetbridge.org/gadgets/wearables/fitpro/#device__fitpro_m6",
      installer: "https://f-droid.org/packages/nodomain.freeyourgadget.gadgetbridge/", difficulty: "easy",
      tools: ["Android phone with the Gadgetbridge app"], brick_risk: "none", reversible: "yes",
    }],
    provenance: { sources: ["gadgetbridge"] }, updated: D,
  });
  assert.equal(fromGadget({ ...fitpro, key: "missing" }, "fitpro", p, D), null);
  assert.equal(fromGadget({ ...fitpro, key: "wasp_os" }, "wasp-os", parseGadgetPage(`# Wasp-os {{ device("wasp_os") }}`), D), null);
});

test("DeviceType enum and strings.xml", () => {
  const enumSrc = `import a.b.PebbleCoordinator;\npublic enum DeviceType {\n    UNKNOWN(UnknownDeviceCoordinator.class),\n    PEBBLE(PebbleCoordinator.class),\n    MIBAND2(MiBand2Coordinator.class),\n    TEST(TestDeviceCoordinator.class);\n`;
  assert.deepEqual(deviceTypeCoordinators(enumSrc), ["PebbleCoordinator", "MiBand2Coordinator"]);
  assert.deepEqual(deviceTypeNames(`<string name="devicetype_miband2" translatable="false">Mi Band 2</string>\n<string name="other">x</string>\n<string name="devicetype_bw">Bowers &amp; Wilkins</string>`),
    { devicetype_miband2: "Mi Band 2", devicetype_bw: "Bowers & Wilkins" });
});

test("regex → BLE name literals", () => {
  assert.equal(literalPrefix("^Redmi Watch 3 [A-Z0-9]{4}$"), "Redmi Watch 3");
  assert.equal(literalPrefix(".*WH-1000XM4.*"), "WH-1000XM4");
  assert.equal(literalPrefix("^Bangle\\.js.*"), "Bangle.js");
  assert.equal(literalPrefix("^R11C?_[0-9A-F]{4}$"), "R11");
  assert.equal(literalPrefix("^EPIX PRO - \\d+mm$"), "EPIX PRO");
  assert.equal(literalPrefix("^HRM600:[0-9]+$"), "HRM600");
  assert.deepEqual(regexAlternatives("^fenix (3 )?Chronos$"), ["fenix 3 Chronos", "fenix Chronos"]);
  assert.deepEqual(bleNamesFromRegex("(huawei band 2-|huawei band 2 pro-).*"), ["huawei band 2-", "huawei band 2 pro-"]);
  assert.deepEqual(bleNamesFromRegex("^(COOSPO )?HW807$"), ["COOSPO HW807", "HW807"]);
  assert.deepEqual(bleNamesFromRegex("^(M6.*|M4.*|LH716|Sunset 6|716)$"), ["LH716", "Sunset 6", "716"]);
  assert.deepEqual(bleNamesFromRegex("(?!LE_).*WF-C710N$"), ["WF-C710N"]);
  assert.deepEqual(bleNamesFromRegex("^HK.*"), []);
  assert.deepEqual(bleNamesFromRegex("Nothing ear (a)", true), ["Nothing ear (a)"]);
});

test("coordinator parsing: literals, constants, LITERAL flag, Zepp OS names, Kotlin", () => {
  const consts = stringConstants(`public static final String MI_BAND2_NAME = "MI Band 2";\nconst val OTHER = "x"\n`);
  assert.deepEqual(consts, { MI_BAND2_NAME: "MI Band 2", OTHER: "x" });
  const java = `public class MiBand2Coordinator {
    @Override
    public String getManufacturer() { return "Xiaomi"; }
    @Override
    protected Pattern getSupportedDeviceName() {
        return Pattern.compile(HuamiConst.MI_BAND2_NAME + ".*", Pattern.CASE_INSENSITIVE);
    }
    @Override
    public int getDeviceNameResource() { return R.string.devicetype_miband2; }
}`;
  const c = parseCoordinator("MiBand2Coordinator", java, { "HuamiConst.MI_BAND2_NAME": "MI Band 2" });
  assert.deepEqual(c, { cls: "MiBand2Coordinator", nameRes: "devicetype_miband2", manufacturer: "Xiaomi", regex: "MI Band 2.*" });
  assert.deepEqual(coordinatorBleNames(c), ["MI Band 2"]);
  assert.equal(parseCoordinator("X", java).regex, undefined, "unresolved constant → no regex");
  const lit = parseCoordinator("N", `protected Pattern getSupportedDeviceName() {\n return Pattern.compile("Nothing ear (a)", Pattern.LITERAL | Pattern.CASE_INSENSITIVE);\n}`);
  assert.deepEqual(coordinatorBleNames(lit), ["Nothing ear (a)"]);
  const zepp = parseCoordinator("B", `public List<String> getDeviceBluetoothNames() {\n return Arrays.asList("Amazfit Balance", "Balance");\n}\npublic int getDeviceNameResource() {\n return R.string.devicetype_amazfit_balance;\n}`);
  assert.deepEqual(coordinatorBleNames(zepp), ["Amazfit Balance", "Balance"]);
  assert.equal(zepp.nameRes, "devicetype_amazfit_balance");
  const kt = parseCoordinator("V", `override fun getSupportedDeviceName(): Pattern {\n return Pattern.compile("^SmartShunt [A-Z0-9]+$")\n}\noverride fun getManufacturer(): String = "Victron"\noverride fun getDeviceNameResource(): Int = R.string.devicetype_victron_smartshunt`);
  assert.deepEqual([kt.manufacturer, kt.nameRes, coordinatorBleNames(kt)], ["Victron", "devicetype_victron_smartshunt", ["SmartShunt"]]);
});

test("BLE names attach by display name, equivalents, and per-literal for families", () => {
  const rec = (vendor: string, model: string): DeviceRecord => ({ id: `${vendor}/${model}`.toLowerCase().replace(/ /g, "-"), vendor, model, category: "wearable", status: "controllable", updated: D });
  const rs = [rec("Sony", "WH-1000XM4"), rec("Xiaomi", "Mi Band 8"), rec("FitPro", "LH716"), rec("FitPro", "Sunset 6"), rec("Honor", "Watch 5"), rec("Huawei", "Watch 5"), rec("Xiaomi", "Mijia LYWSD03MMC")];
  const n = attachBleNames(rs, [
    { display: "Sony WH-1000XM4", names: ["WH-1000XM4"] },
    { display: "Xiaomi Smart Band 8", names: ["Xiaomi Smart Band 8"] },
    { display: "FitPro", manufacturer: "FitPro", names: ["LH716", "Sunset 6", "716"] },
    { display: "Watch 5", names: ["watch 5-"] }, // ambiguous: Honor or Huawei
    { display: "Mijia Temperature and Humidity Sensor 2", names: ["LYWSD03MMC"] },
    { display: "Nothing here", names: [] },
  ]);
  assert.equal(n, 4);
  assert.deepEqual(rs.map((r) => r.identifiers?.ble_names ?? []), [["WH-1000XM4"], ["Xiaomi Smart Band 8"], ["LH716"], ["Sunset 6"], [], [], ["LYWSD03MMC"]]);
  assert.deepEqual(rs[1].aliases, ["Xiaomi Smart Band 8"]);
  for (const r of rs) assert.deepEqual(validate(r), []);
});

test("a family coordinator's names go to the records they spell", () => {
  const rec = (model: string): DeviceRecord => ({ id: `huawei/${model.toLowerCase().replace(/ /g, "-")}`, vendor: "Huawei", model, category: "wearable", status: "controllable", updated: D });
  const rs = [rec("Watch GT 3"), rec("Watch GT 3 Pro"), rec("Watch GT 3 SE")];
  attachBleNames(rs, [{ display: "Huawei Watch GT 3 (Pro)", names: ["huawei watch gt 3-", "huawei watch gt 3 pro-", "huawei watch gt 3 se-", "HWGT3"] }]);
  assert.deepEqual(rs.map((r) => r.identifiers?.ble_names), [["huawei watch gt 3-"], ["huawei watch gt 3 pro-", "HWGT3"], ["huawei watch gt 3 se-"]]);
});

test("gadgetbridge install route: pairing, with the vendor-app step the pair_* flag names", () => {
  const g = "https://gadgetbridge.org/gadgets/wearables/xiaomi/#device__x";
  const free = gadgetInstall(["feature_high", "pair_free"], g);
  assert.equal(free.method, "pairing");
  assert.equal(free.difficulty, "easy");
  assert.equal(free.guide, g);
  assert.equal(free.notes, undefined);
  const huami = gadgetInstall(["feature_most", "pair_huami", "os_zepp"], g);
  assert.equal(huami.difficulty, "medium");
  assert.match(huami.notes!, /authentication key: https:\/\/gadgetbridge\.org\/basics\/pairing\/huami-xiaomi-server\//);
  assert.match(gadgetInstall(["pair_xiaomi"], g).notes!, /Mi Fitness/);
  assert.match(gadgetInstall(["pair_fossil"], g).notes!, /fossil-server/);
  assert.equal(gadgetInstall(["pair_connect_once"], g).difficulty, "easy");
  const unknown = gadgetInstall(["feature_unknown", "pair_unknown"], g);
  assert.equal(unknown.difficulty, "medium");
  assert.match(unknown.notes!, /not documented/);
  for (const r of [free, huami, unknown]) {
    assert.deepEqual(validate({ id: "a/b", vendor: "A", model: "B", category: "wearable", status: "controllable", install: [r], updated: D }), []);
  }
});
