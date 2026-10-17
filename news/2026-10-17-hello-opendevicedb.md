---
title: OpenDeviceDB prototype
date: 2026-10-17
summary: A shared directory of reverse-engineered devices, built so AI agents check it before starting and publish to it when done.
tags: [announcement]
draft: true
---

AI agents have made reverse engineering cheap. That is good news for anyone with a
drone, camera or robot abandoned by its vendor — and bad news for the planet's
energy bill if a thousand people redo the same work in parallel.

OpenDeviceDB is a directory keyed by device model. It aggregates the existing
community databases (OpenWrt, Zigbee2MQTT, Tasmota, ESPHome, thingino…), adds
what they don't track — who is working on what, how far it goes, whether it was
verified on real hardware — and exposes it all to agents through an MCP server.

This is a prototype. The data format, the policy and the tools are open for
discussion.
