import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext } from "playwright";
import { navigateToReviews, NOT_A_PLACE_MESSAGE, setSortOrder } from "../../src/scraper/navigator.js";
import { parseGoogleMapsInput } from "../../src/utils/url.js";
import { hasUnrecoverableKind, UnrecoverableError } from "../../src/core/errors.js";
import { SORT_ORDERS } from "../../src/core/schema.js";
import { buildMapsPage, type MapsFixtureOptions } from "./fixtures/maps-page.js";
import { launchTestBrowser, newFixtureContext, newFixturePage, routeFixture } from "./harness.js";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PLACE_URL = "https://www.google.com/maps/place/Test/data=!1s0x1:0x2?hl=en";
const isPlacePath = (u: URL) => u.hostname === "www.google.com" && u.pathname === "/maps/place/Test/data=!1s0x1:0x2";
const CID_URL = "https://www.google.com/maps?cid=1234567890";
const isCidLink = (u: URL) => u.hostname === "www.google.com" && u.pathname === "/maps" && u.searchParams.has("cid");
const SEARCH_PATH = "/maps/search/foo/@1,2,3z?hl=en";

const PLACE: MapsFixtureOptions = { totalReviews: 10, batchSize: 10, withSortMenu: true };

let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  context = await newFixtureContext(browser);
});

afterEach(async () => {
  await context?.close();
});

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => new Error("expected a rejection"),
    (e: unknown) => e,
  );
}

describe("navigateToReviews on a limited view (issue #31 finding 5)", () => {
  it.each([...SORT_ORDERS])("fails with AUTH_REQUIRED for sort %s", async (sort) => {
    await routeFixture(context, isPlacePath, buildMapsPage({ ...PLACE, limitedViewBanner: true }));
    const page = await context.newPage();

    const err = await rejection(navigateToReviews(page, parseGoogleMapsInput(PLACE_URL), sort));

    expect(hasUnrecoverableKind(err, "AUTH_REQUIRED")).toBe(true);
  });

  it("catches a banner that appears only after the Reviews tab is clicked", async () => {
    // The banner is inserted by the tab click, i.e. after the first check:
    // only the second check (after the review cards) can see it.
    await routeFixture(
      context,
      isPlacePath,
      buildMapsPage({ ...PLACE, limitedViewBanner: true, bannerOnReviewsTabClick: true }),
    );
    const page = await context.newPage();

    const err = await rejection(navigateToReviews(page, parseGoogleMapsInput(PLACE_URL), "relevant"));

    expect(hasUnrecoverableKind(err, "AUTH_REQUIRED")).toBe(true);
  });

  it.each(["newest", "highest", "lowest"] as const)(
    "fails with AUTH_REQUIRED when Sort opens the sign-in dialog, with no banner (sort %s)",
    async (sort) => {
      await routeFixture(context, isPlacePath, buildMapsPage({ ...PLACE, sortOpensSignInDialog: true }));
      const page = await context.newPage();

      const err = await rejection(navigateToReviews(page, parseGoogleMapsInput(PLACE_URL), sort));

      expect(hasUnrecoverableKind(err, "AUTH_REQUIRED")).toBe(true);
    },
  );

  it("does not see the Sort sign-in dialog for sort relevant (no Sort click), so it resolves", async () => {
    // Pins current behaviour: with no banner, "relevant" never clicks Sort, so
    // the dialog signal cannot fire. The banner is the only signal for it.
    await routeFixture(context, isPlacePath, buildMapsPage({ ...PLACE, sortOpensSignInDialog: true }));
    const page = await context.newPage();

    const business = await navigateToReviews(page, parseGoogleMapsInput(PLACE_URL), "relevant");

    expect(business.name).toBe("Test Place");
  });

  it("is not fooled by a review quoting the banner text", async () => {
    await routeFixture(context, isPlacePath, buildMapsPage({ ...PLACE, reviewQuotingBanner: true }));
    const page = await context.newPage();

    const business = await navigateToReviews(page, parseGoogleMapsInput(PLACE_URL), "relevant");

    expect(business.name).toBe("Test Place");
  });
});

