// Device detection (SPEC R1 "Device detection (v1)"): pure matching of what the browser can
// read from a plugged or nearby device (WebUSB / WebSerial vid:pid, Web Bluetooth name)
// against the static index. Browser-safe; the /detect/ page and tests use it.
import { statusRank, type IndexEntry } from "./browser.ts";

const hex4 = (n: number) => (n & 0xffff).toString(16).padStart(4, "0");

/** USB vendor + product id as the schema stores it: "vvvv:pppp", lowercase hex. */
export function usbId(vendorId: number, productId: number): string {
  return `${hex4(vendorId)}:${hex4(productId)}`;
}

/** "1234:ABCD", "0x1234:0xabcd", "ID 1234:abcd" (lsusb) → "1234:abcd"; null if it is not one. */
export function parseUsbId(s: string): string | null {
  const m = s.trim().match(/(?:^|[^0-9a-f])(?:0x)?([0-9a-f]{4})\s*:\s*(?:0x)?([0-9a-f]{4})(?![0-9a-f])/i);
  return m ? `${m[1]}:${m[2]}`.toLowerCase() : null;
}

/** What a well-known USB id is, when it says little or nothing about the product. */
export interface KnownUsb {
  /** serial-adapter: a USB-serial (UART) bridge; bootloader: a generic boot/flash mode shared by
   *  many products (phones in fastboot, EDL…); chip: a microcontroller's own USB port. */
  kind: "serial-adapter" | "bootloader" | "chip";
  name: string;
}

const adapter = (name: string): KnownUsb => ({ kind: "serial-adapter", name });
const boot = (name: string): KnownUsb => ({ kind: "bootloader", name });
const chip = (name: string): KnownUsb => ({ kind: "chip", name });

/** Common ids that identify an adapter, a chip or a generic mode, not a device model. */
export const KNOWN_USB_IDS: Readonly<Record<string, KnownUsb>> = {
  // USB-serial bridges: they identify the cable or board, not what is wired to it.
  "10c4:ea60": adapter("Silicon Labs CP210x USB-serial adapter"),
  "10c4:ea70": adapter("Silicon Labs CP2105 USB-serial adapter"),
  "10c4:ea71": adapter("Silicon Labs CP2108 USB-serial adapter"),
  "1a86:7523": adapter("WCH CH340 USB-serial adapter"),
  "1a86:7522": adapter("WCH CH340K USB-serial adapter"),
  "1a86:5523": adapter("WCH CH341 USB-serial adapter"),
  "1a86:5512": adapter("WCH CH341A programmer (SPI/I²C mode)"),
  "1a86:55d3": adapter("WCH CH343 USB-serial adapter"),
  "1a86:55d4": adapter("WCH CH9102 USB-serial adapter"),
  "0403:6001": adapter("FTDI FT232R USB-serial adapter"),
  "0403:6010": adapter("FTDI FT2232 USB-serial adapter"),
  "0403:6011": adapter("FTDI FT4232 USB-serial adapter"),
  "0403:6014": adapter("FTDI FT232H USB-serial adapter"),
  "0403:6015": adapter("FTDI FT-X (FT230X/FT231X) USB-serial adapter"),
  "067b:2303": adapter("Prolific PL2303 USB-serial adapter"),
  // Microcontrollers' own USB ports: they identify the chip, not the product built on it.
  "303a:1001": chip("Espressif ESP32 (S3/C3/C6…) built-in USB serial/JTAG"),
  "0483:5740": chip("STMicroelectronics STM32 virtual COM port"),
  "0483:df11": chip("STMicroelectronics STM32 DFU bootloader"),
  "2e8a:0003": chip("Raspberry Pi RP2040/RP2350 boot mode (BOOTSEL)"),
  "1f3a:efe8": chip("Allwinner FEL boot mode"),
  // Generic phone/tablet modes: shared by many models, often across brands.
  "18d1:4ee0": boot("Android fastboot (Google id)"),
  "18d1:d00d": boot("Android fastboot (generic Google id)"),
  "18d1:4ee1": boot("Android MTP (Google id)"),
  "18d1:4ee2": boot("Android MTP + ADB (Google id)"),
  "18d1:4ee7": boot("Android ADB (Google id)"),
  "05c6:9008": boot("Qualcomm emergency download mode (EDL)"),
  "05c6:900e": boot("Qualcomm diagnostic mode"),
  "0e8d:0003": boot("MediaTek boot ROM mode"),
  "0e8d:2000": boot("MediaTek preloader mode"),
  "04e8:685d": boot("Samsung Download mode (Odin)"),
  "04e8:6860": boot("Samsung Galaxy phone/tablet (MTP/ADB, shared by most models)"),
};

