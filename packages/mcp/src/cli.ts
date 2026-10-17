#!/usr/bin/env node
// Command-line access to the same tools as the MCP server, for humans and tests.
//   node src/cli.ts lookup --vendor DJI --model "Neo 2"
//   node src/cli.ts search "tello" --category drone
//   node src/cli.ts claim --vendor Acme --model X1 --category toy --who me --contact me@x --scope "BLE" --days 30
//   node src/cli.ts publish --id acme/x1 --patch '{"status":"partial-protocol"}'   (or --patch-file f.json)
//   node src/cli.ts sources
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { backendFromEnv } from "./backend.ts";
import { TOOLS } from "./tools.ts";

const COMMANDS: Record<string, { tool: string; positional?: string }> = {
  lookup: { tool: "lookup_device" },
  search: { tool: "search_devices", positional: "query" },
  claim: { tool: "claim_device" },
  publish: { tool: "publish_findings", positional: "id" },
  sources: { tool: "list_sources" },
};
const NUMBERS = new Set(["days", "limit"]);

function usage(): never {
  console.error("usage: node src/cli.ts <lookup|search|claim|publish|sources> [arg] [--flag value ...]\n" +
    "flags are the tool's input fields (dashes or underscores), e.g. --fcc-id, --allow-downgrade; " +
    "publish takes --patch '<json>' or --patch-file <file>.\nenv: ODB_REPO=<checkout> or ODB_API_URL=<site url>");
  process.exit(2);
}

export function parseArgs(argv: string[]): { tool: string; args: Record<string, unknown> } {
  const cmd = COMMANDS[argv[0] ?? ""];
  if (!cmd) usage();
  const args: Record<string, unknown> = {};
  const rest: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { rest.push(a); continue; }
    const key = a.slice(2).replace(/-/g, "_");
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { args[key] = true; continue; }
    i++;
    if (key === "patch_file") args.patch = JSON.parse(readFileSync(next, "utf8"));
    else if (key === "patch") args.patch = JSON.parse(next);
    else if (NUMBERS.has(key)) args[key] = Number(next);
    else if (next === "true" || next === "false") args[key] = next === "true";
    else args[key] = next;
  }
  if (cmd.positional && rest.length) args[cmd.positional] = rest.join(" ");
  if (cmd.tool === "search_devices" && args.query === undefined) args.query = "";
  return { tool: cmd.tool, args };
}

// Entry point check that survives the npm bin symlink (import.meta.main needs Node >= 24.2).
const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const { tool, args } = parseArgs(process.argv.slice(2));
  const def = TOOLS.find((t) => t.name === tool)!;
  const parsed = z.object(def.shape).strict().safeParse(args);
  if (!parsed.success) {
    console.error(z.prettifyError(parsed.error));
    process.exit(2);
  }
  const result = await def.run({ backend: backendFromEnv() }, parsed.data);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
