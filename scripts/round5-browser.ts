import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Accounts } from "../apps/api/src/accounts.js";
import { arenaServices } from "../apps/api/src/arena-services.js";
import { Store } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
import { gameDefinitions } from "../packages/shared/src/arena-games.js";
const name = "zyro_test_ui5_" + randomUUID().slice(0, 8),
  accounts = new Accounts(process.env.MONGODB_URI, name);
await accounts.init();
const services = await arenaServices(accounts);
await services.crypto.seed();
const store = new Store(":memory:", "");
await store.init();
const { app } = createApp(store, async () => accounts);
const server = app.listen(4100, "127.0.0.1");
process.env.WEB_ORIGIN = "http://127.0.0.1:3100";
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
      API_URL: "http://127.0.0.1:4100",
      ZYRO_NEXT_DIST: ".next-qa",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let ready = false,
  log = "";
web.stdout.on("data", (b) => {
  if (String(b).includes("Ready")) ready = true;
});
web.stderr.on("data", (b) => {
  log += String(b);
});
mkdirSync("artifacts/round5", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
const errors: string[] = [],
  checks: unknown[] = [];
const origin = "http://127.0.0.1:3100";
try {
  for (let n = 0; n < 60 && !ready; n++)
    await new Promise((r) => setTimeout(r, 500));
  if (!ready) throw new Error("QA frontend did not start");
  const user = (
    await accounts.login({
      sub: "round5-ui",
      email: "round5-ui@example.invalid",
      emailVerified: true,
      name: "QA Forecaster",
    })
  ).user;
  const admin = (
    await accounts.login({
      sub: "round5-operator",
      email: process.env.ADMIN_GOOGLE_EMAIL || "web3kuldeep@gmail.com",
      emailVerified: true,
      name: "QA Operator",
    })
  ).user;
  // Explicit, audited fixture funding lets the browser exercise every game without top-ups in product code.
  await accounts.grant(
    admin,
    user._id,
    500,
    "Isolated browser test funding",
    randomUUID(),
  );
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.addCookies([
    {
      name: "zyro_account",
      value: await accounts.newSession(user._id),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  async function capture(path: string, label: string, width: number) {
    await page!.setViewportSize({ width, height: 1000 });
    await page!.goto(origin + path);
    await page!.locator("h1").first().waitFor();
    await page!.waitForFunction(() => !document.querySelector(".skeleton"));
    if (path.includes("/games/"))
      await page!.getByRole("button", { name: "Review prediction" }).waitFor();
    await page!.evaluate(() => document.fonts.ready);
    await page!.waitForTimeout(350);
    const scroll = await page!.evaluate(
      () => document.documentElement.scrollWidth,
    );
    if (scroll > width + 1)
      throw new Error(`${path}: overflow ${scroll} at ${width}`);
    await page!.screenshot({
      path: `artifacts/round5/${label}-${width}.png`,
      fullPage: true,
    });
    checks.push({ path, width, scroll });
  }
  const markets = await services.crypto.list();
  if (markets.length < 6)
    throw new Error("Actual provider did not publish six upcoming markets");
  const btc = markets.find((m) => m.spec.pair === "BTC-USD")!;
  for (const width of [1440, 1024, 390])
    for (const [path, label] of [
      ["/arena", "arena"],
      ["/arena/games", "quick"],
      ["/arena/bot", "bot"],
      ["/arena/crypto", "crypto"],
      [`/arena/crypto/${encodeURIComponent(btc._id)}`, "btc-detail"],
      ["/arena/games?category=Politics", "politics-empty"],
      ["/arena/games?category=Sports", "sports-empty"],
    ])
      await capture(path, label, width);
  for (const width of [1440, 1024, 390])
    for (const def of gameDefinitions)
      await capture(`/arena/games/${def.key}`, def.key, width);
  await page.setViewportSize({ width: 390, height: 1000 });
  let won = false,
    lost = false;
  for (const def of gameDefinitions) {
    await page.goto(origin + `/arena/games/${def.key}`);
    await page.getByRole("button", { name: "Review prediction" }).click();
    await page.getByRole("button", { name: "Confirm prediction" }).click();
    await page
      .getByRole("button", { name: "Reveal result", exact: true })
      .click({ timeout: 15000 });
    await page.locator(".game-result-banner").waitFor();
    const r = await accounts
      .rounds()
      .findOne({ userId: user._id, gameKey: def.key, status: "RESOLVED" });
    if (!r?.result) throw new Error(`Missing persisted result ${def.key}`);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(150);
    await page.screenshot({
      path: `artifacts/round5/${def.key}-result-390.png`,
      fullPage: true,
    });
    if (r.result.verdict === "WIN") {
      won = true;
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(150);
      await page.screenshot({
        path: "artifacts/round5/winning-result-390.png",
        fullPage: true,
      });
    }
    if (r.result.verdict === "LOSS") {
      lost = true;
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(150);
      await page.screenshot({
        path: "artifacts/round5/losing-result-390.png",
        fullPage: true,
      });
    }
    const balance = await accounts.accounts().findOne({ _id: user._id });
    await page.reload();
    await page.locator(".game-result-banner").waitFor();
    if (
      (await accounts.accounts().findOne({ _id: user._id }))?.available !==
      balance?.available
    )
      throw new Error("Refresh changed balance");
  }
  // Capture actual random outcomes; never inject a fabricated winning screen.
  for (let n = 0; n < 15 && (!won || !lost); n++) {
    await page.goto(origin + "/arena/games/coin-flip");
    await page.getByRole("button", { name: "Play another round" }).click();
    await page.getByRole("button", { name: "Review prediction" }).click();
    await page.getByRole("button", { name: "Confirm prediction" }).click();
    await page
      .getByRole("button", { name: "Reveal result", exact: true })
      .click({ timeout: 15000 });
    await page.locator(".game-result-banner").waitFor();
    const r = await accounts
      .rounds()
      .find({ userId: user._id, gameKey: "coin-flip", status: "RESOLVED" })
      .sort({ createdAt: -1 })
      .next();
    if (r?.result?.verdict === "WIN") {
      won = true;
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(150);
      await page.screenshot({
        path: "artifacts/round5/winning-result-390.png",
        fullPage: true,
      });
    } else if (r?.result?.verdict === "LOSS") {
      lost = true;
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(150);
      await page.screenshot({
        path: "artifacts/round5/losing-result-390.png",
        fullPage: true,
      });
    }
  }
  await page.goto(origin + `/arena/crypto/${encodeURIComponent(btc._id)}`);
  await page.getByRole("button", { name: "Review prediction" }).click();
  await page.getByRole("button", { name: "Confirm prediction" }).click();
  await page
    .getByRole("heading", { name: "A little patience. A real outcome." })
    .waitFor();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: "artifacts/round5/crypto-pending-390.png",
    fullPage: true,
  });
  await page.goto(origin + "/arena/history");
  await page.getByRole("heading", { name: "Prediction history" }).waitFor();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: "artifacts/round5/history-390.png",
    fullPage: true,
  });
  await context.addCookies([
    {
      name: "zyro_account",
      value: await accounts.newSession(admin._id),
      url: origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  for (const width of [1440, 390])
    await capture("/admin/arena", "admin-operations", width);
  const live = JSON.parse(
    readFileSync("artifacts/round5/live-resolution.json", "utf8"),
  );
  await services.crypto
    .markets()
    .updateOne(
      { _id: live.market._id },
      {
        $setOnInsert: {
          ...live.market,
          createdAt: new Date(live.market.createdAt),
          nextAttempt: new Date(live.market.nextAttempt),
        },
      },
      { upsert: true },
    );
  await capture(
    `/arena/crypto/${encodeURIComponent(live.market._id)}`,
    "verified-source-evidence",
    1440,
  );
  await page
    .getByRole("heading", { name: `Outcome: ${live.market.outcome}` })
    .waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  if (!won || !lost)
    throw new Error("Did not observe both random win/loss states");
  writeFileSync(
    "artifacts/round5/browser-report.json",
    JSON.stringify(
      {
        passed: true,
        checks,
        gameFlows: 7,
        realSourceMarkets: markets.length,
        won,
        lost,
        pageErrors: errors,
        identity:
          "Synthetic QA users in an isolated Atlas database; all market prices fetched from Coinbase",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: checks.length,
      gameFlows: 7,
      realSourceMarkets: markets.length,
      pageErrors: errors.length,
    }),
  );
} catch (e) {
  if (page) {
    await page
      .screenshot({ path: "artifacts/round5/failure.png", fullPage: true })
      .catch(() => {});
    writeFileSync(
      "artifacts/round5/failure.txt",
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  throw e;
} finally {
  writeFileSync("artifacts/round5/qa-server.log", log);
  await browser.close();
  web.kill();
  await new Promise<void>((r) => server.close(() => r()));
  await store.close();
  if (accounts.db.databaseName === name && name.startsWith("zyro_test_ui5_"))
    await accounts.db.dropDatabase();
  await accounts.client.close();
}
