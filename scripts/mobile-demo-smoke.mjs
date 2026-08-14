import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// `localhost` matters for `next dev`: Chromium's mobile context can fail the
// HMR WebSocket handshake on 127.0.0.1, leaving the client shell unhydrated.
const baseUrl = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const artifactDir = process.env.DEMO_ARTIFACT_DIR ?? "/tmp/favour-demo";
const expectedAppId = process.env.DEMO_WORLD_APP_ID;
const REGISTERED_APP_ID_SHA256 =
  "798366edf03e1213c4f673981e2107d6bdc0bfce7af7e5bddb62cef88111174c";
if (!expectedAppId || !/^app_[0-9a-f]{32}$/i.test(expectedAppId)) {
  throw new Error(
    "DEMO_WORLD_APP_ID must be the exact registered World App ID (app_ + 32 hex characters)",
  );
}
const appIdHash = createHash("sha256").update(expectedAppId).digest("hex");
if (appIdHash !== REGISTERED_APP_ID_SHA256) {
  throw new Error("DEMO_WORLD_APP_ID does not match FAVOUR's registered app");
}
const testedRevision = await runningRevision(baseUrl);
const viewports = [
  { name: "narrow", width: 320, height: 700 },
  { name: "iphone", width: 390, height: 844 },
  { name: "large", width: 430, height: 932 },
  { name: "landscape", width: 740, height: 360 },
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
const startedAt = new Date();
const checks = [];
let failures = 0;

try {
  const desktopStartedAt = Date.now();
  try {
    await assertDesktopHandoff(browser);
    checks.push({
      name: "desktop-qr-handoff",
      viewport: "1024x800",
      status: "passed",
      durationMs: Date.now() - desktopStartedAt,
      screenshot: "desktop-qr-handoff.png",
    });
    console.log("PASS desktop QR handoff");
  } catch (error) {
    failures += 1;
    checks.push({
      name: "desktop-qr-handoff",
      viewport: "1024x800",
      status: "failed",
      durationMs: Date.now() - desktopStartedAt,
      error: errorMessage(error),
    });
    console.error("FAIL desktop QR handoff:", error);
  }

  for (const viewport of viewports) {
    const checkStartedAt = Date.now();
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const unexpectedWrites = await guardApiWrites(context);
    const page = await context.newPage();

    try {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByRole("button", { name: "Get started" }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await page.getByRole("button", { name: "I agree" }).click();

      const handoff = page.getByRole("link", { name: "Open in World App" });
      await handoff.waitFor();
      assertWorldAppHref(await handoff.getAttribute("href"));
      assert.equal(
        await page.getByLabel("Scan to open FAVOUR in World App").isVisible(),
        false,
        "QR must stay hidden on phone-sized and short landscape viewports",
      );

      // Exercise the shell without creating a preview identity. Remote smoke
      // runs must remain read-only and must not pollute production analytics.
      await page.goto(appUrl("/polls"), { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.getByRole("navigation", { name: "Main navigation" }).waitFor();

      for (const route of routes) {
        if (new URL(page.url()).pathname !== route.path) {
          await page.getByRole("button", { name: route.label }).click();
        }
        await page.waitForURL((url) => url.pathname === route.path, { timeout: 15_000 });
        await assertMobileShell(page, viewport.width);
      }
      assert.deepEqual(unexpectedWrites, [], "smoke gate attempted to mutate an application API");

      await page.screenshot({
        path: join(artifactDir, `${viewport.name}-${viewport.width}.png`),
        fullPage: true,
      });
      checks.push({
        name: `mobile-shell-${viewport.name}`,
        viewport: `${viewport.width}x${viewport.height}`,
        status: "passed",
        durationMs: Date.now() - checkStartedAt,
        screenshot: `${viewport.name}-${viewport.width}.png`,
      });
      console.log(`PASS ${viewport.width}x${viewport.height}`);
    } catch (error) {
      failures += 1;
      checks.push({
        name: `mobile-shell-${viewport.name}`,
        viewport: `${viewport.width}x${viewport.height}`,
        status: "failed",
        durationMs: Date.now() - checkStartedAt,
        error: errorMessage(error),
      });
      console.error(`FAIL ${viewport.width}x${viewport.height}:`, error);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const summary = {
  schemaVersion: 1,
  status: failures === 0 ? "passed" : "failed",
  scope: "browser-only; physical World App preflight remains required",
  baseUrl: sanitizedBaseUrl(baseUrl),
  revision: testedRevision,
  appIdFingerprint: appIdHash.slice(0, 12),
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  checks,
};
await writeFile(
  join(artifactDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

if (failures > 0) {
  throw new Error(`${failures} demo check${failures === 1 ? "" : "s"} failed`);
}

console.log(`Demo gate passed. Evidence: ${join(artifactDir, "summary.json")}`);

async function assertDesktopHandoff(browserInstance) {
  const context = await browserInstance.newContext({
    viewport: { width: 1024, height: 800 },
    deviceScaleFactor: 1,
  });
  const unexpectedWrites = await guardApiWrites(context);
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "I agree" }).click();

    const handoff = page.getByRole("link", { name: "Open in World App" });
    await handoff.waitFor();
    assertWorldAppHref(await handoff.getAttribute("href"));
    await page.getByLabel("Scan to open FAVOUR in World App").waitFor();
    await page.getByText("Scan with your phone").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(artifactDir, "desktop-qr-handoff.png"),
      fullPage: true,
    });
    assert.deepEqual(unexpectedWrites, [], "desktop handoff check attempted an API mutation");
  } finally {
    await context.close();
  }
}

function assertWorldAppHref(href) {
  assert.ok(href, "World App handoff link is missing");
  const url = new URL(href);
  assert.equal(url.origin, "https://world.org");
  assert.equal(url.pathname, "/mini-app");
  assert.equal(url.searchParams.get("app_id"), expectedAppId);
  assert.equal(url.searchParams.get("path"), "/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runningRevision(value) {
  const base = new URL(value);
  const healthUrl = new URL("/api/health", base);
  healthUrl.search = base.search;
  const response = await fetch(healthUrl);
  assert.ok(response.ok, `health check failed with HTTP ${response.status}`);
  const health = await response.json();
  assert.match(
    health.revision ?? "",
    /^[0-9a-f]{40}$/i,
    "running app does not expose a build-bound commit revision",
  );
  return health.revision;
}

function sanitizedBaseUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function appUrl(path) {
  const base = new URL(baseUrl);
  const url = new URL(path, base);
  url.search = base.search;
  return url.toString();
}

async function guardApiWrites(context) {
  const unexpectedWrites = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;

    if (method === "POST" && pathname === "/api/track") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      unexpectedWrites.push(`${method} ${pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return unexpectedWrites;
}

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