describe("navigateToReviews on a short link (issue #31)", () => {
  it("waits for the script redirect before forcing hl=en", async () => {
    // Google redirects maps.app.goo.gl links in page script. If hl=en is added
    // to the short link itself it is lost, and a signed-out or non-English
    // profile gets a localized page that no English selector matches.
    // hl=en is already there, so only the short-link rule can cause the
    // extra navigation that strips entry/g_ep.
    const target = "https://www.google.com/maps/place/Test/data=!1s0x1:0x2?hl=en&entry=tts&g_ep=Egoy";
    await routeFixture(
      context,
      (u) => u.hostname === "maps.app.goo.gl",
      `<!doctype html><script>setTimeout(function () { location.replace(${JSON.stringify(target)}); }, 300);</script>`,
    );
    await routeFixture(context, isPlacePath, buildMapsPage(PLACE));
    const page = await context.newPage();

    await navigateToReviews(page, parseGoogleMapsInput("https://maps.app.goo.gl/abcDEF123"), "relevant");

    const finalUrl = new URL(page.url());
    expect(finalUrl.hostname).toBe("www.google.com");
    expect(finalUrl.searchParams.get("hl")).toBe("en");
    expect(finalUrl.searchParams.has("entry")).toBe(false);
    expect(finalUrl.searchParams.has("g_ep")).toBe(false);
  });
});

describe("setSortOrder", () => {
  it("fails fast with AUTH_REQUIRED when Sort opens the sign-in dialog", async () => {
    const page = await newFixturePage(context, buildMapsPage({ ...PLACE, sortOpensSignInDialog: true }));

    const start = Date.now();
    const err = await rejection(setSortOrder(page, "newest"));

    expect(hasUnrecoverableKind(err, "AUTH_REQUIRED")).toBe(true);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("is not stalled by a hidden menu item earlier in the DOM", async () => {
    const page = await newFixturePage(
      context,
      buildMapsPage({ ...PLACE, sortOpensSignInDialog: true, hiddenMenuTemplate: true }),
    );

    const start = Date.now();
    const err = await rejection(setSortOrder(page, "newest"));

    expect(hasUnrecoverableKind(err, "AUTH_REQUIRED")).toBe(true);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it("carries on when the sort menu is visible alongside a sign-in dialog", async () => {
    const page = await newFixturePage(context, buildMapsPage({ ...PLACE, signInDialogAtLoad: true }));

    await expect(setSortOrder(page, "newest")).resolves.toBeUndefined();
  });

  it("still applies the sort through the real menu", async () => {
    const page = await newFixturePage(context, buildMapsPage(PLACE));

    await expect(setSortOrder(page, "newest")).resolves.toBeUndefined();
  });

  it("still applies the sort with a hidden menu item earlier in the DOM", async () => {
    const page = await newFixturePage(context, buildMapsPage({ ...PLACE, hiddenMenuTemplate: true }));

    await expect(setSortOrder(page, "lowest")).resolves.toBeUndefined();
  });
});

// The link loads, then the page rewrites its URL to a search results path – as
// Google Maps does for a link that does not resolve to one place.
describe("navigateToReviews on a non-place link (issue #31 finding 6)", () => {
  const searchPage = (h1: string | null) =>
    buildMapsPage({ totalReviews: 0, batchSize: 1, h1, tabs: [], rewriteUrlTo: SEARCH_PATH });

  it("fails once with NOT_A_PLACE when the link lands on a search page without h1", async () => {
    await routeFixture(context, isCidLink, searchPage(null));
    const page = await context.newPage();

    const err = await rejection(navigateToReviews(page, parseGoogleMapsInput(CID_URL), "relevant"));

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as UnrecoverableError).kind).toBe("NOT_A_PLACE");
    expect((err as UnrecoverableError).message).toBe(NOT_A_PLACE_MESSAGE);
  });

  it("fails with NOT_A_PLACE when the search page has an h1 but no tabs", async () => {
    await routeFixture(context, isCidLink, searchPage("Results"));
    const page = await context.newPage();

    const err = await rejection(navigateToReviews(page, parseGoogleMapsInput(CID_URL), "relevant"));

    expect(hasUnrecoverableKind(err, "NOT_A_PLACE")).toBe(true);
  });

  it("rethrows a plain timeout when a place panel never loads on a non-search URL", async () => {
    await routeFixture(context, isCidLink, buildMapsPage({ totalReviews: 0, batchSize: 1, h1: null }));
    const page = await context.newPage();

    const err = await rejection(navigateToReviews(page, parseGoogleMapsInput(CID_URL), "relevant"));

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });
});
