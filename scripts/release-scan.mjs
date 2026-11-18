// Conservative publication inventory. Prints paths/rule names, never matching secrets.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const paths = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings = [];
const sensitivePath =
  /(^|\/)(?:\.env(?:\..*)?|wallet-data|signer-shares)(?:\/|$)|\.(?:sqlite(?:-.*)?|db(?:-.*)?|age|pem|key)$/i;
const rules = [
  ["private-key PEM", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ["age identity", /AGE-SECRET-KEY-1[0-9A-Z]{20,}/],
  [
    "GitHub token",
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/,
  ],
  ["AWS access key", /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  [
    "Zcash secret key",
    /secret-(?:extended-key|spending-key)-(?:test|main)[a-z0-9]{30,}/,
  ],
];
for (const path of paths) {
  if (path !== ".env.example" && sensitivePath.test(path))
    findings.push({ path, rule: "sensitive path" });
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue; // Binary assets need visual/provenance review.
  const content = bytes.toString("utf8");
  for (const [rule, pattern] of rules)
    if (pattern.test(content)) findings.push({ path, rule });
}
console.log(
  JSON.stringify(
    {
      filesChecked: paths.length,
      findings,
      limitations:
        "Heuristic only; does not detect every mnemonic, key share, credential or secret in binary assets. Review staged diff and screenshots before publication.",
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;
