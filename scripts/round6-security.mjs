import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const values = ["GOOGLE_CLIENT_SECRET", "MONGODB_URI", "SESSION_SECRET"]
  .map((k) => process.env[k])
  .filter((v) => v && v.length > 8);
let files = 0,
  matches = 0;
function scan(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = join(root, entry.name);
    if (entry.isDirectory()) scan(file);
    else {
      files++;
      if (values.some((v) => readFileSync(file, "utf8").includes(v))) matches++;
    }
  }
}
scan("apps/web/.next/static");
console.log(
  JSON.stringify({
    clientFiles: files,
    configuredSecretValues: values.length,
    matchingFiles: matches,
  }),
);
if (matches) process.exitCode = 1;
