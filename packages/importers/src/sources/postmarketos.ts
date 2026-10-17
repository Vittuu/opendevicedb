// Nura (formerly postmarketOS), a Linux distribution for phones, tablets and other
// devices. Its device ports live in the pmaports repository on gitlab.postmarketos.org:
// device/<category>/device-<vendor>-<codename>/deviceinfo, a shell-style file with
// deviceinfo_name, deviceinfo_manufacturer, deviceinfo_codename, deviceinfo_chassis
// (handset/tablet/laptop/convertible/desktop/embedded/watch/vm/…) and deviceinfo_dtb.
// Directories are listed with the GitLab REST tree API, deviceinfo files are read in
// batches through the GitLab GraphQL `blobs` query, and wiki pages
// ("<name> (<codename>)") are confirmed in batches through the MediaWiki API, so a full
// run is a few dozen requests.
//
// Status by pmaports category (docs/packaging/device-categorization.md):
//   main, community → open-firmware: maintained, close-to-mainline kernel, official images;
//   testing         → open-firmware: close-to-mainline kernel that builds and boots, so a
//                     free OS exists, though the working feature set varies;
//   downstream      → partial-protocol: boots only on the vendor's kernel fork, i.e. the
//                     hardware is not yet supported by free drivers;
//   archived        → partial-protocol: an earlier port exists in the tree but is
//                     unmaintained, unbuilt and may no longer boot.
// Generic ports (QEMU, "Qualcomm msm8916-based device", "generic x86_64 system") are skipped.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, fetchJson, firstMatch, mapLimit, type Source } from "../lib.ts";
import { normModel, normVendor, VENDORS } from "./lineageos.ts";

const GITLAB = "https://gitlab.postmarketos.org", PROJECT = "postmarketOS/pmaports", BRANCH = "main";
const WIKI = "https://wiki.nura.eco";
export const PMOS_CATEGORIES = ["main", "community", "testing", "downstream", "archived"] as const;
type PmCategory = (typeof PMOS_CATEGORIES)[number];

export const PMOS_STATUS: Record<PmCategory, "open-firmware" | "partial-protocol"> = {
  main: "open-firmware",
  community: "open-firmware",
  testing: "open-firmware",
  downstream: "partial-protocol",
  archived: "partial-protocol",
};

const key = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/** deviceinfo_* = "value" pairs of a deviceinfo file (shell syntax, double quotes). */
export function parseDeviceinfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^\s*deviceinfo_([a-z0-9_]+)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S*))/gm)) {
    out[m[1]] = (m[2] ?? m[3] ?? m[4] ?? "").replace(/\\(.)/g, "$1");
  }
  return out;
}

/** Ports that are not one device model: VMs, generic SoC/arch images, the distribution itself. */
export function isGeneric(info: Record<string, string>): boolean {
  const chassis = clean(info.chassis).toLowerCase();
  if (chassis === "vm" || chassis === "container") return true;
  if (/^(generic|qemu|postmarketos|nura)$/i.test(clean(info.manufacturer))) return true;
  return /\bgeneric\b|-based device\b|\b(?:device|system)$/i.test(clean(info.name));
}

/** `${chassis} ${name}` → category; ordered, first match wins. */
export const PMOS_CATEGORY_TABLE: [RegExp, string][] = [
  [/kobo|kindle(?! fire)|tolino|pocketbook|nook|e-?reader|pinenote|remarkable|boox/i, "e-reader"],
  [/ouya|game console|powkiddy|anbernic|retroid|\bodin\b|ayaneo|steam deck/i, "game-console"],
  [/\bglass\b|moverio|lynx r1|headset/i, "wearable"],
  [/echo dot|speaker/i, "audio"],
  [/wyse|thin client/i, "desktop"],
  [/tv ?box|tv stick|fire tv|android tv|chromecast|set-?top|\bb860/i, "media-player"],
  [/\bwrt\d|router|linksys|tp-?link/i, "router"],
  [/^handset/i, "phone"],
  [/^tablet/i, "tablet"],
  [/^watch/i, "wearable"],
  [/^(laptop|convertible)|chromebook/i, "laptop"],
  [/odroid|orange ?pi|raspberry|banana ?pi|rock ?pi|rockpro|radxa|khadas|libre computer|dragonboard|cubox|\bcm\d|board/i, "single-board"],
  [/^desktop/i, "desktop"],
  [/^embedded .*(mycloud|\bnas\b|dongle)/i, "other"],
  [/^embedded/i, "single-board"],
  [/phone/i, "phone"],
  [/tab|pad/i, "tablet"],
];
export const pmosCategory = (chassis: unknown, name: unknown) =>
  firstMatch(PMOS_CATEGORY_TABLE, `${clean(chassis).toLowerCase()} ${clean(name)}`, "other");

