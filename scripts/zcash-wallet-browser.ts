// Deliberate browser verification. No claims or sends unless explicitly opted in.
import { chromium, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.ZYRO_WALLET_QA_ORIGIN || "http://127.0.0.1:3202";
const live = process.env.ZYRO_WALLET_LIVE === "1";
const password = randomBytes(24).toString("hex");
const testSecrets = new Set([password]);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const alice = await browser.newContext(),
  bob = await browser.newContext();
const errors: string[] = [];
const evidence: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  liveClaimsEnabled: live,
};
await mkdir("artifacts/zcash-wallet", { recursive: true });
async function create(page: Page) {
  await page.bringToFront();
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/wallet/testnet");
  if (page.url().includes("signin"))
    throw Error("Anonymous wallet redirected to sign-in");
  await page
    .getByRole("button", { name: "Create New Wallet", exact: true })
    .click();
  await page.getByLabel("New wallet password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create encrypted wallet" }).click();
  await page.getByRole("heading", { name: "Back up your wallet" }).waitFor();
  // Keep phrase in test memory only. It never appears in logs or artifacts.
  await page
    .getByRole("button", { name: "Show Recovery Phrase", exact: true })
    .click();
  const phrase = await page
    .locator("ol li")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.lastChild?.textContent).join(" "),
    );
  const birthdayText = await page.getByText("Wallet birthday:").innerText();
  testSecrets.add(phrase);
  const birthday = Number(birthdayText.match(/birthday:\s*(\d+)/)?.[1]);
  await page
    .getByRole("button", { name: "Hide Recovery Phrase", exact: true })
    .click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I saved my backup" }).click();
  await page.getByText("Synced", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Receive", exact: true }).click();
  const address = await page
    .getByRole("dialog")
    .locator("p")
    .filter({ hasText: /^utest1/ })
    .innerText();
  await page.keyboard.press("Escape");
  return { address, phrase, birthday };
}
async function keepUnlocked(page: Page) {
  await page.bringToFront();
  if (
    await page
      .getByRole("button", { name: "Unlock Existing Wallet", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Unlock Existing Wallet", exact: true })
      .click();
    await page.getByLabel("Wallet password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Unlock wallet", exact: true })
      .click();
    await page.getByText("Synced", { exact: true }).waitFor();
  }
  // Exercise normal user activity rather than disabling production auto-lock.
  await page.mouse.click(30, 110);
}
try {
  const a = await alice.newPage(),
    b = await bob.newPage();
  const first = await create(a);
  if (live) {
    await a.getByRole("button", { name: "Get TAZ", exact: true }).click();
    await a.getByRole("button", { name: "Request TAZ from Fauzec" }).click();
    await a.waitForFunction(() =>
      Object.keys(localStorage).some((k) =>
        k.startsWith("zyro:testnet:fauzec:"),
      ),
    );
    console.log("DELIBERATE_CLAIM_SUBMITTED_ONCE");
    await a.keyboard.press("Escape");
  }
  const second = await create(b);
  await a.bringToFront();
  evidence.addresses = [first.address, second.address];
  evidence.birthday = first.birthday;
  for (const width of [390, 768, 1440]) {
    await a.setViewportSize({ width, height: 1000 });
    if (
      await a.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error(`Overflow at ${width}`);
    await a.screenshot({
      path: `artifacts/zcash-wallet/wallet-${width}.png`,
      fullPage: true,
    });
  }
  await a.getByRole("button", { name: "Lock wallet", exact: true }).click();
  await a.reload();
  await a.bringToFront(); // Background tabs intentionally defer periodic scans.
  evidence.phase = "unlock-after-reload";
  await a.getByRole("button", { name: "Unlock Existing Wallet" }).click();
  await a
    .getByLabel("Wallet password", { exact: true })
    .fill("incorrect-password");
  await a.getByRole("button", { name: "Unlock wallet", exact: true }).click();
  await a
    .getByRole("alert")
    .filter({ hasText: "Incorrect password" })
    .waitFor();
  await a.getByLabel("Wallet password", { exact: true }).fill(password);
  await a.getByRole("button", { name: "Unlock wallet", exact: true }).click();
  await a.getByText("Synced", { exact: true }).waitFor();
  await a.getByRole("button", { name: "Receive", exact: true }).click();
  if (
    (await a
      .getByRole("dialog")
      .locator("p")
      .filter({ hasText: /^utest1/ })
      .innerText()) !== first.address
  )
    throw Error("Refresh changed wallet identity");
  await a.keyboard.press("Escape");
  const restored = await browser.newContext();
  try {
    const p = await restored.newPage();
    p.setDefaultTimeout(120000);
    await p.goto(origin + "/wallet/testnet");
    await p.bringToFront();
    evidence.phase = "restore";
    await p
      .getByRole("button", { name: "Import / Restore Wallet", exact: true })
      .click();
    await p.getByLabel("Recovery phrase", { exact: true }).fill(first.phrase);
    await p.getByLabel("Wallet birthday block").fill(String(first.birthday));
    await p.getByLabel("New wallet password", { exact: true }).fill(password);
    await p.getByLabel("Confirm password", { exact: true }).fill(password);
    await p.getByRole("button", { name: "Restore and synchronize" }).click();
    await p.getByText("Synced", { exact: true }).waitFor();
    await p.getByRole("button", { name: "Receive", exact: true }).click();
    if (
      (await p
        .getByRole("dialog")
        .locator("p")
        .filter({ hasText: /^utest1/ })
        .innerText()) !== first.address
    )
      throw Error("Restore changed wallet identity");
    await p.keyboard.press("Escape");
    evidence.restoreIdentity = true;
  } finally {
    await restored.close();
  }
  await a.bringToFront();
  const stored = await alice.storageState({ indexedDB: true });
  if (
    JSON.stringify(stored).includes(first.phrase) ||
    JSON.stringify(stored).includes(password)
  )
    throw Error("Plaintext secret persisted");
  evidence.encryptedPersistence = true;
  if (live) {
    // Exactly one deliberate Fauzec claim; no retries or address rotation.
    evidence.faucetReceipt = await a.evaluate(() =>
      Object.entries(localStorage)
        .filter(([k]) => k.startsWith("zyro:testnet:fauzec:"))
        .map(([, v]) => JSON.parse(v)),
    );
    console.log("FAUCET_RECEIPT", JSON.stringify(evidence.faucetReceipt));
    // Wait up to 12 minutes for independently scanned, spendable funds.
    const deadline = Date.now() + 720000;
    while (Date.now() < deadline) {
      await keepUnlocked(a);
      const value = await a
        .getByText(/^Available [0-9]/)
        .innerText()
        .then((text) => text.match(/[0-9]+\.[0-9]+/)?.[0] || "");
      if (/^\d+\.\d+$/.test(value) && Number(value) > 0.02) break;
      const error = await a.getByRole("alert").allTextContents();
      if (error.filter(Boolean).length)
        throw Error(error.filter(Boolean).join(" "));
      console.log("WAITING_FOR_CONFIRMED_FUNDS");
      await a.waitForTimeout(30000);
    }
    await a.getByRole("button", { name: "Send", exact: true }).click();
    await a
      .getByLabel("Recipient testnet Unified Address")
      .fill(second.address);
    await a.getByLabel("Amount in TAZ").fill("0.01");
    await a.getByRole("button", { name: "Review amount and fee" }).click();
    await a
      .getByRole("button", { name: "Authorize shielded transfer" })
      .click();
    await a
      .getByText("Submitted", { exact: true })
      .waitFor({ timeout: 300000 });
    evidence.submitted = true;
    evidence.sentAmountZats = "1000000";
    evidence.submittedTxids = await a
      .locator("code")
      .allTextContents()
      .then((values) => values.filter((value) => /^[0-9a-f]{64}$/.test(value)));
    await a.screenshot({
      path: "artifacts/zcash-wallet/submitted.png",
      fullPage: true,
    });
    const confirmationDeadline = Date.now() + 720000;
    while (Date.now() < confirmationDeadline) {
      await keepUnlocked(b);
      const received = await b
        .getByText("Confirmed balance", { exact: true })
        .locator("..")
        .locator("strong")
        .innerText();
      if (received.trim().startsWith("0.01000000")) {
        evidence.receiverConfirmed = true;
        break;
      }
      console.log("WAITING_FOR_TRANSFER_CONFIRMATION");
      await b.waitForTimeout(30000);
    }
    await a.getByRole("button", { name: "Activity", exact: true }).click();
    evidence.senderHistory = await a
      .locator("main")
      .last()
      .getByRole("heading", { name: "Activity", exact: true })
      .locator("..")
      .innerText();
    if (!evidence.receiverConfirmed)
      throw Error(
        "Receiving wallet did not confirm within the verification window",
      );
  }
  if (errors.length) throw Error(errors.join("; "));
  evidence.browserErrors = errors;
  evidence.completed = true;
} catch (e) {
  evidence.completed = false;
  let message = e instanceof Error ? e.message : "Verification failed";
  for (const secret of testSecrets)
    message = message.split(secret).join("[redacted]");
  evidence.error = message;
  process.exitCode = 1;
} finally {
  await writeFile(
    "artifacts/zcash-wallet/browser-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
  await browser.close();
}
