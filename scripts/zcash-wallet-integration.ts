// Navigation and lifecycle regression with an explicitly MOCKED provider.
// This does not prove extension compatibility or blockchain spending.
import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const origin = process.env.ZYRO_WALLET_QA_ORIGIN || "http://127.0.0.1:3202";
const address = JSON.parse(
  readFileSync("docs/evidence/zcash-wallet-phase2-live-attempt.json", "utf8"),
).addresses[0];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  mockedProvider: true,
};
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('a[href="/wallet"]').first().click();
  await expect(page.getByLabel("Testnet wallet onboarding")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("Integration Status");
  await page.getByRole("link", { name: /Open ZYRO Wallet/ }).click();
  await expect(
    page.getByRole("button", { name: "Create New Wallet", exact: true }),
  ).toBeEnabled();
  if (page.url().includes("signin"))
    throw Error("Wallet requires Google login");
  await page.goBack();
  await expect(page.getByLabel("Testnet wallet onboarding")).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("link", { name: /Connect Noir instead/ }),
  ).toBeVisible();
  results.navigation = true;
  await context.close();
  for (const host of ["127.0.0.1", "localhost"]) {
    const mocked = await browser.newContext();
    await mocked.addInitScript(
      ({ address }) => {
        const listeners = new Map<string, Set<(payload: unknown) => void>>();
        const qa = {
          connected: sessionStorage.getItem("qa-authorized") === "yes",
          calls: [] as string[],
          network: "testnet",
          reject: false,
          emit(event: string, payload: unknown) {
            for (const listener of listeners.get(event) || [])
              listener(payload);
          },
        };
        (window as any).__qa = qa;
        setTimeout(() => {
          (window as any).noirwallet = {
            isNoirWallet: true,
            version: "1.0.41",
            zcash: {
              on(event: string, callback: (payload: unknown) => void) {
                if (!listeners.has(event)) listeners.set(event, new Set());
                listeners.get(event)!.add(callback);
              },
              removeListener(
                event: string,
                callback: (payload: unknown) => void,
              ) {
                listeners.get(event)?.delete(callback);
              },
              async request({ method }: { method: string }) {
                qa.calls.push(method);
                const selected =
                  qa.network === "testnet" ? address : "u1mainnet";
                if (method === "zcash_requestAccounts") {
                  if (qa.reject)
                    throw Object.assign(Error("User rejected"), { code: 4001 });
                  qa.connected = true;
                  sessionStorage.setItem("qa-authorized", "yes");
                }
                if (method === "zcash_disconnect") {
                  qa.connected = false;
                  return null;
                }
                if (method === "zcash_getBalance")
                  return {
                    spendable: "1",
                    shielded: "1",
                    transparent: "0",
                    accounts: [{ id: "qa", synced: true }],
                  };
                return qa.connected
                  ? {
                      shielded: selected,
                      transparent: "test",
                      accounts: [
                        {
                          id: "qa",
                          addresses: {
                            shielded: selected,
                            transparent: "test",
                          },
                        },
                      ],
                    }
                  : null;
              },
            },
          };
          window.dispatchEvent(new Event("noirwallet#initialized"));
        }, 600);
      },
      { address },
    );
    const p = await mocked.newPage();
    p.setDefaultTimeout(90000);
    await p.goto(
      origin.replace("127.0.0.1", host) + "/wallet/testnet?connect=noir",
    );
    await expect(p.getByLabel("Noir Wallet connection")).toContainText(
      "No account authorized",
    );
    expect(
      await p.evaluate(() =>
        (window as any).__qa.calls.includes("zcash_requestAccounts"),
      ),
    ).toBe(false);
    await p.evaluate(() => {
      (window as any).__qa.reject = true;
    });
    await p
      .getByRole("button", { name: "Connect Noir Wallet", exact: true })
      .click();
    await expect(p.getByLabel("Noir Wallet connection")).toContainText(
      "Connection rejected",
    );
    await p.evaluate(() => {
      (window as any).__qa.reject = false;
    });
    await p
      .getByRole("button", { name: "Connect Noir Wallet", exact: true })
      .click();
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toBeVisible();
    await p.reload();
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    expect(
      await p.evaluate(() =>
        (window as any).__qa.calls.includes("zcash_requestAccounts"),
      ),
    ).toBe(false);
    await p.evaluate(() => {
      (window as any).__qa.emit("accountsChanged", []);
    });
    await expect(p.getByLabel("Noir Wallet connection")).toContainText(
      "locked",
    );
    await p
      .getByRole("button", { name: "Connect Noir Wallet", exact: true })
      .click();
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toBeVisible();
    await p.evaluate(() => {
      const qa = (window as any).__qa;
      qa.network = "mainnet";
      qa.emit("accountsChanged", {});
    });
    await expect(p.getByLabel("Noir Wallet connection")).toContainText(
      "Wrong network",
    );
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toHaveCount(0);
    await p.evaluate(() => {
      const qa = window.__qa;
      qa.network = "testnet";
      qa.emit("accountsChanged", {});
    });
    // The event silently reconnects the already authorized account.
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await p.getByRole("button", { name: "Receive", exact: true }).click();
    await p.keyboard.press("Escape");
    await p
      .getByRole("button", { name: "Disconnect Noir Wallet", exact: true })
      .click();
    await expect(
      p.getByRole("button", { name: "Lock wallet", exact: true }),
    ).toHaveCount(0);
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toHaveCount(0);
    await p.goto(origin.replace("127.0.0.1", host) + "/testnet", {
      waitUntil: "networkidle",
    });
    await p.getByRole("link", { name: /Connect Noir Wallet/ }).click();
    await expect(
      p.getByText("NOIR EXTENSION WALLET", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    expect(
      await p.evaluate(() =>
        (window as any).__qa.calls.includes("zcash_requestAccounts"),
      ),
    ).toBe(true);
    await p.getByRole("button", { name: "Receive", exact: true }).click();
    await p.evaluate(() => (window as any).__qa.emit("accountsChanged", []));
    await expect(p.getByRole("dialog")).toHaveCount(0);
    results[host] = true;
    await mocked.close();
  }
  results.passed = true;
} finally {
  writeFileSync(
    "artifacts/zcash-wallet/integration.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(results));
