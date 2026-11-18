import { spawnSync } from "node:child_process";
process.env.ZYRO_TEST_MONGO = "1";
if (!process.env.MONGODB_URI)
  throw new Error("MONGODB_URI is required; no in-memory fallback is allowed");
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "tests/accounts.test.ts"],
  { env: process.env, stdio: "inherit" },
);
process.exitCode = result.status || 0;
