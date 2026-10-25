// Valetudo supported robots (https://valetudo.cloud/pages/general/supported-robots/), from the one
// docs page github.com/Hypfer/Valetudo/docs/pages/general/supported-robots.md, which the project
// calls exhaustive: "## <Brand>" sections, one "### <Robot>" per supported model with a
// "sold as" list (marketing names and model codes), the OEM ("made by Dreame"), the Valetudo
// binary/secure-boot details and rooting instruction links.
// Valetudo is not a firmware: after rooting, it runs on the robot's stock OS and replaces the
// vendor cloud and app with local control (web UI, REST, MQTT/Home Assistant). So the status is
// controllable and the project kind is integration.
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
import { clean, deviceFirmwareFreedom, githubRaw, type Source } from "../lib.ts";

const REPO = "Hypfer/Valetudo", BRANCH = "master";
const PAGE = "docs/pages/general/supported-robots.md";
const SITE = "https://valetudo.cloud";
const PAGE_URL = `${SITE}/pages/general/supported-robots/`;

export interface Robot {
  brand: string; // "## " section
  heading: string; // "### " heading
  anchor: string;
  soldAs: string[];
  madeBy?: string;
  binary?: string;
  secureBoot?: string;
  rooting: { name: string; url: string }[];
}

/** GitHub-style heading anchor ("Xiaomi Vacuum-Mop 2 Ultra" → "xiaomi-vacuum-mop-2-ultra"). */
export const anchorOf = (heading: string) =>
  clean(heading).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");

