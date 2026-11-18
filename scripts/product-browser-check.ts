import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Accounts } from "../apps/api/src/accounts.js";
import { Store } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";

// Synthetic identities exist only in this uniquely named, isolated Atlas database.
// This exercises the real UI, sessions and transactions, not interactive Google consent.
const dbName =
  "zyro_test_browser_" + randomUUID().replaceAll("-", "").slice(0, 12);
const accounts = new Accounts(process.env.MONGODB_URI, dbName);
await accounts.init();
const store = new Store(":memory:", "");
await store.init();
const { app, engine } = createApp(store, async () => accounts);
await engine.seed();
const server = app.listen(4100, "127.0.0.1");
const web = spawn(
  process.execPath,
  [
    "../../node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    cwd: "apps/web",
    env: {
      ...process.env,
      WEB_ORIGIN: "http://127.0.0.1:3100",
      API_URL: "http://127.0.0.1:4100",
      ZYRO_NEXT_DIST: ".next-qa",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
// API origin validation is evaluated at request time.
process.env.WEB_ORIGIN = "http://127.0.0.1:3100";
let serverLog = "";
web.stderr.on("data", (b) => {
  serverLog += String(b);
});
let ready = false;
web.stdout.on("data", (b) => {
  if (String(b).includes("Ready")) ready = true;
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors: string[] = [];
const checks: unknown[] = [];
const origin = "http://127.0.0.1:3100";
mkdirSync("artifacts/round4", { recursive: true });
try {
  for (let n = 0; n < 60 && !ready; n++)
    await new Promise((r) => setTimeout(r, 500));
  if (!ready) throw new Error("QA frontend did not start");
  const player = (
    await accounts.login({
      sub: "browser-player",
      email: "browser-player@example.invalid",
      emailVerified: true,
      name: "QA Forecaster",
    })
  ).user;
  const owner = (
    await accounts.login({
      sub: "browser-admin",
      email: process.env.ADMIN_GOOGLE_EMAIL || "web3kuldeep@gmail.com",
      emailVerified: true,
      name: "QA Administrator",
    })
  ).user;
  const guest = await browser.newContext({ reducedMotion: "reduce" });
  const page = await guest.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400)
      console.log(
        JSON.stringify({ status: r.status(), path: new URL(r.url()).pathname }),
      );
  });
  async function capture(path: string, label: string, width: number) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + path);
    await page.locator("h1").first().waitFor();
    await page.waitForFunction(() => !document.querySelector(".skeleton"));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    if (layout.scroll > width + 1)
      throw new Error(`Overflow ${path} ${width}: ${layout.scroll}`);
    await page.screenshot({
      path: `artifacts/round4/${label}-${width}.png`,
      fullPage: true,
    });
    checks.push({ path, width, ...layout });
  }
  for (const width of [1440, 1024, 390]) await capture("/", "landing", width);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.screenshot({
    path: "artifacts/round4/mobile-menu-390.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Close navigation" }).click();
  await page.goto(origin + "/admin/users");
  await page.waitForURL(/signin/);
  await guest.addCookies([
    {
      name: "zyro_account",
      value: await accounts.newSession(player._id),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  for (const width of [1440, 1024, 390])
    for (const [path, label] of [
      ["/choose", "choose"],
      ["/arena", "arena"],
      ["/arena/games", "games"],
      ["/arena/games/quick-draw", "game"],
      ["/arena/history", "history-empty"],
      ["/arena/leaderboard", "leaderboard-empty"],
      ["/arena/profile", "profile"],
    ])
      await capture(path, label, width);
  await page.goto(origin + "/admin");
  await page
    .getByRole("heading", { name: "Administrator access required." })
    .waitFor();
  await page.goto(origin + "/arena/games/quick-draw");
  await page.getByRole("button", { name: "Review prediction" }).click();
  await page.getByRole("button", { name: "Confirm prediction" }).click();
  await page
    .getByRole("heading", {
      name: /Your call is locked|Ready for the reveal/,
    })
    .waitFor();
  if (
    (await accounts.accounts().findOne({ _id: player._id }))?.available !== 90
  )
    throw new Error("Stake was not persisted");
  await page.screenshot({
    path: "artifacts/round4/game-pending-390.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Reveal result", exact: true })
    .click({ timeout: 15000 });
  await page.locator(".game-result-banner").waitFor();
  await page.screenshot({
    path: "artifacts/round4/game-result-390.png",
    fullPage: true,
  });
  for (const width of [1440, 1024, 390]) {
    await capture("/arena/history", "history", width);
    await capture("/arena/leaderboard", "leaderboard", width);
  }
  await guest.addCookies([
    {
      name: "zyro_account",
      value: await accounts.newSession(owner._id),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  for (const width of [1440, 1024, 390])
    for (const [path, label] of [
      ["/admin", "admin"],
      ["/admin/users", "admin-users"],
      [`/admin/users/${player._id}`, "admin-user"],
      ["/admin/audit", "admin-audit-empty"],
    ])
      await capture(path, label, width);
  await page.goto(origin + "/admin/users");
  await page.getByRole("searchbox").fill("browser-player");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("link", { name: "QA Forecaster", exact: true }).click();
  await page.getByRole("button", { name: "Add credits" }).click();
  await page.getByLabel(/Reason \(required/).fill("Browser acceptance grant");
  await page.getByRole("button", { name: "Review grant" }).click();
  await page.screenshot({
    path: "artifacts/round4/admin-grant-dialog-390.png",
    fullPage: false,
  });
  const before = (await accounts.accounts().findOne({ _id: player._id }))!
    .available;
  await page.getByRole("button", { name: "Confirm point grant" }).click();
  await page.getByText("Grant recorded.", { exact: false }).waitFor();
  if (
    (await accounts.accounts().findOne({ _id: player._id }))?.available !==
    before + 100
  )
    throw new Error("Grant did not persist");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Add credits" }).click();
  await page.getByLabel(/Reason \(required/).fill("Dialog appearance only");
  await page.getByRole("button", { name: "Review grant" }).click();
  await page.screenshot({
    path: "artifacts/round4/admin-grant-dialog-1440.png",
    fullPage: false,
  });
  await page.keyboard.press("Escape");
  await capture("/admin/audit", "admin-audit", 1440);
  await guest.addCookies([
    {
      name: "zyro_account",
      value: await accounts.newSession(player._id),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await capture("/arena", "arena-after-grant", 1440);
  await capture("/arena/games/quick-draw", "game-result", 1440);
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(
    "artifacts/round4/browser-report.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        identity:
          "Synthetic test identities in isolated Atlas database; no interactive Google consent claimed",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      responsiveChecks: checks.length,
      pageErrors: errors.length,
      screenshots: "artifacts/round4",
    }),
  );
} finally {
  writeFileSync("artifacts/round4/qa-server.log", serverLog);
  await browser.close();
  web.kill();
  await new Promise<void>((r) => server.close(() => r()));
  await store.close();
  if (
    accounts.db.databaseName === dbName &&
    dbName.startsWith("zyro_test_browser_")
  )
    await accounts.db.dropDatabase();
  await accounts.client.close();
}