/** SoC part numbers from deviceinfo_dtb ("qcom/sdm845-oneplus-enchilada" → "SDM845"). */
export function socFromDtb(dtb: string): string[] {
  const out: string[] = [];
  for (const d of clean(dtb).split(" ")) {
    const parts = d.split("/").pop()!.split("-");
    const [a, b] = parts;
    if (/^(?:msm|apq|sdm|sm|sc|sda|qcs|qcm|mt|rk|exynos|tegra|omap|imx)\d+[a-z0-9]*$/i.test(a)) out.push(a.toUpperCase().replace(/^EXYNOS/, "Exynos").replace(/^TEGRA/, "Tegra"));
    else if (/^sun\d+i$/.test(a) && /^[ahr]\d+$/i.test(b ?? "")) out.push(`Allwinner ${b.toUpperCase()}`);
  }
  return out;
}

export const pmaportsUrl = (category: string, dir: string) => `${GITLAB}/${PROJECT}/-/tree/${BRANCH}/device/${category}/${dir}`;
export const wikiTitle = (info: Record<string, string>) => `${clean(info.name)} (${clean(info.codename)})`;
export const wikiUrl = (title: string) => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/")}`;

/** Vendor and model: the brand leading the marketing name wins over the ODM ("Google Nexus 5X" made by LG). */
export function splitPmosName(manufacturer: string, name: string): { vendor: string; model: string } {
  let vendor = normVendor(manufacturer);
  let model = normModel(vendor, name);
  for (const n of [2, 1]) {
    const words = model.split(" ");
    if (words.length <= n) continue;
    const brand = VENDORS[key(words.slice(0, n).join(" "))];
    if (brand && key(brand) !== key(vendor)) {
      vendor = brand;
      model = normModel(brand, model);
      break;
    }
  }
  return { vendor, model };
}

/** One deviceinfo → record; null for generic ports or files without name/manufacturer. */
export function fromDeviceinfo(category: PmCategory, dir: string, text: string, wiki?: string | null, date = today()): DeviceRecord | null {
  const info = parseDeviceinfo(text);
  const name = clean(info.name), manufacturer = clean(info.manufacturer);
  const codename = clean(info.codename) || dir.replace(/^device-/, "");
  if (!name || !manufacturer || isGeneric(info)) return null;
  const { vendor, model } = splitPmosName(manufacturer, name);
  if (!vendor || !model) return null;
  const note = category === "archived" ? "archived: unmaintained, may not boot" : category;
  const projects: NonNullable<DeviceRecord["projects"]> = [
    { name: `Nura/postmarketOS (${note}, ${codename})`, url: pmaportsUrl(category, dir), kind: "firmware", license: "GPL-3.0" },
  ];
  if (wiki) projects.push({ name: `Nura/postmarketOS wiki: ${wiki}`, url: wikiUrl(wiki), kind: "other", license: "CC-BY-SA-4.0" });
  const full = `${vendor} ${model}`;
  return {
    id: makeId(vendor, model),
    vendor,
    model,
    aliases: [key(name) !== key(full) && key(name) !== key(model) ? name : "", codename],
    category: pmosCategory(info.chassis, name),
    identifiers: { chips: socFromDtb(Object.entries(info).filter(([k]) => /^dtb/.test(k)).map(([, v]) => v).join(" ")) },
    status: PMOS_STATUS[category],
    projects,
    provenance: { sources: ["postmarketos"] },
    updated: date,
  };
}

// ---------- network ----------

async function listDeviceDirs(category: string): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; ; page++) {
    const url = `${GITLAB}/api/v4/projects/${encodeURIComponent(PROJECT)}/repository/tree?ref=${BRANCH}&path=device/${category}&per_page=100&page=${page}`;
    const items: { name: string; type: string }[] = await fetchJson(url).catch((e) => {
      if (String(e).includes("404")) return []; // category directory absent
      throw e;
    });
    out.push(...items.filter((x) => x.type === "tree" && x.name.startsWith("device-")).map((x) => x.name));
    if (items.length < 100) return out;
  }
}

