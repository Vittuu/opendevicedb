// Validate every curated record and snapshot; exit 1 on any error.
import { loadCurated, loadSnapshots, validate, curatedPath, REPO_ROOT } from "./index.ts";
import { relative } from "node:path";

let errors = 0;
for (const { file, record } of loadCurated()) {
  const errs = validate(record);
  if (relative(REPO_ROOT, curatedPath(record.id)) !== file) errs.push(`/id "${record.id}" does not match file path`);
  for (const e of errs) console.error(`${file}: ${e}`);
  errors += errs.length;
}
let imported = 0;
for (const snap of loadSnapshots()) {
  for (const r of snap.records) {
    const errs = validate(r);
    for (const e of errs.slice(0, 3)) console.error(`imported/${snap.source} ${r.id}: ${e}`);
    errors += errs.length;
  }
  imported += snap.records.length;
}
console.log(`${loadCurated().length} curated, ${imported} imported, ${errors} error(s)`);
process.exit(errors ? 1 : 0);
