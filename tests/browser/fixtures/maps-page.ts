/**
 * Local stand-in for a Google Maps place page, used by the browser tests.
 *
 * The page mirrors the DOM shape and behaviour measured on Google Maps on
 * 2026-11-17 (see docs/selector-maintenance.md §5 and §7): review cards with
 * the SELECTORS classes, a "More" button that removes itself once clicked, a
 * virtualized list that appends cards on wheel events, the limited-view
 * banner, the Sort sign-in dialog, and the accounts.google.com account /
 * sign-in links. When Google's behaviour changes, update this fixture
 * together with src/scraper/selectors.ts.
 *
 * The in-page behaviour is a plain <script> inside the HTML string, so no
 * TypeScript transform ever touches it.
 */

export type FixtureMarker = "account" | "sign-in" | "none";

export interface MapsFixtureOptions {
  /** Total number of review cards the list can produce. */
  totalReviews: number;
  /** Cards rendered at load and appended per wheel event. */
  batchSize: number;
  /** Card i is long (truncated with a "More" button) when i % n === 0. Default: no long cards. */
  longTextEvery?: number;
  /** Card i carries a truncated owner response when (i + 1) % n === 0. */
  ownerResponseEvery?: number;
  /** How an owner-response "More" button reacts once its text is expanded. Default "remove". */
  ownerExpandMode?: "remove" | "aria-expanded" | "hide";
  /** Review ids whose "More" buttons ignore clicks. */
  stuckExpandIds?: string[];
  /** Expand (and remove the button) this many ms after the click instead of synchronously. */
  asyncExpandMs?: number;
  /** Review ids whose review "More" button appears LATE_BUTTON_MS after the card is inserted. */
  lateExpandButtonIds?: string[];
  limitedViewBanner?: boolean;
  /**
   * Show the banner only once the Reviews tab is clicked – after revcli's first
   * banner check, before its second. Event-driven, so no timing assumptions.
   */
  bannerOnReviewsTabClick?: boolean;
  /** Put the limited-view phrase inside the first card's review text. */
  reviewQuotingBanner?: boolean;
  /** Account marker shown over time; entries apply at `atMs` after load. Default: none. */
  markerTimeline?: Array<{ atMs: number; marker: FixtureMarker }>;
  /** A hidden duplicate marker link placed earlier in the DOM than the visible one. */
  hiddenDuplicateMarker?: "account" | "sign-in";
  markerLang?: "en" | "pl";
  /** The Sort button opens Google's "Sign-in to get the best of Google Maps" dialog. */
  sortOpensSignInDialog?: boolean;
  /** Render a working Sort button with the 4-item menu and live-region announcement. */
  withSortMenu?: boolean;
  /** A visible sign-in dialog from load, alongside a working sort menu. */
  signInDialogAtLoad?: boolean;
  /** A hidden `menuitemradio` earlier in the DOM than the real menu. */
  hiddenMenuTemplate?: boolean;
  /** Place name; null renders no h1 (like a search results page). Default "Test Place". */
  h1?: string | null;
  /** Tab labels; an empty array renders no tabs. Default Overview / Reviews / About. */
  tabs?: string[];
  /**
   * Same-origin path the page rewrites its URL to at load (history.replaceState),
   * the way Google Maps' single-page app rewrites a link to /maps/search/….
   * Used instead of an HTTP redirect: Playwright does not route the follow-up
   * request of a fulfilled 302, so the navigation would hang.
   */
  rewriteUrlTo?: string;
}

/** Delay before a `lateExpandButtonIds` button is inserted into its card. */
export const LATE_BUTTON_MS = 300;

const FILLER =
  "The staff were friendly and the place was clean. We came back twice during the week " +
  "and every visit was as good as the first one. Prices are fair for the quality you get, " +
  "and the location is easy to reach by public transport. Booking ahead is recommended on " +
  "weekends because it gets busy in the evenings.";

/** The complete review text of card `id` once expanded. */
export const FULL_TEXT = (id: string): string =>
  `Review ${id} full text. ${FILLER} [end of ${id}]`;

/** The complete owner-response text of card `id` once expanded. */
export const OWNER_FULL_TEXT = (id: string): string =>
  `Owner reply to ${id}. Thank you for the kind words. ${FILLER} [end of reply ${id}]`;

/** The text of a review that was never truncated. */
export const SHORT_TEXT = (id: string): string => `Short review ${id}.`;

const TRUNCATE_AT = 60;
const truncated = (full: string): string => `${full.slice(0, TRUNCATE_AT)}…`;

/** The phrase Google shows in the limited-view banner (real curly apostrophe). */
export const BANNER_TEXT = "You’re seeing a limited view of Google Maps.";

interface CardSpec {
  id: string;
  long: boolean;
  owner: boolean;
}

