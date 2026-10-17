// SPEC.md "Static API": /api/devices/<vendor>/<model>.json — the full merged record.
//
// Written straight to dist/ when the build is done instead of going through an Astro
// endpoint: Astro's per-route overhead (~1.7 ms) made 20k JSON routes cost ~35 s, plain
// writes take ~1 s. In `astro dev` the same files are served by a middleware.
import type { AstroIntegration } from "astro";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll, type DeviceRecord } from "@opendevicedb/core";

const ROUTE = /^\/api\/devices\/([a-z0-9-]+)\/([a-z0-9-]+)\.json$/;
export const deviceJson = (r: DeviceRecord) => JSON.stringify(r, null, 2);

export default function deviceJsonIntegration(opts: { root: () => string }): AstroIntegration {
  return {
    name: "odb-device-json",
    hooks: {
      "astro:server:setup": ({ server }) => {
        server.middlewares.use((req, res, next) => {
          const m = req.url?.split("?")[0].match(ROUTE);
          if (!m) return next();
          // reload on every request so edits to data/ show up without a restart
          const rec = loadAll(opts.root()).find((r) => r.id === `${m[1]}/${m[2]}`);
          if (!rec) return next();
          res.setHeader("Content-Type", "application/json");
          res.end(deviceJson(rec));
        });
      },
      "astro:build:done": ({ dir, logger }) => {
        const t0 = performance.now();
        const out = join(fileURLToPath(dir), "api/devices");
        const records = loadAll(opts.root());
        const made = new Set<string>();
        for (const r of records) {
          const [vendor, model] = r.id.split("/");
          const d = join(out, vendor);
          if (!made.has(d)) { mkdirSync(d, { recursive: true }); made.add(d); }
          writeFileSync(join(d, `${model}.json`), deviceJson(r));
        }
        logger.info(`wrote ${records.length} device JSON files in ${Math.round(performance.now() - t0)} ms`);
      },
    },
  };
}