export const knownUsb = (id: string): KnownUsb | undefined => KNOWN_USB_IDS[id.toLowerCase()];

const byStatus = (a: IndexEntry, b: IndexEntry) => statusRank(b.status) - statusRank(a.status) || a.id.localeCompare(b.id);

export interface UsbDetection {
  id: string;
  /** Set when the id belongs to an adapter, a chip or a generic mode. */
  known?: KnownUsb;
  /** Every entry listing this vid:pid, furthest status first. */
  matches: IndexEntry[];
  /** True when the id may be shared by several products: show every match, say so. */
  generic: boolean;
}

/** Entries whose identifiers.usb contain this vid:pid (exact, case-insensitive). */
export function matchUsb(entries: IndexEntry[], id: string): UsbDetection {
  const key = parseUsbId(id) ?? id.toLowerCase();
  const matches = entries.filter((e) => (e.identifiers.usb ?? []).some((u) => u.toLowerCase() === key)).sort(byStatus);
  const known = knownUsb(key);
  return { id: key, ...(known ? { known } : {}), matches, generic: !!known || matches.length > 1 };
}

// ---------- Bluetooth names ----------

export type BleStrength = "exact" | "prefix" | "contains";
export interface BleMatch { entry: IndexEntry; strength: BleStrength; /** the known name that matched */ name: string }

const STRENGTH: BleStrength[] = ["exact", "prefix", "contains"];
const normName = (s: string) => s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

/** How an advertised name relates to a known one, or null. Short names only match exactly. */
export function bleStrength(advertised: string, known: string): BleStrength | null {
  const a = normName(advertised), k = normName(known);
  if (!a || !k) return null;
  if (a === k) return "exact";
  // Known names are often prefixes ("AAWireless-", "Amazfit Bip") of names with a serial suffix.
  if ((a.startsWith(k) && k.length >= 3) || (k.startsWith(a) && a.length >= 3)) return "prefix";
  if ((a.includes(k) && k.length >= 4) || (k.includes(a) && a.length >= 4)) return "contains";
  return null;
}

/** Entries whose identifiers.ble_names match an advertised name: exact first, then prefix
 *  (longer known names first), then contains; furthest status first within each. */
export function matchBleName(entries: IndexEntry[], advertised: string, limit = 50): BleMatch[] {
  const out: BleMatch[] = [];
  if (!normName(advertised)) return out;
  for (const entry of entries) {
    let best: BleMatch | null = null;
    for (const name of entry.identifiers.ble_names ?? []) {
      const s = bleStrength(advertised, name);
      if (!s) continue;
      if (!best || STRENGTH.indexOf(s) < STRENGTH.indexOf(best.strength) ||
          (s === best.strength && name.length > best.name.length)) best = { entry, strength: s, name };
    }
    if (best) out.push(best);
  }
  out.sort((x, y) =>
    STRENGTH.indexOf(x.strength) - STRENGTH.indexOf(y.strength) ||
    (x.strength === "exact" ? 0 : y.name.length - x.name.length) ||
    byStatus(x.entry, y.entry));
  return out.slice(0, limit);
}

/** Advertised name without a trailing serial/MAC suffix, for a plain search:
 *  "Mi Smart Band 5_A1B2" → "Mi Smart Band 5", "AAWireless-3F2C9A" → "AAWireless". */
export function bleSearchQuery(advertised: string): string {
  const s = advertised.trim();
  const m = s.match(/^(.*?\S)[\s_\-:#]+\(?([0-9a-f]{2}(?:[:\-]?[0-9a-f]{2}){1,5})\)?$/i);
  return m && /\d/.test(m[2]) ? m[1] : s;
}
