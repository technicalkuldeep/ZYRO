// Real pinned WASM, real encrypted IndexedDB, real testnet scans. No faucet or sends.
// Ephemeral isolated contexts only; secrets remain in test memory and never enter artifacts.
import { chromium, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const origin = process.env.ZYRO_WALLET_QA_ORIGIN || "http://127.0.0.1:3202";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const created = await browser.newContext(),
  restored = await browser.newContext();
const password = randomBytes(24).toString("hex");
const result: Record<string, unknown> = {
  realEngine: true,
  realNetwork: true,
  transactionsSubmitted: 0,
};
let phrase = "",
  step = "create";
const observed: string[] = [];
for (const context of [created, restored]) {
  context.on("request", (request) =>
    observed.push(request.url(), request.postData() || ""),
  );
  context.on("page", (page) =>
    page.on("console", (message) => observed.push(message.text())),
  );
}
async function receive(p: Page) {
  await p.getByRole("button", { name: "Receive", exact: true }).click();
  const address = await p
    .getByRole("dialog")
    .locator("p")
    .filter({ hasText: /^utest1/ })
    .innerText();
  await p.keyboard.press("Escape");
  return address;
}
async function fill(p: Page) {
  await p.getByLabel("New wallet password", { exact: true }).fill(password);
  await p.getByLabel("Confirm password", { exact: true }).fill(password);
}
try {
  const p = await created.newPage();
  p.setDefaultTimeout(120000);
  await p.goto(origin + "/testnet");
  await p.getByRole("link", { name: /Open ZYRO Wallet/ }).click();
  expect(await p.evaluate(() => crossOriginIsolated)).toBe(true);
  result.entryIsolation = true;
  await p
    .getByRole("button", { name: "Create New Wallet", exact: true })
    .click();
  await fill(p);
  await p.getByRole("button", { name: "Create encrypted wallet" }).click();
  await p.getByRole("heading", { name: "Back up your wallet" }).waitFor();
  expect(await p.locator("ol").innerText()).not.toMatch(/[a-z]{3}/);
  await p
    .getByRole("button", { name: "Show Recovery Phrase", exact: true })
    .click();
  phrase = await p
    .locator("ol li")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.lastChild?.textContent).join(" "),
    );
  const birthday = Number(
    (await p.getByText("Wallet birthday:").innerText()).match(
      /birthday:\s*(\d+)/,
    )?.[1],
  );
  await p
    .getByRole("button", { name: "Hide Recovery Phrase", exact: true })
    .click();
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "I saved my backup" }).click();
  await expect(p.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 180000,
  });
  result.createdAndSynced = true;
  const address = await receive(p);
  step = "restore";
  const r = await restored.newPage();
  r.setDefaultTimeout(120000);
  await r.goto(origin + "/wallet/testnet");
  await r
    .getByRole("button", { name: "Import / Restore Wallet", exact: true })
    .click();
  await fill(r);
  await r.getByLabel("Recovery phrase", { exact: true }).fill(phrase);
  await r.getByLabel("Wallet birthday block").fill(String(birthday));
  await r.getByRole("button", { name: "Restore and synchronize" }).click();
  await expect(r.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 180000,
  });
  expect(await receive(r)).toBe(address);
  result.restoredSameIdentity = true;
  result.recoveryScanCompleted = true;
  step = "persistence";
  await r.getByRole("button", { name: "Lock wallet", exact: true }).click();
  await r.reload();
  await r.getByRole("button", { name: "Unlock Existing Wallet" }).click();
  await r.getByLabel("Wallet password", { exact: true }).fill(password);
  await r.getByRole("button", { name: "Unlock wallet", exact: true }).click();
  await expect(r.getByText("Synced", { exact: true })).toBeVisible({
    timeout: 180000,
  });
  expect(await receive(r)).toBe(address);
  result.relockUnlockIdentity = true;
  const serialized = JSON.stringify(
    await restored.storageState({ indexedDB: true }),
  );
  expect(serialized.includes(phrase) || serialized.includes(password)).toBe(
    false,
  );
  result.noPlaintextPersistence = true;
  // Attempt import directly through the real worker to verify the durable overwrite guard.
  await r.getByRole("button", { name: "Lock wallet", exact: true }).click();
  const guard = await r.evaluate(async () => {
    const w = new Worker("/zcash-wallet/wallet.worker.mjs", { type: "module" });
    try {
      return await new Promise<string>((resolve) => {
        w.onmessage = ({ data }) => {
          if (data.id === "guard") resolve(data.error);
        };
        w.postMessage({
          id: "guard",
          method: "restore",
          args: {
            phrase: "invalid",
            password: "invalid-password",
            birthday: 280000,
          },
        });
      });
    } finally {
      w.terminate();
    }
  });
  expect(guard).toBe("WALLET_EXISTS");
  result.existingVaultRejectedImport = true;
  expect(
    observed.some(
      (value) => value.includes(phrase) || value.includes(password),
    ),
  ).toBe(false);
  result.noSecretsInObservedConsoleOrHttp = true;
  result.passed = true;
} catch {
  result.passed = false;
  result.failedStep = step;
  process.exitCode = 1;
} finally {
  phrase = "";
  await created.close();
  await restored.close();
  await browser.close();
  writeFileSync(
    "artifacts/zcash-wallet/premium-recovery.json",
    JSON.stringify(result, null, 2),
  );
}
console.log(JSON.stringify(result));
