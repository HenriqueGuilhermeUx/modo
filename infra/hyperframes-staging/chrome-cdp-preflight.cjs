"use strict";

// Synthetic-only, offline, non-root CI gate. This script does NOT load any
// project, credentials, customer data or network URL.
// It distinguishes Chrome launch/CDP readiness from HyperFrames rendering.
const puppeteer = require("/opt/hyperframes/node_modules/puppeteer-core");

const BROWSER = "/usr/local/bin/hf-chrome";
const LIMIT_MS = 15_000;
const EXPECTED_VERSION = "152.0.7977.30";
async function limited(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function main() {
  if (process.env.NODE_ENV === "production" ||
      process.getuid?.() !== 10001 ||
      process.env.HYPERFRAMES_BROWSER_PATH !== BROWSER) {
    throw new Error("HYPERFRAMES_CDP_PREFLIGHT_WRONG_SANDBOX");
  }
  let browser;
  const began = Date.now();
  try {
    browser = await limited(puppeteer.launch({
      executablePath: BROWSER,
      headless: true,
      dumpio: false,
      timeout: LIMIT_MS,
      protocolTimeout: 8_000,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", "--disable-background-networking",
        "--no-first-run", "--disable-extensions",
      ],
    }), LIMIT_MS, "HYPERFRAMES_CDP_PREFLIGHT_LAUNCH_TIMEOUT");
    const version = await limited(
      browser.version(), 5_000, "HYPERFRAMES_CDP_PREFLIGHT_VERSION_TIMEOUT");
    if (!version.includes(EXPECTED_VERSION)) {
      throw new Error("HYPERFRAMES_CDP_PREFLIGHT_WRONG_VERSION");
    }
    const page = await limited(
      browser.newPage(), 8_000, "HYPERFRAMES_CDP_PREFLIGHT_NEWPAGE_TIMEOUT");
    const session = await limited(
      page.createCDPSession(), 4_000, "HYPERFRAMES_CDP_PREFLIGHT_SESSION_TIMEOUT");
    await limited(
      session.send("Network.enable"), 5_000,
      "HYPERFRAMES_CDP_PREFLIGHT_NETWORK_ENABLE_TIMEOUT");
    await limited(
      page.goto("data:text/html,%3Ch1%3ESynthetic%20offline%20CDP%3C%2Fh1%3E"),
      5_000, "HYPERFRAMES_CDP_PREFLIGHT_GOTO_TIMEOUT");
    const title = await limited(
      page.evaluate(() => document.querySelector("h1")?.textContent),
      5_000, "HYPERFRAMES_CDP_PREFLIGHT_JS_TIMEOUT");
    if (title !== "Synthetic offline CDP") {
      throw new Error("HYPERFRAMES_CDP_PREFLIGHT_WRONG_PAGE");
    }
    const screenshot = await limited(page.screenshot({ type: "png" }),
      6_000, "HYPERFRAMES_CDP_PREFLIGHT_SCREENSHOT_TIMEOUT");
    if (screenshot.length < 500) {
      throw new Error("HYPERFRAMES_CDP_PREFLIGHT_INVALID_IMAGE");
    }
    await limited(page.close(), 3_000, "HYPERFRAMES_CDP_PREFLIGHT_CLOSE_TIMEOUT");
    process.stdout.write(JSON.stringify({
      cdp: true, offlineSynthetic: true,
      version: EXPECTED_VERSION, milliseconds: Date.now() - began,
    }) + "\n");
  } finally {
    if (browser) {
      await limited(browser.close(), 3_000, "HYPERFRAMES_CDP_PREFLIGHT_SHUTDOWN_TIMEOUT")
        .catch(() => browser.process()?.kill("SIGKILL"));
    }
  }
}
void main().catch(error => {
  const code = error instanceof Error &&
    /^HYPERFRAMES_CDP_PREFLIGHT_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "HYPERFRAMES_CDP_PREFLIGHT_ERROR";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
