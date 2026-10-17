// Site-wide constants.
export const REPO_URL = "https://github.com/opendevicedb/opendevicedb";
export const SITE_NAME = "OpenDeviceDB";
export const PITCH =
  "An open directory of devices whose protocols or firmware have been reverse engineered, so nobody — human or AI agent — redoes work that already exists.";

export const STATUS_LABEL: Record<string, string> = {
  unknown: "Unknown",
  "in-progress": "In progress",
  "partial-protocol": "Partial protocol",
  controllable: "Controllable",
  "open-firmware": "Open firmware",
};

export const STATUS_HELP: Record<string, string> = {
  unknown: "Listed, nothing public is known yet.",
  "in-progress": "Someone holds a live claim; no usable result yet.",
  "partial-protocol": "Part of the protocol is documented (e.g. telemetry, not control).",
  controllable: "Fully drivable by open code over the stock firmware.",
  "open-firmware": "A free replacement firmware exists.",
};

/** "Pebble" + "Pebble Time" → "Pebble Time"; "Ryze Tech" + "Tello" → "Ryze Tech Tello". */
export function displayName(vendor: string, model: string): string {
  return model.toLowerCase().startsWith(vendor.toLowerCase()) ? model : `${vendor} ${model}`;
}

export const LICENSES = {
  code: "AGPL-3.0-or-later",
  data: "CC BY-SA 4.0",
  skill: "CC0",
};
