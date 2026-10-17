// Install routes as shown to people, and install reports (SPEC R1): GitHub issues opened
// from .github/ISSUE_TEMPLATE/install-report.yml, label "install-report". One issue = one
// person's attempt at one route. Reports are shown next to the route; they never change a
// record (a maintainer may turn one into a `manual` verification entry by hand).
// Browser-safe: parsing, grouping and summaries are pure; fetchReports only needs fetch().
import { parseIssueForm, ODB_REPO, ODB_REPO_URL } from "./wanted.ts";
import type { InstallMethod, InstallRoute } from "./browser.ts";

export const REPORT_LABEL = "install-report";
export const REPORT_TEMPLATE = "install-report.yml";

export const INSTALL_METHODS: InstallMethod[] = [
  "host-software", "pairing", "web-serial", "ota-exploit", "vendor-upload",
  "usb-bootloader", "sd-card", "serial", "spi-programmer", "other",
];

/** Short plain-words name of a method, as used in the report form's dropdown. */
export const INSTALL_METHOD_LABEL: Record<InstallMethod, string> = {
  "host-software": "software on a computer or phone, nothing flashed",
  pairing: "pair with a hub, nothing flashed",
  "web-serial": "browser installer over USB",
  "ota-exploit": "over the air, device stays closed",
  "vendor-upload": "upload in the stock web interface",
  "usb-bootloader": "USB bootloader (fastboot, DFU, burn mode)",
  "sd-card": "firmware file on an SD card",
  serial: "serial / UART, device opened",
  "spi-programmer": "flash chip programmer",
  other: "other",
};

/** What a route does, in plain words: "Pair with Zigbee2MQTT", "Flash over serial…". */
export function routeTitle(r: Pick<InstallRoute, "method" | "project">): string {
  const p = r.project;
  switch (r.method) {
    case "host-software": return `Use ${p} (nothing is flashed)`;
    case "pairing": return `Pair with ${p}`;
    case "web-serial": return `Install ${p} from your browser over USB`;
    case "ota-exploit": return `Flash over the air with ${p}`;
    case "vendor-upload": return `Upload ${p} in the stock web interface`;
    case "usb-bootloader": return `Install ${p} over USB (bootloader unlock)`;
    case "sd-card": return `Install ${p} from an SD card`;
    case "serial": return `Flash ${p} over serial (device must be opened)`;
    case "spi-programmer": return `Flash ${p} with an SPI programmer (device must be opened)`;
    default: return `Install ${p}`;
  }
}

/** Mains-powered and must be opened: a warning and a plain link, never a guided flow. */
export const isDangerousRoute = (r: Pick<InstallRoute, "mains_powered" | "opens_device">) => !!(r.mains_powered && r.opens_device);

const LEVEL = { none: 0, low: 1, easy: 1, medium: 2, high: 3, hard: 3 } as Record<string, number>;
/** Easiest first: difficulty, then device stays closed, then brick risk; stable otherwise. */
export function sortInstallRoutes<T extends InstallRoute>(routes: T[]): T[] {
  return routes
    .map((r, i) => ({ r, i }))
    .sort((a, b) =>
      (LEVEL[a.r.difficulty] ?? 9) - (LEVEL[b.r.difficulty] ?? 9) ||
      Number(!!a.r.opens_device) - Number(!!b.r.opens_device) ||
      (LEVEL[a.r.brick_risk ?? "medium"] ?? 2) - (LEVEL[b.r.brick_risk ?? "medium"] ?? 2) ||
      a.i - b.i)
    .map((x) => x.r);
}

// ---------- reports ----------

export type ReportResult = "worked" | "failed" | "partly";

/** One install report issue. */
export interface InstallReport {
  issue: number;
  url: string;
  opened: string;
  id: string;
  method: InstallMethod;
  result: ReportResult;
  /** Firmware version on the device before the install. */
  firmware_before?: string;
  /** Project and version installed, free text ("Tasmota 14.2.0"). */
  installed?: string;
  notes?: string;
}

export interface ReportSummary {
  worked: number;
  failed: number;
  partly: number;
  total: number;
  latest?: Pick<InstallReport, "issue" | "url" | "opened" | "result" | "firmware_before" | "installed">;
}

/** Reports for one device and one method. Published as /api/install-reports.json. */
export interface ReportGroup extends ReportSummary {
  id: string;
  method: InstallMethod;
  reports: InstallReport[];
}

interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  created_at: string;
  state?: string;
  state_reason?: string | null;
  pull_request?: unknown;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;