/** Strip markdown/HTML from a line of text. */
const text = (s: string) => clean(s.replace(/<[^>]+>/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`\\]/g, ""));

export function parseSupportedRobots(md: string): Robot[] {
  const robots: Robot[] = [];
  const seen = new Map<string, number>(); // duplicate anchors get -1, -2… like the site
  let brand = "", maker = "", cur: Robot | null = null, mode: "" | "sold" | "rooting" = "", intro = false;
  for (const raw of md.replace(/^---[\s\S]*?\n---\n/, "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (h) {
      const title = text(h[2]);
      let a = anchorOf(title);
      const n = seen.get(a) ?? 0;
      seen.set(a, n + 1);
      if (n) a = `${a}-${n}`;
      mode = "";
      intro = h[1].length === 3;
      if (h[1].length === 2) { brand = title; maker = ""; cur = null; }
      else if (h[1].length === 3 && brand) {
        cur = { brand, heading: title, anchor: a, soldAs: [], rooting: [], ...(maker ? { madeBy: maker } : {}) };
        robots.push(cur);
      } else if (h[1].length === 4 && cur && /rooting/i.test(title)) mode = "rooting";
      continue;
    }
    if (!cur) {
      const of = brand && line.match(/\bis a brand of ([A-Z][\w-]*)/); // "Eureka is a brand of Midea."
      if (of) maker = of[1];
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (mode === "sold") {
      if (bullet) {
        const t = clean(text(bullet[1]).replace(/\s*\(not\b[^)]*\)/i, "")); // "(not the ijai one!!)"
        if (t) cur.soldAs.push(t);
        continue;
      }
      if (line.trim()) mode = "";
    }
    if (mode === "rooting" && bullet) {
      const l = bullet[1].match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      if (l) {
        try { cur.rooting.push({ name: text(l[1]), url: new URL(l[2], PAGE_URL).href }); } catch { /* not a URL */ }
      }
      continue;
    }
    if (/\bsold (?:as|under)\b/i.test(line)) mode = "sold";
    const made = line.match(/\bmade by ([A-Z0-9][\w-]*)|\bactually an? (3irobotix|[A-Z][\w-]*)\b/);
    if (made && intro && !cur.madeBy) cur.madeBy = made[1] ?? made[2];
    const bin = line.match(/\*\*Valetudo Binary\*\*:\s*`([^`]+)`/);
    if (bin) cur.binary = bin[1];
    const sb = line.match(/\*\*Secure Boot\*\*:\s*`([^`]+)`/);
    if (sb) cur.secureBoot = sb[1];
  }
  return robots;
}

/** Brand spellings as printed on the robots. */
const BRANDS: Record<string, string> = { mova: "MOVA", ikohs: "IKOHS" };
export const robotBrand = (section: string) => BRANDS[section.toLowerCase()] ?? section;

/** Marketing model codes in a "sold as" entry: "Mijia STYJ02YM" → ["STYJ02YM"]. */
export const modelCodes = (name: string) =>
  name.split(/[\s,()]+/).filter((t) => /^(?=.*\d)(?=.*[A-Z])[A-Z0-9][A-Z0-9-]{5,}$/.test(t));

// ---------- install routes (SPEC R1) ----------

type Way = Omit<InstallRoute, "project" | "guide">;
const UART = "USB-serial adapter (3.3 V)";
/**
 * Rooting method pages of the Valetudo docs (and Hypfer's CRL-200S repository) → route.
 * Facts are the ones those pages state: requirements, disassembly, brick warnings.
 * Links elsewhere (third-party gists) get no route. Rooting keeps the vendor's OS, and no
 * page documents a way back, so reversibility is not given.
 */
export const ROOTING_WAYS: [RegExp, Way][] = [
  [/\/installation\/roborock\/#ota$/, { method: "ota-exploit", difficulty: "medium", tools: ["Laptop with Wi-Fi"], opens_device: false, notes: "Over the robot's own Wi-Fi access point; no disassembly, no cables." }],
  [/\/installation\/roborock\/#fel-rooting$/, { method: "usb-bootloader", difficulty: "hard", tools: ["Laptop running Linux natively with sunxi-tools", "Micro USB cable"], opens_device: true, notes: "Full disassembly to reach a test point under the mainboard, breaking the warranty seals; no soldering." }],
  [/\/installation\/roborock\/#(vinda|init-override)$/, { method: "serial", difficulty: "hard", tools: [UART, "Soldering iron"], opens_device: true, notes: "Full disassembly and soldering wires to test points; voids the warranty." }],
  [/\/installation\/dreame\/#uart-shell$/, { method: "serial", difficulty: "hard", tools: [UART, "Dreame Breakout PCB", "USB stick"], notes: "Through the robot's debug connector with the Dreame Breakout PCB; on robots with secure boot it must be defeated first or the robot is bricked." }],
  [/\/installation\/dreame\/#fastboot$/, { method: "usb-bootloader", difficulty: "hard", tools: ["Dreame Breakout PCB", "Micro USB cable", "Laptop running Debian 13 natively"], brick_risk: "high", notes: "Through the robot's debug connector with the Dreame Breakout PCB; Valetudo warns this method can permanently brick the robot." }],
  [/\/installation\/midea\/#adb$/, { method: "other", difficulty: "hard", tools: ["Plastic pry tool", "Micro USB cable", "Computer with adb"], opens_device: true, brick_risk: "high", notes: "ADB over a micro USB port reached by prying the robot open; Valetudo warns this method can permanently brick the robot." }],
  [/^https:\/\/github\.com\/Hypfer\/valetudo-crl200s-root\/?$/, { method: "other", difficulty: "medium", tools: ["Micro USB data cable", "Computer with adb"], brick_risk: "high", notes: "ADB over the robot's micro USB port; the guide lists models that rooting bricks and warns of unfixable bricks." }],
];

/** Routes from the robot's rooting links; the link label's "(…)" (e.g. "before 2020-03") is a constraint. */
export function valetudoInstall(r: Robot): InstallRoute[] {
  const out: InstallRoute[] = [];
  for (const l of r.rooting) {
    const way = ROOTING_WAYS.find(([re]) => re.test(l.url))?.[1];
    if (!way) continue;
    const cond = l.name.match(/\(([^)]+)\)/)?.[1];
    out.push({
      project: "Valetudo", method: way.method, guide: l.url, ...way,
      ...(way.tools ? { tools: [...way.tools] } : {}),
      ...(cond ? { firmware_constraints: `Valetudo qualifies this method: "${clean(cond)}".` } : {}),
    });
  }
  return out;
}

const VALETUDO_NOTE = "Valetudo replaces the vendor cloud on the rooted stock system";

export function fromRobot(r: Robot, date = today()): DeviceRecord | null {
  const vendor = robotBrand(r.brand);
  const lower = r.heading.toLowerCase();
  const model = lower.startsWith(vendor.toLowerCase() + " ") ? clean(r.heading.slice(vendor.length)) : r.heading;
  if (!vendor || !model) return null;
  const full = `${vendor} ${model}`.toLowerCase();
  const aliases = r.soldAs.filter((s) => s.toLowerCase() !== full && s.toLowerCase() !== model.toLowerCase());
  const facts = [
    r.madeBy && r.madeBy.toLowerCase() !== vendor.toLowerCase() ? `Made by ${r.madeBy}.` : "",
    r.binary ? `Valetudo binary: ${r.binary}.` : "",
    r.secureBoot ? `Secure boot: ${r.secureBoot}.` : "",
  ].filter(Boolean);
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases,
    category: "vacuum-robot",
    identifiers: { sku: r.soldAs.flatMap(modelCodes) },
    status: "controllable",
    summary: facts.length ? `Rooted, then runs Valetudo for cloud-free local control. ${facts.join(" ")}` : undefined,
    projects: [
      { name: "Valetudo", url: `${PAGE_URL}#${r.anchor}`, kind: "integration", license: "Apache-2.0", freedom: deviceFirmwareFreedom(VALETUDO_NOTE) },
      ...r.rooting.map((l) => ({ name: `Valetudo rooting instructions (${l.name})`, url: l.url, kind: "other" as const })),
    ],
    install: valetudoInstall(r),
    provenance: { sources: ["valetudo"] },
    updated: date,
  };
}

const source: Source = {
  source: "valetudo",
  name: "Valetudo",
  url: SITE + "/",
  license: "Apache-2.0",
  async fetch() {
    const robots = parseSupportedRobots(await githubRaw(REPO, BRANCH, PAGE));
    const out = robots.map((r) => fromRobot(r)).filter((r): r is DeviceRecord => !!r);
    console.error(`valetudo: ${robots.length} robots, ${robots.length - out.length} without vendor/model`);
    return out;
  },
};
export default source;
