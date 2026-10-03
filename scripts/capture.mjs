import fs from "node:fs";
import { chromium } from "@playwright/test";

/**
 * Captures real product screenshots from a live deployment.
 * Usage: BASE_URL=https://... node scripts/capture.mjs
 *
 * Uses explicit element waits rather than networkidle: label lookups against
 * two public APIs keep the network busy on a page that is otherwise idle.
 */

const base = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
fs.mkdirSync("public", { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

async function settle(ms = 1200) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(ms);
}

await page.goto(base, { waitUntil: "domcontentloaded" });
await settle(2000);
const startButton = page.getByRole("button", { name: "Open the worked example" });
await startButton.waitFor({ timeout: 60_000 });
await startButton.click({ timeout: 60_000 });
await page.waitForURL(/\/boards\/[a-z0-9_]+/i, { timeout: 90_000 });
await page.getByText("Handover readiness").first().waitFor({ timeout: 60_000 });
await settle(2500);
await page.screenshot({ path: "public/hero-card.png" });
console.log("captured board");

const boardId = page.url().split("/").pop();

await page.goto(`${base}/handover?board=${boardId}`, { waitUntil: "domcontentloaded" });
await page.getByText("Readiness at this moment").waitFor({ timeout: 60_000 });
await settle(2500);
await page.screenshot({ path: "public/handover-scrubber.png" });
console.log("captured handover");

await page.goto(`${base}/boards/${boardId}/regimen`, { waitUntil: "domcontentloaded" });
await page.getByText("openFDA + RxNorm").waitFor({ timeout: 60_000 });
await settle(3500);
await page.screenshot({ path: "public/regimen.png" });
console.log("captured regimen");

await browser.close();