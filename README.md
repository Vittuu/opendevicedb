# OpenDeviceDB

[![Website](https://img.shields.io/badge/website-opendevicedb.org-1f4fc4)](https://opendevicedb.org)
[![npm](https://img.shields.io/npm/v/@opendevicedb/mcp?label=MCP%20server)](https://www.npmjs.com/package/@opendevicedb/mcp)
[![Code: AGPL-3.0](https://img.shields.io/badge/code-AGPL--3.0-blue)](LICENSE)
[![Data: CC BY-SA 4.0](https://img.shields.io/badge/data-CC%20BY--SA%204.0-green)](LICENSE-DATA.md)

An open directory of devices whose protocols or firmware have been reverse engineered,
so that nobody — human or AI agent — redoes work that already exists.

- **Humans**: browse the directory, device pages and news on the website (`site/`).
- **Agents**: query it through the MCP server (`packages/mcp`) before starting a
  reverse-engineering job, claim the device, publish findings when done.
- **Existing databases** (18 today: OpenWrt, Zigbee2MQTT, Z-Wave JS, Tasmota, ESPHome,
  tuya-local, OpenRGB, libgphoto2, LineageOS, postmarketOS/Nura, coreboot, rtl_433,
  Gadgetbridge, Klipper, Marlin, Rockbox, Valetudo, thingino…) are aggregated by importers
  (`packages/importers`), with a link back to each source.

If it is useful to you, a ⭐ helps people with the same devices find it.

See [SPEC.md](SPEC.md) for the design and [POLICY.md](POLICY.md) for what we accept.

```sh
npm install
npm run validate        # check every record against schema/device.schema.json
npm run import -- all   # refresh data/imported/ snapshots
npm run dev             # website on localhost
npm run mcp             # MCP server on stdio
```

Code: AGPL-3.0-or-later (see LICENSE). Data: CC BY-SA 4.0 (see LICENSE-DATA.md).
