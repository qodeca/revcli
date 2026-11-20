/**
 * Child process for tests/browser/shutdown.test.ts (issue #33).
 *
 * Starts one browser the way revcli does (same launch options, same signal
 * wiring as src/index.ts, same withBrowserSession as a scrape), on a TEMPORARY
 * profile passed as argv[2], prints "ready", and then stays busy like a
 * running scrape until a signal arrives.
 *
 * It never touches ~/.revcli: the profile must be inside the OS temp
 * directory, and the test also points HOME at a temp directory.
 */
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, sep } from "node:path";
import { chromium } from "playwright";
import {
  browserLaunchOptions,
  installBrowserShutdown,
  trackBrowser,
  withBrowserSession,
} from "../../../src/scraper/browser.js";
import { shutdownSignal } from "../../../src/core/shutdown.js";

const profile = process.argv[2];
const tmpRoot = realpathSync(tmpdir());
if (
  !profile ||
  profile.includes(".revcli") ||
  !(realpathSync(dirname(profile)) + sep).startsWith(tmpRoot + sep)
) {
  process.stderr.write("signal-child: refusing a profile outside the temp directory\n");
  process.exit(2);
}

installBrowserShutdown();

// Same path as a real scrape: a tracked browser inside withBrowserSession,
// which closes it when the shutdown signal aborts.
await withBrowserSession(
  async () => {
    const context = await chromium.launchPersistentContext(
      profile,
      browserLaunchOptions({ headless: true }),
    );
    trackBrowser(context);
    await context.route("**/*", (route) => route.abort());
    const page = context.pages()[0] ?? (await context.newPage());
    return { context, page };
  },
  shutdownSignal,
  async ({ page }) => {
    await page.setContent("<p>signal test</p>");
    process.stdout.write("ready\n");
    // Stay busy like a running scrape until the browser is closed under us.
    await page.waitForTimeout(10 * 60_000);
  },
);
