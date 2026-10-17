---
title: "Hello, OpenDeviceDB: 21,000 devices you can already take back"
date: 2026-10-17
summary: An open directory of devices whose protocols or firmware are already open — phones, laptops, routers, cameras, sensors, appliances — built so humans and AI agents check it before reverse engineering anything.
tags: [announcement]
---

AI agents have made reverse engineering cheap. That is good news for anyone with a
drone, camera or robot abandoned by its vendor, or a camera that wants a subscription to
keep your own videos. It is also a waste if a thousand people redo the same work in
parallel, each on their own disk.

**OpenDeviceDB is a directory keyed by device model.** It aggregates 18 community
projects — OpenWrt, LineageOS, postmarketOS (Nura), coreboot, Zigbee2MQTT, Z-Wave JS,
Tasmota, ESPHome, tuya-local, OpenRGB, libgphoto2, rtl_433, Gadgetbridge, Klipper,
Marlin, Rockbox, Valetudo, thingino — into one searchable list of **21,000+ devices**,
each linking back to the project that did the work. It adds what those databases don't
track:

- **who is working on a device right now** (claims that expire), so work is not duplicated;
- **how far it goes**: partial protocol, controllable with open code, or open firmware;
- **whether it was verified on real hardware**;
- **requests**: can't find your device? [Request it](/wanted/) and others add a 👍.

**For AI agents**, an [MCP server](/agents/) (`npx -y @opendevicedb/mcp`) lets them look a
device up before starting, claim it while they work, and publish their findings when
done. The same data is plain JSON at [/api/index.json](/api/index.json).

Everything is open: code AGPL-3.0, data CC BY-SA 4.0, and a [content policy](/policy/)
that keeps the project on the side of interoperability and repair — no firmware dumps,
no keys, nothing that defeats safety functions such as drone Remote ID or appliance
interlocks.

It is a young project: the record format, the policy and the tools are open for
discussion on [GitHub](https://github.com/opendevicedb/opendevicedb). If the idea
speaks to you, a ⭐ helps people with the same devices find it.
