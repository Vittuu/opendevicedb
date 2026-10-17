// OpenDeviceDB importers: one module per external source, see SPEC.md (P2).
import zigbee2mqtt from "./sources/zigbee2mqtt.ts";
import openwrt from "./sources/openwrt.ts";
import tasmota from "./sources/tasmota.ts";
import esphome from "./sources/esphome.ts";
import thingino from "./sources/thingino.ts";
import type { Source } from "./lib.ts";

export * from "./lib.ts";

/** Registered sources, in priority order. */
export const SOURCES: Source[] = [zigbee2mqtt, openwrt, tasmota, esphome, thingino];