/** Raw text of many repository files, 50 per GraphQL request; missing files are absent from the map. */
async function readBlobs(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const batches = Array.from({ length: Math.ceil(paths.length / 50) }, (_, i) => paths.slice(i * 50, i * 50 + 50));
  await mapLimit(batches, 2, async (batch) => {
    const body = JSON.stringify({
      query: `query($p:[String!]!){project(fullPath:"${PROJECT}"){repository{blobs(ref:"${BRANCH}",paths:$p){nodes{path rawTextBlob}}}}}`,
      variables: { p: batch },
    });
    const res = await fetchJsonPost(`${GITLAB}/api/graphql`, body);
    if (res.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(res.errors[0])}`);
    for (const n of res.data?.project?.repository?.blobs?.nodes ?? []) if (n.rawTextBlob != null) out.set(n.path, n.rawTextBlob);
  });
  return out;
}

async function fetchJsonPost(url: string, body: string, retries = 5): Promise<any> {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    try {
      const res = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", "user-agent": "opendevicedb-importer/0.1 (+https://github.com/opendevicedb)" } });
      if (res.ok) return await res.json();
      last = new Error(`${res.status} ${res.statusText} for ${url}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/** Which of these wiki titles exist (following redirects); 50 titles per MediaWiki API request. */
async function existingWikiPages(titles: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>(); // requested title → final title
  const batches = Array.from({ length: Math.ceil(titles.length / 50) }, (_, i) => titles.slice(i * 50, i * 50 + 50));
  await mapLimit(batches, 2, async (batch) => {
    const q = await fetchJson(`${WIKI}/api.php?action=query&format=json&redirects=1&titles=${encodeURIComponent(batch.join("|"))}`);
    const step = (list: { from: string; to: string }[] | undefined) => new Map((list ?? []).map((x) => [x.from, x.to]));
    const norm = step(q.query?.normalized), redir = step(q.query?.redirects);
    const exists = new Set(Object.values(q.query?.pages ?? {}).filter((p: any) => !("missing" in p) && !("invalid" in p)).map((p: any) => p.title as string));
    for (const t of batch) {
      const n = norm.get(t) ?? t;
      const final = redir.get(n) ?? n;
      if (exists.has(final)) found.set(t, final);
    }
  });
  return found;
}

const source: Source = {
  source: "postmarketos",
  name: "Nura (formerly postmarketOS) pmaports",
  url: "https://nura.eco/",
  license: "GPL-3.0",
  async fetch() {
    const dirs = (await mapLimit([...PMOS_CATEGORIES], 2, async (c) => (await listDeviceDirs(c)).map((d) => ({ category: c, dir: d })))).flat();
    const path = (x: { category: string; dir: string }) => `device/${x.category}/${x.dir}/deviceinfo`;
    const blobs = await readBlobs(dirs.map(path));
    const withInfo = dirs.filter((x) => blobs.has(path(x)));
    const titles = withInfo.map((x) => wikiTitle(parseDeviceinfo(blobs.get(path(x))!))).filter((t) => !t.startsWith(" ("));
    const pages = await existingWikiPages([...new Set(titles)]).catch((e) => {
      console.error(`postmarketos: wiki check failed, records keep only the pmaports link: ${e}`);
      return new Map<string, string>();
    });
    const out = withInfo.map((x) => {
      const text = blobs.get(path(x))!;
      return fromDeviceinfo(x.category, x.dir, text, pages.get(wikiTitle(parseDeviceinfo(text))) ?? null);
    });
    const ok = out.filter((r): r is DeviceRecord => !!r);
    const byCat = Object.fromEntries(PMOS_CATEGORIES.map((c) => [c, withInfo.filter((x) => x.category === c).length]));
    console.error(`postmarketos: ${dirs.length} device dirs, ${withInfo.length} with deviceinfo ${JSON.stringify(byCat)}, ${withInfo.length - ok.length} generic/unusable skipped, ${pages.size} wiki pages`);
    return ok;
  },
};
export default source;
