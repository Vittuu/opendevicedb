// thingino supported cameras: one build profile per camera hardware variant in
// github.com/themactep/thingino-firmware/configs/cameras/<profile>/<profile>_defconfig,
// whose first line is "# NAME: <Brand> <Model> (<SoC>, <sensor>, <wifi>…)".
// Variants of the same camera are merged into one record.
import { makeId, today, type DeviceRecord, type InstallRoute } from "@opendevicedb/core";
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

// ---------- install route (SPEC R1) ----------

export const THINGINO_GUIDE = "https://github.com/themactep/thingino-firmware/wiki/Installation:-General";

/**
 * The camera profiles say nothing about how a given camera is flashed, and the per-camera wiki
 * pages are not named after the profiles, so every camera gets the one route that works on
 * all of them: the project's general installation page, programming the SPI flash chip with
 * a CH341A (in place with a clip, or off-board), listed there as the most reliable method.
 * Easier ways (SD card with a magic file name, USB cloner, serial) depend on the camera and
 * are mentioned in the notes. With a backup of the stock flash taken first, the programmer
 * also writes it back.
 */
export const THINGINO_INSTALL: InstallRoute = {
  project: "thingino",
  method: "spi-programmer",
  guide: THINGINO_GUIDE,
  difficulty: "hard",
  tools: ["SPI flash programmer (CH341A)", "SOIC-8 test clip"],
  opens_device: true,
  reversible: "yes",
  notes: "Back up the stock flash first. Some cameras can instead be flashed without opening them, from an SD card or over USB with the Ingenic cloner, or through a serial console: see the guide and the camera's wiki page, if it has one.",
};

/** Cameras that are part of a mains-wired light (floodlight, bulb, lamp socket). */
const MAINS = /\b(floodlight|flood light|bulb|lamp)\b/i;

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
    // Safety (SPEC R1): no guided route for cameras built into mains-wired lights.
    install: MAINS.test(p.model) ? [] : [{ ...THINGINO_INSTALL, tools: [...THINGINO_INSTALL.tools!] }],
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
