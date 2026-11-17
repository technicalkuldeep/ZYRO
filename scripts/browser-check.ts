import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:3000/markets");
  await page.getByRole("heading", { name: "What happens next?" }).waitFor();
  await page.locator(".market-card").first().waitFor();
  await page.getByRole("searchbox").fill("no such challenge");
  await page.getByText("No matching challenges").waitFor();
  await page.getByRole("searchbox").fill("");
  await page.getByRole("searchbox").blur();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: "artifacts/markets-desktop.png",
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3000/create");
  await page
    .getByLabel("YES/NO question")
    .fill("Will ZYRO pass the browser integration test?");
  await page
    .getByLabel("Description")
    .fill(
      "A browser-created challenge used to verify the complete create and acceptance flow against the persistent backend.",
    );
  await page.getByLabel("Join before").fill("2026-12-20T12:00");
  await page.getByLabel("Resolve after").fill("2026-12-21T12:00");
  await page
    .getByLabel("Official HTTPS resolution source")
    .fill("https://github.com/technicalkuldeep/ZYRO");
  await page
    .getByLabel("Resolution rules")
    .fill(
      "YES if the browser test creates this challenge and verifies an acceptance receipt; otherwise NO.",
    );
  await page
    .getByRole("button", { name: "Create challenge", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Will ZYRO pass the browser integration test?",
    })
    .waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign acceptance" }).click();
  await page
    .getByText("Acceptance recorded and verified. No funds have moved.")
    .waitFor();
  const detailPath = new URL(page.url()).pathname;
  const opponent = await browser.newContext();
  const opponentPage = await opponent.newPage();
  opponentPage.on("pageerror", (e) => errors.push(e.message));
  await opponentPage.goto("http://127.0.0.1:3000" + detailPath + "?side=NO");
  await opponentPage.getByRole("checkbox").check();
  await opponentPage
    .getByRole("button", { name: "Sign acceptance · NO", exact: true })
    .click();
  await opponentPage.getByText(/^MATCHED · testnet$/).waitFor();
  await opponent.close();
  await page.goto("http://127.0.0.1:3000/arena");
  await page.getByRole("button", { name: "Lock prediction" }).waitFor();
  await page.getByRole("button", { name: "Lock prediction" }).click();
  await page
    .getByRole("button", { name: "Reveal result", exact: true })
    .click({ timeout: 12000 });
  await page.getByText("Verify the commitment").waitFor();
  await page.locator("body").click({ position: { x: 900, y: 100 } });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: "artifacts/arena-desktop.png",
    fullPage: true,
  });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/",
      "/markets",
      "/arena",
      "/create",
      "/wallet",
      "/dashboard",
      "/about",
      detailPath,
    ]) {
      await page.goto("http://127.0.0.1:3000" + path);
      await page.locator("h1").waitFor();
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow) throw new Error(`Horizontal overflow: ${path} at ${width}`);
    }
    await page.goto("http://127.0.0.1:3000/markets");
    await page.locator(".market-card").first().waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: `artifacts/markets-${width}.png`,
      fullPage: true,
    });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS: create, two-party signed matching, Arena reserve/reveal, 8 routes at 3 widths, no page errors.",
  );
} finally {
  await browser.close();
}
