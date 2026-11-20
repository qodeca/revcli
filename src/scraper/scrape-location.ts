import type { ParsedUrl } from "../utils/url.js";
import { logger } from "../utils/logger.js";
import { launchBrowser, withBrowserSession } from "./browser.js";
import { navigateToReviews } from "./navigator.js";
import { scrollAndCollectReviews } from "./scroller.js";
import {
  authRequiredError,
  getSessionState,
  POLL_PROBE,
  waitForUserAuth,
  type SessionState,
} from "./auth.js";
import { hasUnrecoverableKind, type UnrecoverableError } from "../core/errors.js";
import type {
  ScrapeResult,
  Review,
  SortOrder,
  Business,
} from "../core/schema.js";

export interface ScrapeLocationOptions {
  sort: SortOrder;
  maxReviews?: number;
  headless: boolean;
  delay: number;
  /** Epoch ms after which review collection stops with a partial result. */
  deadline?: number;
}

/**
 * Assemble a ScrapeResult from the raw business info (header-derived) and the
 * collected reviews list. Enforces the invariant
 * `business.totalReviews === reviews.length` and preserves the original
 * Google-reported header value as `business.headerTotalReviews`.
 *
 * Exported for direct unit testing – the reconciliation is the entire point
 * of issue #5 and must be pinned by vitest, not relied on via manual
 * verification.
 *
 * Pure function: no side effects, no Playwright, no IO. Does not mutate
 * its inputs.
 */
export function assembleScrapeResult(
  businessInfo: Omit<Business, "scrapeDate" | "headerTotalReviews">,
  reviews: Review[],
  ctx: {
    scrapeDate: string;
    scrapeDurationMs: number;
    sortOrder: SortOrder;
  },
): ScrapeResult {
  const { totalReviews: headerTotalReviews, ...rest } = businessInfo;
  return {
    business: {
      ...rest,
      totalReviews: reviews.length,
      headerTotalReviews,
      scrapeDate: ctx.scrapeDate,
    },
    reviews,
    metadata: {
      provider: "playwright",
      scrapeDurationMs: ctx.scrapeDurationMs,
      reviewsCollected: reviews.length,
      sortOrder: ctx.sortOrder,
    },
  };
}

export interface AuthFallbackDeps<T> {
  headless: boolean;
  /** Navigate to the place's reviews; throws AUTH_REQUIRED on a limited view. */
  navigate: () => Promise<T>;
  /** Headed only: let the user sign in interactively. */
  waitForAuth: () => Promise<void>;
  /** Session state of the current page, used only to word the final error. */
  sessionProbe: () => Promise<SessionState>;
}

/** AUTH_REQUIRED worded by the session state; a failing probe falls back to M1. */
async function terminalAuthError(
  sessionProbe: () => Promise<SessionState>,
): Promise<UnrecoverableError> {
  const state = await sessionProbe().catch(() => undefined);
  return authRequiredError(state);
}

/**
 * Navigate, handling a limited view (AUTH_REQUIRED): headless fails at once;
 * headed waits for an interactive sign-in and navigates again, returning the
 * second navigation's result. A limited view that cannot be recovered from is
 * rethrown with wording chosen by the session state (M1 / M1b). Any other
 * error is rethrown unchanged. Exported for testing with fakes.
 */
export async function navigateWithAuthFallback<T>(
  deps: AuthFallbackDeps<T>,
): Promise<T> {
  try {
    return await deps.navigate();
  } catch (err) {
    if (!hasUnrecoverableKind(err, "AUTH_REQUIRED")) throw err;
    if (deps.headless) throw await terminalAuthError(deps.sessionProbe);
  }

  await deps.waitForAuth();

  try {
    return await deps.navigate();
  } catch (err) {
    if (!hasUnrecoverableKind(err, "AUTH_REQUIRED")) throw err;
    throw await terminalAuthError(deps.sessionProbe);
  }
}

export async function scrapeLocation(
  parsed: ParsedUrl,
  options: ScrapeLocationOptions,
  signal?: AbortSignal,
): Promise<ScrapeResult> {
  const startTime = Date.now();
  // A timeout or shutdown closes the browser at once; every pending
  // Playwright call then rejects and the session closes (issue #33).
  return withBrowserSession(
    () => launchBrowser({ headless: options.headless }),
    signal,
    async ({ page }) => {
      const businessInfo: Omit<Business, "scrapeDate" | "headerTotalReviews"> =
        await navigateWithAuthFallback({
          headless: options.headless,
          navigate: () => navigateToReviews(page, parsed, options.sort),
          waitForAuth: () => waitForUserAuth(page),
          sessionProbe: () => getSessionState(page, POLL_PROBE),
        });

      logger.info(
        `Found: ${businessInfo.name} (header reports ${businessInfo.totalReviews ?? "?"} reviews)`,
      );

      const reviews: Review[] = await scrollAndCollectReviews(page, {
        maxReviews: options.maxReviews,
        delayMs: options.delay,
        deadline: options.deadline,
      });

      return assembleScrapeResult(businessInfo, reviews, {
        scrapeDate: new Date().toISOString(),
        scrapeDurationMs: Date.now() - startTime,
        sortOrder: options.sort,
      });
    },
  );
}
