import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReportIssue, parseDeviceRef, groupReports, summarizeReports, reportsForRoute, installReportUrl,
  fetchReports, sortInstallRoutes, routeTitle, isDangerousRoute, reportsSearchUrl, type InstallRoute,
} from "../src/index.ts";

const body = (o: { device?: string; route?: string; fw?: string; project?: string; result?: string; notes?: string } = {}) =>
  `### Device\n\n${o.device ?? "spotify/car-thing"}\n\n### Install route\n\n${o.route ?? "usb-bootloader — USB bootloader (fastboot, DFU, burn mode)"}\n\n` +
  `### Firmware version before\n\n${o.fw ?? "8.9.2"}\n\n### Project and version installed\n\n${o.project ?? "superbird-tool 0.2"}\n\n` +
  `### Result\n\n${o.result ?? "worked — it runs as described"}\n\n### Notes\n\n${o.notes ?? "_No response_"}`;

const issue = (n: number, b = body(), extra: Record<string, unknown> = {}) => ({
  number: n, html_url: `https://github.com/opendevicedb/opendevicedb/issues/${n}`,
  title: "Install report: spotify/car-thing (usb-bootloader)", body: b, created_at: `2026-10-${10 + n}T08:00:00Z`, ...extra,
});

const route = (o: Partial<InstallRoute>): InstallRoute => ({ project: "X", method: "serial", guide: "https://x", difficulty: "hard", ...o });

test("device references: id, page URL, JSON URL", () => {
  assert.equal(parseDeviceRef("spotify/car-thing"), "spotify/car-thing");
  assert.equal(parseDeviceRef("https://opendevicedb.org/devices/Spotify/car-thing/?x=1"), "spotify/car-thing");
  assert.equal(parseDeviceRef("https://opendevicedb.org/api/devices/spotify/car-thing.json"), "spotify/car-thing");
  assert.equal(parseDeviceRef("my car thing"), null);
});

test("a report issue parses; empty answers dropped; unusable ones are null", () => {
  const r = parseReportIssue(issue(1))!;
  assert.deepEqual(r, {
    issue: 1, url: "https://github.com/opendevicedb/opendevicedb/issues/1", opened: "2026-10-11",
    id: "spotify/car-thing", method: "usb-bootloader", result: "worked", firmware_before: "8.9.2", installed: "superbird-tool 0.2",
  });
  assert.equal(parseReportIssue(issue(2, body({ result: "_No response_" }))), null);
  assert.equal(parseReportIssue({ ...issue(3), body: "free text", title: "hello" }), null);
  assert.equal(parseReportIssue(issue(4, body(), { pull_request: {} })), null);
  assert.equal(parseReportIssue(issue(5, body(), { state: "closed", state_reason: "not_planned" })), null);
  assert.equal(parseReportIssue(issue(6, body({ result: "partly — works with limitations", notes: "no wifi" })))!.notes, "no wifi");
});

test("route left on 'other' falls back to the method in the title; device falls back to the title", () => {
  assert.equal(parseReportIssue(issue(1, body({ route: "other" })))!.method, "usb-bootloader");
  assert.equal(parseReportIssue({ ...issue(2, body({ route: "other" })), title: "Install report: spotify/car-thing" })!.method, "other");
  assert.equal(parseReportIssue(issue(3, body({ device: "_No response_" })))!.id, "spotify/car-thing");
});

test("grouping by device and method, counts and latest firmware", () => {
  const reports = [
    issue(1), issue(3, body({ result: "failed", fw: "8.9.4" })), issue(2, body({ result: "partly" })),
    issue(4, body({ route: "serial — serial / UART, device opened" })),
    { ...issue(5), title: "Install report: acme/plug (pairing)", body: body({ device: "acme/plug", route: "pairing" }) },
  ].map((i) => parseReportIssue(i)!);
  const g = groupReports(reports);
  assert.deepEqual(g.map((x) => [x.id, x.method, x.worked, x.failed, x.partly, x.total]), [
    ["acme/plug", "pairing", 1, 0, 0, 1],
    ["spotify/car-thing", "serial", 1, 0, 0, 1],
    ["spotify/car-thing", "usb-bootloader", 1, 1, 1, 3],
  ]);
  assert.equal(g[2].latest!.issue, 3);
  assert.equal(g[2].latest!.firmware_before, "8.9.4");
  assert.deepEqual(g[2].reports.map((r) => r.issue), [3, 2, 1]);
  assert.deepEqual(summarizeReports([]), { worked: 0, failed: 0, partly: 0, total: 0 });
});

