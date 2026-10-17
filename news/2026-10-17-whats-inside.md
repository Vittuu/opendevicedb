---
title: "What's inside: 21,903 devices you can keep using without the vendor"
date: 2026-10-17
summary: A first look at the data — 7,742 devices with an open firmware, 13,257 controllable with open code, from phones and laptops to heaters and microwaves.
tags: [data]
---

OpenDeviceDB now lists **21,903 devices**. Here is what that means in practice.

**7,742 can run an open firmware.** The vendor's software can be replaced entirely:
LineageOS or postmarketOS on phones and tablets, coreboot on 688 laptops and mainboards
(Framework, ThinkPads, hundreds of Chromebooks), OpenWrt on routers, Klipper or Marlin on
3D printers, Rockbox on music players, thingino on IP cameras, Tasmota or ESPHome on smart
plugs and bulbs.

**13,257 are controllable with open code** while keeping their stock firmware: Zigbee and
Z-Wave devices through Zigbee2MQTT and Z-Wave JS, Tuya appliances over the local network
with tuya-local, 1,065 cameras over USB with libgphoto2, smartwatches and bands with
Gadgetbridge, RGB peripherals with OpenRGB, robot vacuums freed from their cloud with
Valetudo, weather stations and sensors read with a cheap radio and rtl_433.

**904 are partly documented**: a protocol is known in part, or a port exists but is not
finished. Those are good places to help.

Some examples by category:

| Category | Devices |
|---|---:|
| Switches | 3,350 |
| Lights | 3,084 |
| Sensors | 2,177 |
| Peripherals (keyboards, mice, GPUs, RAM) | 1,799 |
| Smart plugs | 1,785 |
| Routers | 1,687 |
| Cameras | 1,065 |
| Home appliances | 950 |
| Phones | 802 |
| Wearables | 482 |
| Laptops | 445 |
| 3D printers | 276 |

**Home appliances** are the newest addition: heaters, fans, dehumidifiers, air conditioners,
kettles and pet feeders controlled locally with tuya-local, plus brand-level records for
Bosch/Siemens/Neff/Gaggenau appliances (Home Connect, through
[hcpy](https://github.com/hcpy2-0/hcpy)) and Midea washing machines, dryers, dishwashers,
fridges and even [microwave ovens](/devices/midea/microwave-ovens/) through
[midea_ac_lan](https://github.com/wuwentao/midea_ac_lan). The policy is strict here:
nothing that bypasses door locks, thermal cut-outs or other safety interlocks.

**19,448 records carry an identifier** (FCC ID, USB vid:pid, BLE name, chip, model code),
so you can [search](/devices/) with what is printed on the label rather than guess the
marketing name. 362 devices are covered by more than one project — an Anet A8 printer by
both Klipper and Marlin, for instance — and show up as one record listing both.

Is your device missing, or only partly supported? [Request it](/wanted/): every 👍 tells
someone who can do the work where it will help most. And if OpenDeviceDB is useful to you,
a ⭐ on [GitHub](https://github.com/opendevicedb/opendevicedb) helps others find it.