function cardHtml(spec: CardSpec, opts: MapsFixtureOptions, index: number): string {
  const { id } = spec;
  const late = opts.lateExpandButtonIds?.includes(id) ?? false;
  const quoting = opts.reviewQuotingBanner === true && index === 0;

  let reviewText: string;
  if (quoting) reviewText = `Odd: ${BANNER_TEXT} It said that for a while.`;
  else reviewText = spec.long ? truncated(FULL_TEXT(id)) : SHORT_TEXT(id);

  const moreButton =
    spec.long && !late && !quoting
      ? '<button class="w8nwRe kyuRq" jsaction="pane.review.expandReview" aria-expanded="false" aria-label="See more" data-fx="review">More</button>'
      : "";

  const owner = spec.owner
    ? `<div class="CDe7pd"><span class="DZSIDd">a week ago</span>` +
      `<div class="wiI7pd">${truncated(OWNER_FULL_TEXT(id))}</div>` +
      '<button jsaction="pane.review.expandOwnerResponse" aria-expanded="false" data-fx="owner">More</button></div>'
    : "";

  return (
    `<div class="jftiEf" data-review-id="${id}"><div class="inner" data-review-id="${id}">` +
    `<button class="al6Kxe" data-href="https://www.google.com/maps/contrib/${index}"><div class="d4r55">Author ${id}</div></button>` +
    `<span class="kvMYJc" role="img" aria-label="5 stars"></span>` +
    `<div class="DU9Pgb"><span class="rsqaWe">2 weeks ago</span></div>` +
    `<div class="MyEned" lang="en"><span class="wiI7pd">${reviewText}</span>${moreButton}</div>` +
    owner +
    `</div></div>`
  );
}

function markerHtml(marker: FixtureMarker, lang: "en" | "pl", hidden = false): string {
  const style = hidden ? ' style="display:none"' : "";
  if (marker === "account") {
    const label =
      lang === "pl"
        ? "Konto Google: Test User (test.user@example.com)"
        : "Google Account: Test User (test.user@example.com)";
    return `<a${style} href="https://accounts.google.com/SignOutOptions?hl=${lang}&amp;continue=https://www.google.com/maps" aria-label="${label}">TU</a>`;
  }
  if (marker === "sign-in") {
    const label = lang === "pl" ? "Zaloguj się" : "Sign in";
    return `<a${style} href="https://accounts.google.com/ServiceLogin?hl=${lang}&amp;passive=true&amp;continue=https://www.google.com/maps" aria-label="${label}">${label}</a>`;
  }
  return "";
}

