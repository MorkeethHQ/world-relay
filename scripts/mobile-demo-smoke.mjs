import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// `localhost` matters for `next dev`: Chromium's mobile context can fail the
// HMR WebSocket handshake on 127.0.0.1, leaving the client shell unhydrated.
const baseUrl = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const artifactDir = process.env.DEMO_ARTIFACT_DIR ?? "/tmp/favour-demo";
const viewports = [
  { name: "narrow", width: 320, height: 700 },
  { name: "iphone", width: 390, height: 844 },
  { name: "large", width: 430, height: 932 },
];
const routes = [
  { label: "Polls", path: "/polls" },
  { label: "History", path: "/history" },
  { label: "Ranks", path: "/leaderboard" },
  { label: "Profile", path: "/dashboard" },
  { label: "Favours", path: "/" },
];

await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch();
let failures = 0;

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByRole("button", { name: "Get started" }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "I agree" }).click();

      const handoff = page.getByRole("link", { name: "Open in World App" });
      if (await handoff.isVisible().catch(() => false)) {
        const href = await handoff.getAttribute("href");
        assert.match(href ?? "", /^https:\/\/world\.org\/mini-app\?/);
      }

      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: "Discover favours" }).click();
      await page.getByRole("navigation", { name: "Main navigation" }).waitFor();

      for (const route of routes) {
        await page.getByRole("button", { name: route.label }).click();
        await page.waitForURL((url) => url.pathname === route.path, { timeout: 15_000 });
        await assertMobileShell(page, viewport.width);
      }

      await page.screenshot({
        path: join(artifactDir, `${viewport.name}-${viewport.width}.png`),
        fullPage: true,
      });
      console.log(`PASS ${viewport.width}x${viewport.height}`);
    } catch (error) {
      failures += 1;
      await page.screenshot({
        path: join(artifactDir, `${viewport.name}-${viewport.width}-failure.png`),
        fullPage: true,
      }).catch(() => {});
      console.error(`FAIL ${viewport.width}x${viewport.height}:`, error);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  throw new Error(`${failures} mobile demo viewport${failures === 1 ? "" : "s"} failed`);
}

console.log(`Mobile demo gate passed. Screenshots: ${artifactDir}`);

async function assertMobileShell(page, expectedWidth) {
  const measurements = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main navigation"]');
    const buttons = [...document.querySelectorAll('nav[aria-label="Main navigation"] button')];
    const navRect = nav?.getBoundingClientRect();

    return {
      innerWidth: window.innerWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      navLeft: navRect?.left ?? -1,
      navRight: navRect?.right ?? -1,
      buttonCount: buttons.length,
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
    };
  });

  assert.equal(measurements.innerWidth, expectedWidth);
  assert.ok(
    measurements.rootScrollWidth <= measurements.innerWidth,
    `horizontal overflow: ${measurements.rootScrollWidth}px > ${measurements.innerWidth}px`,
  );
  assert.ok(measurements.navLeft >= 0, `nav begins off-screen at ${measurements.navLeft}px`);
  assert.ok(
    measurements.navRight <= measurements.innerWidth,
    `nav ends off-screen at ${measurements.navRight}px`,
  );
  assert.equal(measurements.buttonCount, 5);
  assert.ok(
    measurements.buttonHeights.every((height) => height >= 44),
    `nav contains a touch target shorter than 44px: ${measurements.buttonHeights.join(", ")}`,
  );
}
