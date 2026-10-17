// Naive POLICY.md screen for agent-written text (v0): keyword match, refuse, point to the policy.
// False positives are expected and fine: the agent rephrases or a human reviews the PR.

export interface PolicyHit { field: string; rule: string; match: string }

const RULES: { rule: string; re: RegExp }[] = [
  { rule: "defeating drone Remote ID", re: /\bremote[\s_-]?id(entification)?\b/i },
  { rule: "defeating geofencing", re: /\bgeo[\s_-]?fenc/i },
  { rule: "defeating no-fly enforcement", re: /\bno[\s_-]?fly\b/i },
  {
    rule: "hosting proprietary firmware images",
    re: /\b(stock|vendor|original|official|proprietary|oem)\s+firmware\s+(image|dump|binar(y|ies)|blob|file|download|mirror)s?\b|\bfirmware\s+(image|dump|binar(y|ies)|blob)s?\s+(hosted|mirror(ed)?|upload(ed)?|download)\b/i,
  },
];

export const POLICY_POINTER =
  "POLICY.md (section \"Refused\"): no proprietary firmware images, vendor code, keys or credentials; " +
  "nothing whose purpose is to defeat a regulatory safety or compliance function (drone Remote ID, " +
  "geofencing / no-fly enforcement, radio power or frequency limits, emissions or safety systems, " +
  "medical safety interlocks).";

/** Scan named text fields; returns every hit. */
export function policyScan(fields: [string, string | undefined][]): PolicyHit[] {
  const hits: PolicyHit[] = [];
  for (const [field, text] of fields) {
    if (!text) continue;
    for (const { rule, re } of RULES) {
      const m = text.match(re);
      if (m) hits.push({ field, rule, match: m[0] });
    }
  }
  return hits;
}
