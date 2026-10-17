# OpenDeviceDB — specification (prototype v0)

## Problem

Since AI agents (REA, Claude Code, Codex…) made reverse engineering cheap, thousands of
people re-derive the same protocols for the same devices: an abandoned drone, a camera
whose cloud was shut down, a vacuum robot that only talks to its vendor app. The results
stay on private disks. Existing community databases (OpenWrt ToH, Zigbee2MQTT,
Gadgetbridge, Tasmota, ESPHome, OpenIPC…) each answer *"which free firmware runs on this
model"* for one category. None answers, across categories:

- has this device's protocol already been reverse engineered, and where is the result?
- is someone working on it right now?
- how far does it go (documented protocol, SDK, full free firmware) and was it verified?

## Goal

One open directory, keyed by device model, that:

1. **agents query by themselves** before starting a reverse-engineering job (MCP tool),
   and publish to when they finish;
2. **humans browse** as a website: directory, device pages, news, how to contribute;
3. **aggregates** the existing category databases instead of competing with them, so
   coverage is broad from day one and every record links back to its source project.

## Principles

- **P1 — Files in git are the database.** One YAML file per curated device under
  `data/devices/<vendor>/<model>.yaml`, validated by `schema/device.schema.json`,
  changed by pull request. No server-side database; the site and the API are static
  builds of the repository.
- **P2 — Aggregate, don't duplicate.** Importers snapshot external databases into
  `data/imported/<source>.json` (slim records + link back). Curated files override
  and enrich imported records for the same device id.
- **P3 — Claims prevent duplicate work.** A `claims` entry says "someone is working on
  this, scope X, until date Y, contact Z". Claims expire; an expired claim is ignored.
- **P4 — AI output is not trusted by default.** Every interface carries a `confidence`
  and every record a `verification` list. The "verified" badge requires a replayable
  test (`hardware-replay`) run on a real device with a stated firmware version.
- **P5 — Legally boring.** We host protocol descriptions, original code and links.
  We never host proprietary firmware images, keys, or copyrighted vendor code.
  We exclude anything whose purpose is to defeat a regulatory safety function
  (drone Remote ID, geofencing, radio power limits, emissions controls…). See `POLICY.md`.
- **P6 — Independent and open.** Code MIT, data CC-BY-SA-4.0. No vendor affiliation.

## Device record (summary — the JSON Schema is normative)

| field | meaning |
|---|---|
| `id` | `<vendor-slug>/<model-slug>`, lowercase, `[a-z0-9-]` |
| `vendor`, `model`, `aliases` | display names |
| `category` | enum, see schema |
| `identifiers` | `fcc_id`, `usb` (`vid:pid`), `ble_names`, `chips`, `sku` — used for lookup |
| `status` | `unknown` → `in-progress` → `partial-protocol` → `controllable` → `open-firmware` |
| `summary` | one paragraph, plain text |
| `interfaces[]` | per transport: `name`, `transport`, `status`, `confidence`, `spec` (url) |
| `projects[]` | existing work: `name`, `url`, `kind`, `license` |
| `claims[]` | `who`, `contact`, `scope`, `since`, `expires` |
| `verification[]` | `method`, `by`, `date`, `firmware`, `notes` |
| `provenance` | `sources[]`, `ai_assisted`, `tools[]` |
| `updated` | ISO date |

Status meaning:

- `unknown` — the device is listed, nothing public is known.
- `in-progress` — at least one live claim, no usable result yet.
- `partial-protocol` — part of the protocol is documented (e.g. telemetry, not control).
- `controllable` — the device can be fully driven by open code over its stock firmware.
- `open-firmware` — a free replacement firmware exists.

## Repository layout

```
schema/device.schema.json     normative record schema
data/devices/**.yaml          curated records (hand- or agent-written, PR reviewed)
data/imported/<source>.json   importer snapshots {source, fetched_at, records[]}
news/YYYY-MM-DD-slug.md       news posts (frontmatter: title, date, summary, tags)
packages/core                 load + validate + merge + search (TypeScript, used by all)
packages/importers            one module per external source, `npm run import -- <source>`
packages/mcp                  MCP server for agents (lookup, search, claim, publish)
site/                         Astro static site: directory, device pages, news, API json
```

## Static API (built by the site)

- `/api/index.json` — `[{id, vendor, model, category, status, sources[], identifiers}]`
- `/api/devices/<vendor>/<model>.json` — full merged record

The MCP server reads this API remotely (`ODB_API_URL`) or the local repository
(`ODB_REPO`), so it works before and after the site is online.

## MCP tools (v0)

| tool | effect |
|---|---|
| `search_devices(query, category?, status?)` | ranked matches by name, alias, identifiers |
| `lookup_device(vendor?, model?, fcc_id?, usb?, ble_name?)` | best match + full record + live claims; says explicitly "nothing known" when so |
| `claim_device(id or vendor+model, who, contact, scope, days)` | adds a claim (creates a stub record if needed) |
| `publish_findings(id, record_patch)` | merges findings into the record, validates, writes it |
| `list_sources()` | imported sources with record counts and snapshot dates |

In v0 writes go to the local repository checkout; the contributor opens the PR
(`gh pr create`). v1 will open the PR itself.

## Out of scope for v0

Accounts, comments, a write API, hosting of binaries, automatic verification.
