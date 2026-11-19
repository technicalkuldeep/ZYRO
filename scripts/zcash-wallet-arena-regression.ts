import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Accounts } from "../apps/api/src/accounts.js";
import { Store } from "../apps/api/src/store.js";
import { createApp } from "../apps/api/src/app.js";
import { arenaServices } from "../apps/api/src/arena-services.js";
import { livePrices } from "../apps/api/src/live-prices.js";
const name = "zyro_test_wallet_regression_" + randomUUID().slice(0, 8);
const accounts = new Accounts(process.env.MONGODB_URI, name),
  store = new Store(":memory:", "");
const logs: string[] = [],
  errors: string[] = [];
let web: ReturnType<typeof spawn> | undefined;
let server:
  ReturnType<ReturnType<typeof createApp>["app"]["listen"]> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const result: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  database: name,
};
await mkdir("artifacts/zcash-wallet", { recursive: true });
try {
  await accounts.init();
  await store.init();
  const services = await arenaServices(accounts);
  await services.fast.tick();
  const { user } = await accounts.login({
    sub: randomUUID(),
    email: "wallet-regression@example.invalid",
    emailVerified: true,
    name: "Arena Regression QA",
  });
  livePrices.start();
  process.env.WEB_ORIGIN = "http://127.0.0.1:3203";
  server = createApp(store, async () => accounts).app.listen(4109, "127.0.0.1");
  web = spawn(
    process.execPath,
    [
      "../../node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3203",
    ],
    {
      cwd: "apps/web",
      env: {
        ...process.env,
        API_URL: "http://127.0.0.1:4109",
        ZYRO_NEXT_DIST: ".next-qa",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  web.stdout?.on("data", (value) => logs.push(String(value)));
  web.stderr?.on("data", (value) => logs.push(String(value)));
  const deadline = Date.now() + 60000;
  while (!logs.some((line) => line.includes("Ready"))) {
    if (Date.now() > deadline) throw Error("Regression frontend did not start");
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "zyro_account",
      value: await accounts.newSession(user._id),
      url: "http://127.0.0.1:3203",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const p = await context.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(e.message));
  for (const route of ["/arena", "/arena/crypto/fast"]) {
    await p.goto("http://127.0.0.1:3203" + route);
    if (p.url().includes("signin"))
      throw Error("Existing session was rejected");
    if (!(await p.locator("main").innerText())) throw Error("Empty Arena page");
  }
  await p.locator(".feed-status.is-live").waitFor();
  result.liveFeed = true;
  await p.screenshot({
    path: "artifacts/zcash-wallet/arena-regression.png",
    fullPage: true,
  });
  const me = await context.request.get("http://127.0.0.1:3203/api/auth/me");
  if ((await me.json()).user.id !== user._id)
    throw Error("Account contract changed");
  const oauth = await context.request.get(
    "http://127.0.0.1:3203/api/auth/google",
    { maxRedirects: 0 },
  );
  if (
    oauth.status() !== 302 ||
    !oauth.headers().location.startsWith("https://accounts.google.com/")
  )
    throw Error("Google OAuth redirect failed");
  result.googleOAuth = 302;
  result.session = 200;
  livePrices.stop();
  await p.waitForFunction(() => {
    const element = document.querySelector(".feed-status");
    return element && !element.classList.contains("is-live");
  });
  if (
    (await context.request.get("http://127.0.0.1:3203/api/health")).status() !==
    200
  )
    throw Error("API failed during outage");
  if (
    (
      await context.request.get("http://127.0.0.1:3203/api/auth/me")
    ).status() !== 200
  )
    throw Error("Auth failed during outage");
  livePrices.start();
  await p.locator(".feed-status.is-live").waitFor();
  result.recovered = true;
  const anonymous = await browser.newContext();
  const protectedRoute = await anonymous.newPage();
  await protectedRoute.goto("http://127.0.0.1:3203/arena/crypto/fast");
  await protectedRoute.waitForURL("**/signin?**");
  result.arenaStillRequiresLogin = true;
  if (errors.length) throw Error(errors.join("; "));
  result.passed = true;
} catch (e) {
  result.passed = false;
  result.error = e instanceof Error ? e.message : "Verification failed";
  process.exitCode = 1;
} finally {
  livePrices.stop();
  await browser?.close();
  web?.kill();
  server?.closeAllConnections();
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (
    accounts.db.databaseName === name &&
    name.startsWith("zyro_test_wallet_regression_")
  )
    await accounts.db.dropDatabase();
  await accounts.client.close();
  await store.close();
  await writeFile(
    "artifacts/zcash-wallet/arena-regression.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
}
