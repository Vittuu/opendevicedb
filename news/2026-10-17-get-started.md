---
title: "Get started: install guides for 22,000 devices, and a Detect button"
date: 2026-10-17
summary: Device pages now say how to put the open firmware or software on the device, how hard it is and what can go wrong, with links to each project's official guide or installer. A new page detects a plugged-in USB or nearby Bluetooth device in your browser.
tags: [feature]
---

Knowing that an open firmware exists is half the answer. The other half is: *can I install
it, and how?* Device pages now have a **Get started** block that answers that.

**22,105 devices** have at least one install route, taken from the projects themselves:
LineageOS and postmarketOS install pages, the OpenWrt Firmware Selector, tuya-cloudcutter,
coreboot board docs, Rockbox Utility, Valetudo rooting guides, Zigbee2MQTT and Z-Wave JS
pairing pages, the ESPHome and Tasmota web installers, Gadgetbridge, Klipper, Marlin and more.
Each route says:

- **how hard it is**: easy (no tools, the device stays closed), medium (a cable, the command
  line, a coordinator) or hard (opening it, soldering, a programmer);
- what you need, the risk of bricking it, whether you can go back to stock, and which
  firmware versions it works with;
- and it links to the **official guide or installer**. Nothing is flashed from
  OpenDeviceDB: each project knows its devices best.

Mains-powered devices that must be opened get a clear warning and a plain link, never a
step-by-step button. In the [directory](/devices/?install=easy), a new filter shows the
3,324 devices that are **easy to install**.

**Did it work for you?** Each route has a *Report how it went* link (a short GitHub form:
firmware version, result). Reports are counted on the device page, so the next person knows
what to expect.

**Detect my device.** Not sure what you have? On [/detect/](/detect/), Chrome or Edge can
read the USB id of a plugged-in device (a phone in fastboot mode, a camera, a keyboard) or
the name of a nearby Bluetooth device, and find it in the directory. It all runs in your
browser; nothing is sent anywhere. Other browsers can search by what's printed on the label.

AI agents get the same routes: `lookup_device` in the [MCP server](/agents/) now returns
them, so an assistant can walk you through the easiest one with the official guide.

This idea came from comments on our launch post. Keep them coming, and if you install
something, please report how it went.
