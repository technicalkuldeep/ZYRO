import pg from "pg";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "TEST_DATABASE_URL is required. Start Docker PostgreSQL and set a dedicated test database URL. Skipped tests do not count as verification.",
  );
const pool = new pg.Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
let version: string;
try {
  await pool.query(
    readFileSync(
      new URL("../apps/api/migrations/0000_records.sql", import.meta.url),
      "utf8",
    ),
  );
  version = (await pool.query("SELECT version() AS version")).rows[0].version;
  console.log("Applied PostgreSQL migration; connected to " + version);
} finally {
  await pool.end();
}
const code = await new Promise<number>((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "tests/postgres.test.ts"],
    { stdio: "inherit", env: process.env },
  );
  child.once("error", reject);
  child.once("exit", (n) => resolve(n ?? 1));
});
if (code === 0) {
  mkdirSync(".local", { recursive: true });
  writeFileSync(
    ".local/postgres-evidence.json",
    JSON.stringify(
      {
        verified: true,
        version,
        checkedAt: new Date().toISOString(),
        tests: "tests/postgres.test.ts",
        migration: "0000_records.sql",
      },
      null,
      2,
    ) + "\n",
  );
}
process.exitCode = code;
