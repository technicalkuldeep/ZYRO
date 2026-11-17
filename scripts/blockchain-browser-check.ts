import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const txid = "0ce5d017e8a3c72751913348b1c5a9e2bf1ff742386776fa800903046b4a4a0c";
mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(45000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:3000/wallet");
  await page.getByText("Connected · lightwalletd", { exact: true }).waitFor();
  await page.getByLabel("Transaction ID", { exact: true }).fill(txid);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/zcash/observe") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Check testnet transaction", exact: true })
    .click();
  const value = await (await response).json();
  if (
    value.state !== "CONFIRMED" ||
    value.txid !== txid ||
    value.decoded?.transparentInputs !== 0
  )
    throw new Error(
      "Browser did not receive real confirmed transaction evidence",
    );
  await page.getByText("CONFIRMED", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await page.screenshot({
    path: "artifacts/wallet-live-desktop.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByText("CONFIRMED", { exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw new Error("Wallet overflow on mobile");
  await page.screenshot({
    path: "artifacts/wallet-live-mobile.png",
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(
    ".local/browser-chain-evidence.json",
    JSON.stringify(
      {
        verified: true,
        txid,
        state: value.state,
        confirmations: value.confirmations,
        checkedAt: value.checkedAt,
        persistenceAfterReload: true,
        mobileWidth: 375,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: actual testnet confirmation displayed in browser, persisted after reload; desktop/mobile checks passed.",
  );
} finally {
  await browser.close();
}
