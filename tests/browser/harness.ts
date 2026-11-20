/**
 * Browser-test harness: a throwaway headless Chromium that only ever sees
 * local fixture HTML.
 *
 * Rules (see AGENTS.md "Browser tests"):
 * - Never import `launchBrowser` or `PROFILE_DIR` from src/scraper/browser.ts
 *   here or in any browser test. They open the persistent profile in
 *   ~/.revcli, which is a credential store holding a real Google session.
 * - Every context blocks all network traffic first; fixture routes are added
 *   afterwards (Playwright runs the most recently registered matching route
 *   first), so nothing can reach Google even with fake cookies in the context.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";

export async function launchTestBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

/** A fresh, non-persistent context with every network request aborted. */
export async function newFixtureContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  await context.route("**/*", (route) => route.abort());
  return context;
}

/** A page whose content is the given fixture HTML (no URL, no network). */
export async function newFixturePage(
  context: BrowserContext,
  html: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.setContent(html);
  return page;
}

export type RouteMatcher = string | RegExp | ((url: URL) => boolean);

/**
 * Serve fixture HTML for requests matching `url`. Registered after the
 * abort-all route, so it takes precedence for its own URLs only.
 *
 * There is deliberately no redirect variant: Playwright does not route the
 * follow-up request of a fulfilled 3xx, so such a navigation hangs. Fixtures
 * that need a different final URL use `rewriteUrlTo` (history.replaceState).
 */
export async function routeFixture(
  context: BrowserContext,
  url: RouteMatcher,
  html: string,
): Promise<void> {
  await context.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html }),
  );
}