/** "spotify/car-thing", or a device page / JSON URL → the device id; null when unusable. */
export function parseDeviceRef(text: string): string | null {
  const s = (text ?? "").split("\n")[0].trim().toLowerCase().replace(/[?#].*$/, "");
  const m = s.match(/devices\/([a-z0-9-]+)\/([a-z0-9-]+?)(?:\.json)?\/?$/) ?? s.match(/^([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
  const id = m ? `${m[1]}/${m[2]}` : "";
  return ID.test(id) ? id : null;
}

/** Dropdown answer "web-serial — browser installer…" → "web-serial". */
function parseMethod(text: string): InstallMethod | undefined {
  const w = (text ?? "").trim().toLowerCase().split(/[\s—–(:]+/)[0];
  return (INSTALL_METHODS as string[]).includes(w) ? w as InstallMethod : undefined;
}

function parseResult(text: string): ReportResult | undefined {
  const w = (text ?? "").trim().toLowerCase().split(/[\s—–(:,]+/)[0];
  return w === "worked" || w === "failed" || w === "partly" ? w : undefined;
}

const TITLE = /install report:\s*(\S+)(?:\s*\(([a-z-]+)\))?/i;

/** A report issue → InstallReport, or null when the device or the result cannot be read. */
export function parseReportIssue(issue: GitHubIssue): InstallReport | null {
  if (issue.pull_request || issue.state_reason === "not_planned") return null;
  const f = parseIssueForm(issue.body ?? "");
  const t = (issue.title ?? "").match(TITLE);
  const id = parseDeviceRef(f["device"] ?? "") ?? (t ? parseDeviceRef(t[1]) : null);
  const result = parseResult(f["result"] ?? "");
  if (!id || !result) return null;
  // The dropdown wins; "other" or nothing falls back to the method in the (prefilled) title.
  const picked = parseMethod(f["install route"] ?? "");
  const method = picked && picked !== "other" ? picked : parseMethod(t?.[2] ?? "") ?? picked ?? "other";
  const line = (k: string) => (f[k] ?? "").split("\n")[0].trim();
  const firmware = line("firmware version before"), installed = line("project and version installed"), notes = (f["notes"] ?? "").trim();
  return {
    issue: issue.number,
    url: issue.html_url,
    opened: issue.created_at.slice(0, 10),
    id, method, result,
    ...(firmware ? { firmware_before: firmware } : {}),
    ...(installed ? { installed } : {}),
    ...(notes ? { notes } : {}),
  };
}

const newestFirst = (a: InstallReport, b: InstallReport) => b.opened.localeCompare(a.opened) || b.issue - a.issue;

export function summarizeReports(reports: InstallReport[]): ReportSummary {
  const s: ReportSummary = { worked: 0, failed: 0, partly: 0, total: reports.length };
  for (const r of reports) s[r.result]++;
  const l = [...reports].sort(newestFirst)[0];
  if (l) {
    s.latest = {
      issue: l.issue, url: l.url, opened: l.opened, result: l.result,
      ...(l.firmware_before ? { firmware_before: l.firmware_before } : {}),
      ...(l.installed ? { installed: l.installed } : {}),
    };
  }
  return s;
}

/** Group reports by device id and method, newest report first inside each group. */
export function groupReports(reports: InstallReport[]): ReportGroup[] {
  const by = new Map<string, InstallReport[]>();
  for (const r of reports) {
    const k = `${r.id} ${r.method}`;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  return [...by.values()]
    .map((list) => ({ id: list[0].id, method: list[0].method, ...summarizeReports(list), reports: [...list].sort(newestFirst) }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.method.localeCompare(b.method));
}

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Reports about one route of a device: same id and method. When the device has several
 * routes with that method (ESPHome and Tasmota both over web-serial), a report counts for
 * the route whose project it names; one naming neither is left out (still in the totals).
 */
export function reportsForRoute(reports: InstallReport[], id: string, route: InstallRoute, routes: InstallRoute[] = [route]): InstallReport[] {
  const same = reports.filter((r) => r.id === id && r.method === route.method);
  if (routes.filter((x) => x.method === route.method).length <= 1) return same;
  const p = loose(route.project);
  return same.filter((r) => !!r.installed && loose(r.installed).includes(p));
}

/** The reports of a device on GitHub (issue search). */
export function reportsSearchUrl(id: string, repoUrl = ODB_REPO_URL): string {
  return `${repoUrl}/issues?${new URLSearchParams({ q: `is:issue label:${REPORT_LABEL} "${id}"` })}`;
}

/**
 * Link to a new install report, pre-filled. GitHub fills inputs from the query (field id =
 * parameter); dropdowns may not be, so the route also goes into the title, which the parser
 * reads when the dropdown is left on "other".
 */
export function installReportUrl(q: { id: string; route?: Pick<InstallRoute, "method" | "project"> }, repoUrl = ODB_REPO_URL): string {
  const p = new URLSearchParams({ template: REPORT_TEMPLATE });
  p.set("title", `Install report: ${q.id}${q.route ? ` (${q.route.method})` : ""}`);
  p.set("device", q.id);
  if (q.route) {
    p.set("route", `${q.route.method} — ${INSTALL_METHOD_LABEL[q.route.method] ?? q.route.method}`);
    p.set("project", q.route.project);
  }
  return `${repoUrl}/issues/new?${p}`;
}

/** All install report issues of the repository, open and closed (GitHub REST, paginated). */
export async function fetchReports(opts: { repo?: string; token?: string; fetch?: typeof fetch } = {}): Promise<InstallReport[]> {
  const f = opts.fetch ?? fetch;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "opendevicedb" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const out: InstallReport[] = [];
  for (let page = 1; page <= 50; page++) {
    const url = `https://api.github.com/repos/${opts.repo ?? ODB_REPO}/issues?labels=${REPORT_LABEL}&state=all&per_page=100&page=${page}`;
    const res = await f(url, { headers });
    if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
    const batch: GitHubIssue[] = await res.json();
    for (const i of batch) { const r = parseReportIssue(i); if (r) out.push(r); }
    if (batch.length < 100) break;
  }
  return out;
}
