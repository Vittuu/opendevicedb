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

// SPEC "Freedom": what stays proprietary or cloud-bound once a project is in use.
export const NONFREE_LABEL: Record<string, string> = {
  "vendor-blobs": "vendor blobs", "device-firmware": "stock firmware", modem: "modem", gpu: "GPU", wifi: "Wi-Fi",
  bluetooth: "Bluetooth", camera: "camera", sensors: "sensors", bootloader: "bootloader", other: "other",
};

export const NONFREE_HELP: Record<string, string> = {
  "vendor-blobs": "proprietary files extracted from the stock firmware",
  "device-firmware": "the stock firmware stays on the device; the project only talks to it",
  modem: "cellular modem firmware",
  gpu: "graphics driver or firmware",
  wifi: "Wi-Fi driver or firmware",
  bluetooth: "Bluetooth firmware",
  camera: "camera driver or image processing",
  sensors: "sensor hub or sensor drivers",
  bootloader: "boot firmware",
  other: "another proprietary part",
};

export const CLOUD_LABEL: Record<string, string> = {
  none: "none", "setup-only": "only at setup", optional: "optional", required: "required", unknown: "unknown",
};

export const CLOUD_HELP: Record<string, string> = {
  none: "works fully locally",
  "setup-only": "a vendor account is needed once, e.g. to obtain a local key",
  optional: "cloud features exist but are not needed",
  required: "does not work without the vendor's cloud",
  unknown: "not known",
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
