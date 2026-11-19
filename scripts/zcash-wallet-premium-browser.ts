// UI fixtures are injected only into an isolated browser context, never production.
import { chromium, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const origin = process.env.ZYRO_WALLET_QA_ORIGIN || "http://127.0.0.1:3202";
const address = JSON.parse(
  readFileSync("docs/evidence/zcash-wallet-phase2-live-attempt.json", "utf8"),
).addresses[0];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results: { name: string; status: string; error?: string }[] = [];
const context = await browser.newContext();
try {
  const page = await context.newPage();
  await context.route("**/zcash-wallet/wallet.worker.mjs", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      headers: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
      body: `
    let exists=false;
    const state={kind:"embedded",address:${JSON.stringify(address)},synced:true,lastSync:Date.now(),confirmed:"20000000",spendable:"20000000",pending:"0",birthday:4134000,history:[{txid:"a".repeat(64),kind:"received",amount:"20000000",status:"Confirmed",timestamp:1700000000}]};
    self.fixtureState=state;
    self.onmessage=async({data:{id,method,args}})=>{
      self.fixtureCalls = [...(self.fixtureCalls || []), method];
      let result=state,error;
      if(method==='exists') result=exists;
      if(method==='create'){exists=true;result={...state,phrase:Array(23).fill('abandon').concat('art').join(' ')};}
      if(method==='restore'){if(exists)error='WALLET_EXISTS';else if(args.phrase!==Array(23).fill('abandon').concat('art').join(' '))error='INVALID_PHRASE';else exists=true;}
      if(method==='unlock'&&args.password!=='fixture-password')error='UNLOCK_FAILED';
      self.postMessage({id,result,error});
    };
  `,
    }),
  );
  page.setDefaultTimeout(15000);
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, status: "passed" });
    } catch (e) {
      results.push({
        name,
        status: "failed",
        error:
          (e instanceof Error ? e.message : "failed") +
          (name.startsWith("Sync progress")
            ? "\n" +
              (await page
                .locator('section[aria-label="Zcash testnet wallet"]')
                .innerText())
            : ""),
      });
      throw e;
    }
  };
  await context.route("**/wallet/testnet/api/faucet/network", (r) =>
    r.fulfill({
      json: {
        drip_zat: 100000000,
        address_cooldown_hours: 24,
        captcha_mode: "turnstile",
      },
    }),
  );
  await page.goto(origin + "/testnet");
  await check("Exactly two entry choices; diagnostics absent", async () => {
    await expect(
      page.getByRole("link", { name: /Open ZYRO Wallet/ }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: /Connect Noir Wallet/ }),
    ).toHaveCount(1);
    await expect(
      page.locator('section[aria-label="Testnet wallet onboarding"] h2'),
    ).toHaveCount(2);
    await expect(page.locator("main")).not.toContainText(
      /Integration Status|Observed height|Zealit|regtest|Discover shielded/,
    );
  });
  await page.getByRole("link", { name: /Open ZYRO Wallet/ }).click();
  await check(
    "Embedded onboarding offers create and restore without Google",
    async () => {
      await expect(
        page.getByRole("button", { name: "Create New Wallet", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", {
          name: "Import / Restore Wallet",
          exact: true,
        }),
      ).toBeEnabled();
      expect(page.url()).not.toContain("signin");
    },
  );
  await page
    .getByRole("button", { name: "Import / Restore Wallet", exact: true })
    .click();
  await check(
    "Mnemonic input masked; deliberate reveal preserves value",
    async () => {
      const input = page.getByLabel("Recovery phrase", { exact: true });
      await input.fill("invalid recovery words");
      await expect(input).toHaveAttribute("type", "password");
      await page
        .getByRole("button", { name: "Show recovery phrase", exact: true })
        .click();
      await expect(input).toHaveAttribute("type", "text");
      await page
        .getByRole("button", { name: "Hide recovery phrase", exact: true })
        .click();
      await expect(input).toHaveValue("invalid recovery words");
    },
  );
  await page
    .getByLabel("New wallet password", { exact: true })
    .fill("fixture-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("fixture-password");
  await check("Password visibility remains deliberate", async () => {
    const input = page.getByLabel("New wallet password", { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await page
      .getByRole("button", { name: "Show new wallet password", exact: true })
      .click();
    await expect(input).toHaveAttribute("type", "text");
    await page
      .getByRole("button", { name: "Hide new wallet password", exact: true })
      .click();
    await expect(input).toHaveValue("fixture-password");
  });
  await check(
    "Invalid mnemonic error cannot become dashboard (worker fixture)",
    async () => {
      await page
        .getByRole("button", { name: "Restore and synchronize" })
        .click();
      await expect(
        page.locator(
          'section[aria-label="Zcash testnet wallet"] [role="alert"]',
        ),
      ).toContainText("recovery phrase is invalid");
      await expect(
        page.getByRole("button", { name: "Receive", exact: true }),
      ).toHaveCount(0);
    },
  );
  await page
    .getByRole("button", { name: /Back/, exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Create New Wallet", exact: true })
    .click();
  await page
    .getByLabel("New wallet password", { exact: true })
    .fill("fixture-password");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("fixture-password");
  await page.getByRole("button", { name: "Create encrypted wallet" }).click();
  await check(
    "Creation backup masked by default; reveal and hide",
    async () => {
      await expect(page.locator("ol")).not.toContainText("abandon");
      await page
        .getByRole("button", { name: "Show Recovery Phrase", exact: true })
        .click();
      await expect(page.locator("ol")).toContainText("abandon");
      await page
        .getByRole("button", { name: "Hide Recovery Phrase", exact: true })
        .click();
      await expect(page.locator("ol")).not.toContainText("abandon");
    },
  );
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "I saved my backup" }).click();
  await check(
    "Default dashboard hides QR, faucet, activity and phrase",
    async () => {
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("img[alt*=QR]")).toHaveCount(0);
      await expect(page.locator("ol")).toHaveCount(0);
      await expect(
        page.getByText("0.20000000", { exact: false }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Activity", exact: true }),
      ).toHaveCount(0);
    },
  );
  await check(
    "Receive uses active address and local QR; Escape cleans panel",
    async () => {
      await page.getByRole("button", { name: "Receive", exact: true }).click();
      const d = page.getByRole("dialog");
      await expect(d).toContainText(address);
      await expect(d.locator("img")).toHaveAttribute("src", /^data:image\/png/);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Receive", exact: true }),
      ).toBeFocused();
      await expect(page.locator("img[alt*=QR]")).toHaveCount(0);
    },
  );
  await check(
    "Faucet appears deliberately and preserves human verification",
    async () => {
      await page.getByRole("button", { name: "Get TAZ", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText(address);
      await expect(
        page.getByRole("link", { name: /Open official Fauzec/ }),
      ).toHaveAttribute("href", "https://fauzec.com/");
      await expect(
        page.getByRole("button", { name: "Request TAZ from Fauzec" }),
      ).toBeDisabled();
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "Activity displays only supplied history and expandable full ID",
    async () => {
      await page.getByRole("button", { name: "Activity", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("Received");
      await expect(page.getByRole("dialog")).toContainText("Confirmed");
      await page.locator("summary").click();
      await expect(page.locator("details code")).toHaveText("a".repeat(64));
      await page.keyboard.press("Escape");
    },
  );
  await check("Opening panels does not restart scans", async () => {
    expect(
      (
        await page.workers()[0].evaluate(() => (self as any).fixtureCalls)
      ).filter((m: string) => m === "sync").length,
    ).toBeLessThanOrEqual(1);
  });
  await check("Send opens review form without submitting", async () => {
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.getByLabel("Recipient testnet Unified Address"),
    ).toBeVisible();
    expect(
      await page
        .workers()[0]
        .evaluate(() => (self as any).fixtureCalls.includes("send")),
    ).toBe(false);
    await page.keyboard.press("Escape");
  });
  await check(
    "Sync progress keeps only explicitly stale cached balances and blocks sending",
    async () => {
      await page.workers()[0].evaluate(() => {
        Object.assign((self as any).fixtureState, {
          synced: false,
          confirmed: undefined,
          spendable: undefined,
          pending: undefined,
        });
      });
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Refresh balance", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Close panel" }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(page.getByText(/Cached · last checked/)).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Send", exact: true }),
      ).toBeDisabled();
      await page
        .workers()[0]
        .evaluate(() =>
          Object.assign((self as any).fixtureState, {
            synced: true,
            confirmed: "20000000",
            spendable: "20000000",
            pending: "0",
          }),
        );
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Refresh balance", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Close panel" }),
      ).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Send", exact: true }),
      ).toBeEnabled();
    },
  );
  await check("Native modal keeps keyboard focus contained", async () => {
    await page.getByRole("button", { name: "Receive", exact: true }).click();
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => !!document.activeElement?.closest("dialog")),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
  });
  await check(
    "Mobile tablet desktop fit without horizontal overflow",
    async () => {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.evaluate(() => {
          (document.activeElement as HTMLElement)?.blur();
          window.scrollTo(0, 0);
        });
        await page.screenshot({
          path: `artifacts/zcash-wallet/premium-dashboard-${width}.png`,
          fullPage: true,
          animations: "disabled",
        });
        await page
          .getByRole("button", { name: "Receive", exact: true })
          .click();
        expect(
          await page
            .getByRole("dialog")
            .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        ).toBe(true);
        if (width === 390 || width === 1440)
          await page.screenshot({
            path: `artifacts/zcash-wallet/premium-receive-${width}.png`,
            animations: "disabled",
          });
        await page.keyboard.press("Escape");
      }
    },
  );
  await check(
    "Lock clears panels and preserves existing-vault guard",
    async () => {
      await page
        .getByRole("button", { name: "Lock wallet", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Unlock Existing Wallet" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Create New Wallet", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", {
          name: "Import / Restore Wallet",
          exact: true,
        }),
      ).toBeDisabled();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("img[alt*=QR]")).toHaveCount(0);
    },
  );
} finally {
  await context.close();
  await browser.close();
  writeFileSync(
    "artifacts/zcash-wallet/premium-browser.json",
    JSON.stringify(
      {
        mockedWorker: true,
        results,
        passed: results.filter((r) => r.status === "passed").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify(results));
