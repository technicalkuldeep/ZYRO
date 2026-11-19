import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { Accounts } from "../apps/api/src/accounts.js";
import { arenaServices } from "../apps/api/src/arena-services.js";
import { FastCrypto } from "../apps/api/src/fast-crypto.js";
import { livePrices } from "../apps/api/src/live-prices.js";
import { Store } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
const dir = "artifacts/round6";
mkdirSync(dir, { recursive: true });
const name = "zyro_test_live6_" + randomUUID().slice(0, 8),
  a = new Accounts(process.env.MONGODB_URI, name),
  store = new Store(":memory:", "");
const errors: string[] = [],
  logs: string[] = [];
let worker: ReturnType<typeof setInterval> | undefined,
  working = false;
let server:
    ReturnType<ReturnType<typeof createApp>["app"]["listen"]> | undefined,
  web: ReturnType<typeof spawn> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (
  fn: () => boolean | Promise<boolean>,
  ms: number,
  label: string,
) => {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() > end) throw Error(label);
    await sleep(1000);
  }
};
try {
  await a.init();
  await store.init();
  livePrices.start();
  await until(
    () =>
      ["BTC-USD", "ETH-USD", "SOL-USD"].every((p) =>
        livePrices.fresh(p as "BTC-USD"),
      ),
    45000,
    "Genuine Coinbase BTC/ETH/SOL fresh ticks unavailable",
  );
  console.log(
    JSON.stringify({
      phase: "REAL_FEED_CONNECTED",
      snapshot: livePrices.snapshot(),
    }),
  );
  const services = await arenaServices(a);
  let fast = services.fast;
  await fast.tick();
  const user = (
    await a.login({
      sub: "round6-public-source-qa",
      email: "round6-live@example.invalid",
      emailVerified: true,
      name: "Live Market QA",
    })
  ).user;
  process.env.WEB_ORIGIN = "http://127.0.0.1:3106";
  server = createApp(store, async () => a).app.listen(4106, "127.0.0.1");
  web = spawn(
    process.execPath,
    [
      "../../node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3106",
    ],
    {
      cwd: "apps/web",
      env: {
        ...process.env,
        API_URL: "http://127.0.0.1:4106",
        ZYRO_NEXT_DIST: ".next-qa6",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  web.stdout?.on("data", (b) => logs.push(String(b)));
  web.stderr?.on("data", (b) => logs.push(String(b)));
  await until(
    () => logs.some((l) => l.includes("Ready")),
    60000,
    "QA frontend startup failed",
  );
  worker = setInterval(() => {
    if (working) return;
    working = true;
    void fast
      .tick()
      .catch(() => errors.push("Worker failure"))
      .finally(() => {
        working = false;
      });
  }, 2000);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  await context.addCookies([
    {
      name: "zyro_account",
      value: await a.newSession(user._id),
      url: "http://127.0.0.1:3106",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("http://127.0.0.1:3106/arena/crypto/fast");
  await page.locator(".feed-status.is-live").waitFor();
  async function capture(label: string, width = 1440) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement)?.blur();
      window.scrollTo(0, 0);
    });
    await sleep(300);
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > width + 1) throw Error(`Overflow ${label}: ${w}/${width}`);
    await page.screenshot({
      path: `${dir}/${label}-${width}.png`,
      fullPage: true,
    });
  }
  await capture("live-chart");
  await capture("mobile", 390);
  await capture("tablet", 768);
  await page.setViewportSize({ width: 1440, height: 1100 });
  const round = await fast
    .rounds()
    .findOne(
      { "spec.pair": "BTC-USD", "spec.cutoff": { $gt: Date.now() + 10000 } },
      { sort: { "spec.start": 1 } },
    );
  if (!round) throw Error("No upcoming live round");
  await page
    .locator(".fast-round-board button")
    .filter({
      hasText:
        new Date(round.spec.start).toLocaleTimeString("en-GB", {
          timeZone: "UTC",
        }) + " UTC",
    })
    .click();
  console.log(
    JSON.stringify({
      phase: "WAITING_ENTRY",
      round: round._id,
      start: new Date(round.spec.start).toISOString(),
      end: new Date(round.spec.end).toISOString(),
    }),
  );
  await until(
    () => Date.now() >= round.spec.entryOpens,
    180000,
    "Entry did not open",
  );
  await page.getByRole("button", { name: "Confirm UP · 10 points" }).waitFor();
  await page.getByRole("button", { name: "Confirm UP · 10 points" }).click();
  await page.locator(".fast-receipt").waitFor();
  const p = await a.rounds().findOne({ userId: user._id, marketId: round._id });
  const debited = await a.accounts().findOne({ _id: user._id });
  if (!p || debited?.available !== 90 || debited.committed !== 10)
    throw Error("Confirmed stake accounting failed");
  await capture("locked-position");
  await capture("locked-position", 390);
  // Drop all service-local provider/cache state. Persistent jobs alone carry the observation forward.
  fast = new FastCrypto(a);
  await fast.init();
  await until(
    async () => !!(await fast.rounds().findOne({ _id: round._id }))?.opening,
    Math.max(30000, round.spec.start - Date.now() + 45000),
    "Official starting close unavailable",
  );
  await capture("observation-live");
  await until(
    () => Date.now() >= round.spec.end,
    150000,
    "Full observation window not elapsed",
  );
  await sleep(1200);
  await capture("awaiting-outcome");
  await until(
    async () =>
      (await fast.rounds().findOne({ _id: round._id }))?.status === "SETTLED",
    150000,
    "Actual ending candle/settlement not verified",
  );
  // Re-select the immutable round after any development hot refresh.
  await page
    .locator(".fast-round-board button")
    .filter({
      hasText:
        new Date(round.spec.start).toLocaleTimeString("en-GB", {
          timeZone: "UTC",
        }) + " UTC",
    })
    .click();
  await until(
    async () =>
      (await page.locator(".fast-receipt").innerText()).includes(
        "ROUND COMPLETE",
      ) ||
      (await page.locator(".fast-receipt").innerText()).includes(
        "YOU CALLED IT",
      ) ||
      (await page.locator(".fast-receipt").innerText()).includes(
        "STAKE REFUNDED",
      ),
    15000,
    "Browser did not receive persisted outcome",
  );
  await capture("settled-result");
  await capture("settled-result", 390);
  await page.reload();
  await page.locator(".fast-receipt").waitFor();
  const restored = new Accounts(process.env.MONGODB_URI, name);
  await restored.init();
  try {
    const recovered = new FastCrypto(restored);
    await recovered.init();
    await Promise.all([
      recovered.process(round._id),
      recovered.process(round._id),
    ]);
    const final = await recovered.rounds().findOne({ _id: round._id }),
      position = await restored.rounds().findOne({ _id: p.id }),
      balance = await restored.accounts().findOne({ _id: user._id });
    const ledger = await restored
      .ledger()
      .find({ operation: { $in: [`stake:${p.id}`, `settle:${p.id}`] } })
      .toArray();
    if (
      ledger.filter((l) => l.operation === `settle:${p.id}`).length !== 1 ||
      balance?.committed !== 0 ||
      balance?.available !== 90 + (position?.payout || 0)
    )
      throw Error("Settlement replay invariant failed");
    const responsiveness = await page.evaluate(async () => {
      const samples: number[] = [];
      for (let i = 0; i < 60; i++)
        await new Promise<void>((r) => {
          const t = performance.now();
          requestAnimationFrame(() => {
            samples.push(performance.now() - t);
            r();
          });
        });
      return {
        frames: samples.length,
        maxFrameWaitMs: Math.max(...samples),
        meanFrameWaitMs: samples.reduce((a, b) => a + b, 0) / samples.length,
      };
    });
    const metrics = await page
      .locator(".chart-canvas")
      .getAttribute("data-metrics");
    const memory = [];
    for (let i = 0; i < 6; i++) {
      await page
        .getByRole("button", {
          name: i % 2 ? "Bitcoin" : "Ethereum",
          exact: false,
        })
        .first()
        .click();
      await sleep(700);
      memory.push(
        await page.evaluate(() => ({
          listeners: document.querySelectorAll("canvas").length,
          heap: (
            performance as unknown as { memory?: { usedJSHeapSize: number } }
          ).memory?.usedJSHeapSize,
        })),
      );
    }
    await context.close();
    await sleep(1000);
    if (livePrices.listeners.size !== 0)
      throw Error("SSE listeners leaked after navigation/context close");
    const receipt = {
      verifiedAt: new Date().toISOString(),
      isolatedDatabase: true,
      realWebSocket: true,
      assets: livePrices.snapshot(),
      round: final,
      prediction: {
        id: p.id,
        choice: position?.choice,
        stake: position?.stake,
        result: position?.result,
        payout: position?.payout,
      },
      balance: { available: balance?.available, committed: balance?.committed },
      ledger: ledger.map((l) => ({
        id: l._id,
        operation: l.operation,
        kind: l.kind,
        amount: l.amount,
        before: l.before,
        after: l.after,
      })),
      replayedSettlementEntries: 1,
      databaseReconnected: true,
      refreshedBrowser: true,
      metrics: metrics ? JSON.parse(metrics) : null,
      responsiveness,
      assetChanges: memory,
      remainingSSEListeners: livePrices.listeners.size,
      pageErrors: errors,
    };
    writeFileSync(
      `${dir}/live-evidence.json`,
      JSON.stringify(receipt, null, 2),
    );
    console.log(
      JSON.stringify({
        phase: "LIVE_ROUND_VERIFIED",
        round: final?._id,
        outcome: final?.outcome,
        payout: position?.payout,
        balance: balance?.available,
        errors,
      }),
    );
    if (errors.length) throw Error("Browser or worker errors captured");
  } finally {
    await restored.client.close();
  }
} catch (e) {
  writeFileSync(
    `${dir}/failure.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        error: e instanceof Error ? e.message : "Unknown failure",
        feed: livePrices.snapshot(),
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.error(e instanceof Error ? e.message : "Verification failed");
  process.exitCode = 1;
} finally {
  clearInterval(worker);
  livePrices.stop();
  await browser?.close();
  web?.kill();
  server?.closeAllConnections();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  while (working) await sleep(200);
  if (a.db.databaseName === name && name.startsWith("zyro_test_live6_"))
    await a.db.dropDatabase();
  await a.client.close();
  await store.close();
}
