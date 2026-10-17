// thingino supported cameras: one build profile per camera hardware variant in
// github.com/themactep/thingino-firmware/configs/cameras/<profile>/<profile>_defconfig,
// whose first line is "# NAME: <Brand> <Model> (<SoC>, <sensor>, <wifi>…)".
// Variants of the same camera are merged into one record.
import { makeId, today, type DeviceRecord } from "@opendevicedb/core";
import { clean, githubFiles, githubRaw, mapLimit, type Source } from "../lib.ts";

const REPO = "themactep/thingino-firmware", BRANCH = "master";
const DEFCONFIG = /^configs\/cameras\/([^/]+)\/\1_defconfig$/;

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Split "TP-Link Tapo C200 (T23N, SC2336P, RTL8188FTV)" using the profile name
 * "tplink_tapo_c200_…" whose first token is the brand: the vendor is the shortest
 * leading run of words that spells that token, else the first word.
 */
export function parseCameraName(profile: string, name: string): { vendor: string; model: string; hardware: string[] } | null {
  const m = clean(name).match(/^(.*?)\s*(?:\(([^)]*)\))?$/);
  if (!m || !m[1]) return null;
  const words = m[1].split(" ");
  const hardware = (m[2] ?? "").split(",").map(clean).filter((h) => h && h.toUpperCase() !== "ETH");
  const brand = profile.split("_")[0];
  if (words.length === 1) return { vendor: "Generic", model: words[0], hardware }; // unbranded board
  let n = 1;
  for (let i = 1; i < words.length; i++) if (compact(words.slice(0, i).join("")) === brand) { n = i; break; }
  const vendor = words.slice(0, n).join(" ");
  const model = words.slice(n).join(" ");
  return { vendor, model, hardware };
}

export function fromDefconfig(path: string, text: string, date = today()): DeviceRecord | null {
  const profile = path.match(DEFCONFIG)?.[1];
  const name = text.match(/^# NAME:\s*(.+)$/m)?.[1];
  if (!profile || !name) return null;
  const p = parseCameraName(profile, name);
  if (!p) return null;
  return {
    id: makeId(p.vendor, p.model),
    vendor: p.vendor,
    model: p.model,
    category: "ip-camera",
    identifiers: { chips: p.hardware },
    status: "open-firmware",
    projects: [{ name: `thingino (${p.hardware.join(", ") || profile})`, url: `https://github.com/${REPO}/tree/${BRANCH}/configs/cameras/${profile}`, kind: "firmware", license: "MIT" }],
    provenance: { sources: ["thingino"] },
    updated: date,
  };
}

const source: Source = {
  source: "thingino",
  name: "thingino",
  url: "https://thingino.com/",
  license: "MIT",
  async fetch() {
    const files = (await githubFiles(REPO, BRANCH)).filter((p) => DEFCONFIG.test(p));
    const out = await mapLimit(files, 16, async (p) => fromDefconfig(p, await githubRaw(REPO, BRANCH, p)));
    const ok = out.filter((r): r is DeviceRecord => !!r);
    console.error(`thingino: ${files.length} camera profiles, ${files.length - ok.length} without a NAME line`);
    return ok;
  },
};
export default source;
