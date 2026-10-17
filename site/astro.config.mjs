// OpenDeviceDB website. Static build of the repository: see SPEC.md "Static API".
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import deviceJson from "./src/integrations/device-json.ts";

// The repository root. Core's own REPO_ROOT is derived from import.meta.url, which no
// longer points into packages/core once Vite has bundled it, so the site passes the root
// explicitly. ODB_REPO (same variable as the MCP server) overrides it at build time.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = () => process.env.ODB_REPO || repoRoot;

// The directory search runs core's `search` in the browser. core/src/index.ts also imports
// node:fs/path/url, yaml and ajv at module level (for loading and validation), and evaluates
// REPO_ROOT from import.meta.url, which crashes in a browser. For the client build only, those
// imports resolve to a tiny stub: the browser never calls them, tree-shaking drops the rest,
// and the search code shipped is core's own, unchanged.
const NODE_ONLY = new Set(["node:fs", "node:path", "node:url", "yaml", "ajv/dist/2020.js", "ajv-formats"]);
const STUB_ID = "\0odb-node-stub";
const browserStubForCore = {
  name: "odb-browser-stub-for-core",
  enforce: "pre",
  resolveId(id, importer, opts) {
    if (opts?.ssr || this.environment?.config?.consumer === "server") return null;
    if (NODE_ONLY.has(id) && importer && importer.includes("/packages/core/src/")) return STUB_ID;
    return null;
  },
  load(id) {
    if (id !== STUB_ID) return null;
    return [
      `const no = (n) => () => { throw new Error(n + " is not available in the browser"); };`,
      `export const readFileSync = no("readFileSync"), readdirSync = no("readdirSync"), existsSync = () => false, statSync = no("statSync");`,
      `export const join = (...p) => p.join("/"), relative = (a, b) => b, dirname = (p) => p;`,
      `export const fileURLToPath = (u) => String(u);`,
      `export default {};`,
    ].join("\n");
  },
};

export default defineConfig({
  site: "https://opendevicedb.org",
  trailingSlash: "ignore",
  build: { format: "directory", concurrency: 4 },
  integrations: [deviceJson({ root: dataRoot })],
  vite: {
    plugins: [browserStubForCore],
    define: { __ODB_ROOT__: JSON.stringify(repoRoot) },
    // core exports TypeScript source; let Vite transpile and bundle it.
    ssr: { noExternal: ["@opendevicedb/core"] },
    server: { fs: { allow: [repoRoot] } },
  },
});
