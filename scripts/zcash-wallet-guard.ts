import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const baseline = JSON.parse(
  readFileSync("docs/evidence/zcash-wallet-phase2-baseline.json", "utf8"),
);
const changed = baseline.files
  .filter(
    (file: { path: string; sha256: string }) =>
      createHash("sha256")
        .update(readFileSync(file.path))
        .digest("hex")
        .toLowerCase() !== file.sha256.toLowerCase(),
  )
  .map((file: { path: string }) => file.path);
const result = {
  checkedAt: new Date().toISOString(),
  checkedFiles: baseline.files.length,
  changed,
};
mkdirSync("artifacts/zcash-wallet", { recursive: true });
writeFileSync(
  "artifacts/zcash-wallet/arena-guard.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
if (changed.length) process.exitCode = 1;
