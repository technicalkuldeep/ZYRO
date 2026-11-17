// Workspace-local runtime for the external faucet client's Node 24 Argon2 API.
// Does not install anything or change PATH. Verify the official release checksum before use.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const version = "v24.22.3";
const base = "https://nodejs.org/dist/" + version;
const sums = await fetch(base + "/SHASUMS256.txt", {
  signal: AbortSignal.timeout(20000),
});
if (!sums.ok) throw new Error("Official Node checksum manifest unavailable");
const line = (await sums.text())
  .split("\n")
  .find((l) => l.endsWith("win-x64/node.exe"));
if (!line) throw new Error("Executable checksum not listed");
const response = await fetch(base + "/win-x64/node.exe", {
  signal: AbortSignal.timeout(120000),
});
if (!response.ok) throw new Error("Official Node runtime unavailable");
const data = Buffer.from(await response.arrayBuffer());
const digest = createHash("sha256").update(data).digest("hex");
if (digest !== line.split(/\s+/)[0])
  throw new Error("Node executable checksum mismatch");
mkdirSync(".local/node24", { recursive: true });
writeFileSync(".local/node24/node.exe", data);
writeFileSync(
  ".local/node24/provenance.json",
  JSON.stringify(
    { version, sha256: digest, source: base + "/win-x64/node.exe" },
    null,
    2,
  ) + "\n",
);
console.log("Verified workspace-local Node " + version + " SHA-256 " + digest);