test("reports attach to a route; same-method routes split by project name", () => {
  const mk = (n: number, project: string) => parseReportIssue(issue(n, body({ device: "a/b", route: "web-serial", project }), { title: "x" }))!;
  const reports = [mk(1, "ESPHome 2026.9"), mk(2, "Tasmota 14.2"), mk(3, "something")];
  const esphome = route({ project: "ESPHome", method: "web-serial" }), tasmota = route({ project: "Tasmota", method: "web-serial" });
  assert.deepEqual(reportsForRoute(reports, "a/b", esphome, [esphome, tasmota]).map((r) => r.issue), [1]);
  assert.deepEqual(reportsForRoute(reports, "a/b", tasmota, [esphome, tasmota]).map((r) => r.issue), [2]);
  assert.equal(reportsForRoute(reports, "a/b", esphome).length, 3);
  assert.equal(reportsForRoute(reports, "c/d", esphome).length, 0);
});

test("routes sort easiest first; plain-words titles; mains + opened is dangerous", () => {
  const routes = [
    route({ project: "Tasmota", method: "serial", difficulty: "hard", opens_device: true }),
    route({ project: "Tasmota", method: "ota-exploit", difficulty: "medium" }),
    route({ project: "Zigbee2MQTT", method: "pairing", difficulty: "easy", brick_risk: "none" }),
    route({ project: "ESPHome", method: "web-serial", difficulty: "medium", opens_device: true }),
  ];
  assert.deepEqual(sortInstallRoutes(routes).map((r) => r.method), ["pairing", "ota-exploit", "web-serial", "serial"]);
  assert.equal(routeTitle(routes[2]), "Pair with Zigbee2MQTT");
  assert.equal(routeTitle({ project: "tuya-cloudcutter", method: "ota-exploit" }), "Flash over the air with tuya-cloudcutter");
  assert.equal(isDangerousRoute({ mains_powered: true, opens_device: true }), true);
  assert.equal(isDangerousRoute({ mains_powered: true }), false);
});

test("pre-filled report link and reports search link", () => {
  const u = new URL(installReportUrl({ id: "spotify/car-thing", route: { method: "usb-bootloader", project: "superbird-tool" } }));
  assert.equal(u.pathname, "/opendevicedb/opendevicedb/issues/new");
  assert.equal(u.searchParams.get("template"), "install-report.yml");
  assert.equal(u.searchParams.get("title"), "Install report: spotify/car-thing (usb-bootloader)");
  assert.equal(u.searchParams.get("device"), "spotify/car-thing");
  assert.equal(u.searchParams.get("project"), "superbird-tool");
  assert.match(u.searchParams.get("route")!, /^usb-bootloader — /);
  // what the prefilled title yields when the form is submitted untouched apart from the result
  const back = parseReportIssue({ ...issue(9, body({ route: "other" })), title: u.searchParams.get("title")! })!;
  assert.equal(back.method, "usb-bootloader");
  assert.match(reportsSearchUrl("a/b"), /label%3Ainstall-report\+%22a%2Fb%22/);
});

test("fetchReports pages through the GitHub API, open and closed", async () => {
  const pages = [Array.from({ length: 100 }, (_, n) => issue(n + 1)), [issue(200, body({ result: "nope" })), issue(201)]];
  const seen: string[] = [];
  const fake = (async (url: string) => { seen.push(url); const p = pages[seen.length - 1]; return { ok: true, status: 200, json: async () => p }; }) as any;
  const all = await fetchReports({ fetch: fake, token: "t" });
  assert.equal(all.length, 101);
  assert.match(seen[1], /labels=install-report&state=all&per_page=100&page=2/);
  await assert.rejects(fetchReports({ fetch: (async () => ({ ok: false, status: 500 })) as any }), /HTTP 500/);
});