/** Build the complete fixture HTML for one page load. */
export function buildMapsPage(opts: MapsFixtureOptions): string {
  const lang = opts.markerLang ?? "en";
  const specs: CardSpec[] = Array.from({ length: opts.totalReviews }, (_, i) => ({
    id: `r${i}`,
    long: opts.longTextEvery != null && i % opts.longTextEvery === 0,
    owner: opts.ownerResponseEvery != null && (i + 1) % opts.ownerResponseEvery === 0,
  }));
  const cards = specs.map((s, i) => cardHtml(s, opts, i)).join("");

  const timeline = (opts.markerTimeline ?? []).map((e) => ({
    atMs: e.atMs,
    html: markerHtml(e.marker, lang),
  }));
  const fullTexts = Object.fromEntries(specs.map((s) => [s.id, FULL_TEXT(s.id)]));
  const ownerTexts = Object.fromEntries(specs.map((s) => [s.id, OWNER_FULL_TEXT(s.id)]));

  const h1 = opts.h1 === undefined ? "Test Place" : opts.h1;
  const tabs = opts.tabs ?? ["Overview", "Reviews", "About"];
  const hasSort = opts.withSortMenu === true || opts.sortOpensSignInDialog === true;

  const config = {
    batchSize: opts.batchSize,
    stuck: opts.stuckExpandIds ?? [],
    asyncExpandMs: opts.asyncExpandMs ?? 0,
    late: opts.lateExpandButtonIds ?? [],
    lateMs: LATE_BUTTON_MS,
    ownerMode: opts.ownerExpandMode ?? "remove",
    bannerAtLoad: opts.limitedViewBanner === true && opts.bannerOnReviewsTabClick !== true,
    bannerOnTab: opts.limitedViewBanner === true && opts.bannerOnReviewsTabClick === true,
    timeline,
    fullTexts,
    ownerTexts,
    sortDialog: opts.sortOpensSignInDialog === true,
    rewriteUrlTo: opts.rewriteUrlTo ?? null,
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Test Place - Google Maps</title>
<style>
  body { margin: 0; font: 14px sans-serif; }
  .m6QErb { height: 400px; overflow-y: auto; border: 1px solid #ccc; }
  .jftiEf { min-height: 100px; border-bottom: 1px solid #eee; padding: 4px; }
</style></head>
<body>
${opts.hiddenMenuTemplate ? '<div role="menuitemradio" style="display:none">Template</div>' : ""}
${opts.hiddenDuplicateMarker ? markerHtml(opts.hiddenDuplicateMarker, lang, true) : ""}
<div id="fx-markers"></div>
${opts.signInDialogAtLoad ? '<div role="dialog" aria-label="Sign-in to get the best of Google Maps">Sign in to get the best of Google Maps</div>' : ""}
<div id="fx-banner" style="display:${config.bannerAtLoad ? "block" : "none"}">${BANNER_TEXT} <a href="#">See more</a></div>
${h1 === null ? "" : `<h1>${h1}</h1>`}
<div role="main" aria-label="Test Place">
  <div role="tablist">${tabs.map((t) => `<button role="tab">${t}</button>`).join("")}</div>
  ${hasSort ? '<button id="fx-sort" aria-label="Sort reviews">Sort</button>' : ""}
  <div aria-live="polite" aria-atomic="true" id="fx-live"></div>
  <div class="m6QErb DxyBCb kA9KIf dS8AEf" aria-label="Reviews" id="fx-list"></div>
</div>
<template id="fx-cards">${cards}</template>
<script>
(function () {
  var cfg = ${JSON.stringify(config)};
  if (cfg.rewriteUrlTo) history.replaceState(null, "", cfg.rewriteUrlTo);
  var test = (window.__revcliTest = { clicks: {}, appended: 0 });
  var list = document.getElementById("fx-list");
  var pool = Array.prototype.slice.call(document.getElementById("fx-cards").content.children);

  function addLateButton(card) {
    var host = card.querySelector("div.MyEned");
    var btn = document.createElement("button");
    btn.className = "w8nwRe kyuRq";
    btn.setAttribute("jsaction", "pane.review.expandReview");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("data-fx", "review");
    btn.textContent = "More";
    host.appendChild(btn);
  }

  function appendBatch() {
    var next = pool.slice(test.appended, test.appended + cfg.batchSize);
    next.forEach(function (tpl) {
      var card = document.importNode(tpl, true);
      list.appendChild(card);
      var id = card.getAttribute("data-review-id");
      if (cfg.late.indexOf(id) !== -1) {
        setTimeout(function () { addLateButton(card); }, cfg.lateMs);
      }
    });
    test.appended += next.length;
  }

  appendBatch();
  list.addEventListener("wheel", function () { setTimeout(appendBatch, 50); });

  function applyExpand(btn, card, id) {
    if (btn.getAttribute("data-fx") === "owner") {
      card.querySelector("div.CDe7pd div.wiI7pd").textContent = cfg.ownerTexts[id];
      if (cfg.ownerMode === "aria-expanded") { btn.setAttribute("aria-expanded", "true"); btn.textContent = "Less"; }
      else if (cfg.ownerMode === "hide") btn.style.display = "none";
      else btn.remove();
      return;
    }
    card.querySelector("div.MyEned span.wiI7pd").textContent = cfg.fullTexts[id];
    btn.remove();
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("button[data-fx]");
    if (!btn) return;
    var card = btn.closest(".jftiEf");
    var id = card.getAttribute("data-review-id");
    test.clicks[id] = (test.clicks[id] || 0) + 1;
    if (cfg.stuck.indexOf(id) !== -1) return;
    if (cfg.asyncExpandMs > 0) setTimeout(function () { applyExpand(btn, card, id); }, cfg.asyncExpandMs);
    else applyExpand(btn, card, id);
  });

  var markers = document.getElementById("fx-markers");
  cfg.timeline.forEach(function (entry) {
    if (entry.atMs <= 0) markers.innerHTML = entry.html;
    else setTimeout(function () { markers.innerHTML = entry.html; }, entry.atMs);
  });

  if (cfg.bannerOnTab) {
    Array.prototype.forEach.call(document.querySelectorAll('button[role="tab"]'), function (tab) {
      if (!/review/i.test(tab.textContent)) return;
      tab.addEventListener("click", function () {
        document.getElementById("fx-banner").style.display = "block";
      });
    });
  }

  var sort = document.getElementById("fx-sort");
  if (sort) {
    var labels = ["Most relevant", "Newest", "Highest rating", "Lowest rating"];
    var announcements = [
      "The reviews are now sorted by most relevant.",
      "The reviews are now sorted from newest to oldest.",
      "The reviews are now sorted from highest to lowest rating.",
      "The reviews are now sorted from lowest to highest rating."
    ];
    sort.addEventListener("click", function () {
      if (cfg.sortDialog) {
        var dialog = document.createElement("div");
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-label", "Sign-in to get the best of Google Maps");
        dialog.textContent = "Sign in to get the best of Google Maps";
        document.body.appendChild(dialog);
        return;
      }
      var menu = document.createElement("div");
      menu.id = "fx-sort-menu";
      menu.setAttribute("role", "menu");
      labels.forEach(function (label, i) {
        var item = document.createElement("div");
        item.setAttribute("role", "menuitemradio");
        item.textContent = label;
        item.addEventListener("click", function () {
          menu.remove();
          document.getElementById("fx-live").textContent = announcements[i];
        });
        menu.appendChild(item);
      });
      document.body.appendChild(menu);
    });
  }
})();
</script>
</body></html>`;
}
