import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium, type BrowserContext } from "playwright";
import { browserLaunchOptions, closeOnAbort } from "../../src/scraper/browser.js";
import { scrollAndCollectReviews } from "../../src/scraper/scroller.js";
import { buildMapsPage } from "./fixtures/maps-page.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Issue #33: a location timeout must stop the running scrape and free the
 * persistent profile. Uses a real persistent browser on a TEMPORARY profile
 * (never ~/.revcli), with every network request aborted.
 */

let dir: string | undefined;
const contexts: BrowserContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => {})));
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function launchOn(profile: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(
    profile,
    browserLaunchOptions({ headless: true }),
  );
  contexts.push(context);
  await context.route("**/*", (route) => route.abort());
  return context;
}

describe("closeOnAbort with a persistent profile (issue #33)", () => {
  it("stops a running scroll at once and frees the profile for the next browser", async () => {
    dir = mkdtempSync(join(tmpdir(), "revcli-abort-"));
    const profile = join(dir, "profile");
    const context = await launchOn(profile);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.setContent(buildMapsPage({ totalReviews: 5_000, batchSize: 10 }));

    const controller = new AbortController();
    closeOnAbort(context, controller.signal);
    const scrolling = scrollAndCollectReviews(page, { delayMs: 200 });
    const outcome = scrolling.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );

    await new Promise((r) => setTimeout(r, 1_500));
    const abortedAt = Date.now();
    controller.abort(new Error("Location timeout"));

    expect(await outcome).toBe("rejected");
    expect(Date.now() - abortedAt).toBeLessThan(5_000);

    // Chromium allows one browser per profile directory: a second launch only
    // works when the first browser is really gone.
    const next = await launchOn(profile);
    const nextPage = next.pages()[0] ?? (await next.newPage());
    await nextPage.setContent("<p>second browser</p>");
    expect(await nextPage.textContent("p")).toBe("second browser");
  });

  it("closes at once when the signal is already aborted", async () => {
    dir = mkdtempSync(join(tmpdir(), "revcli-abort-"));
    const context = await launchOn(join(dir, "profile"));
    const controller = new AbortController();
    controller.abort();
    const closed = new Promise<void>((resolve) => context.once("close", () => resolve()));

    closeOnAbort(context, controller.signal);

    await expect(closed).resolves.toBeUndefined();
  });
});
