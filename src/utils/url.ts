/**
 * Parse Google Maps URLs and extract place information.
 *
 * Supported formats:
 * - https://www.google.com/maps/place/Name/@lat,lng,...
 * - https://maps.app.goo.gl/SHORTCODE
 * - https://www.google.com/maps?cid=PLACE_CID
 * - https://www.google.com/maps?ftid=0x...:0x...
 * - Place ID string: ChIJ...
 */

export interface ParsedUrl {
  url: string;
  placeId: string | null;
  isShortUrl: boolean;
}

const PLACE_ID_REGEX = /^ChIJ[A-Za-z0-9_-]{20,}$/;
const GOOGLE_MAPS_LONG =
  /^https?:\/\/(www\.)?google\.[a-z.]+\/maps\/place\//;
const GOOGLE_MAPS_SHORT = /^https?:\/\/maps\.app\.goo\.gl\//;
const GOOGLE_MAPS_CID = /^https?:\/\/(www\.)?google\.[a-z.]+\/maps\/?\?cid=/;
const GOOGLE_MAPS_FTID =
  /^https?:\/\/(www\.)?google\.[a-z.]+\/maps\/?\?([^#]*&)?ftid=/;
const PLACE_ID_IN_URL = /!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/;
const FTID_IN_URL = /ftid=(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/;

export function parseGoogleMapsInput(input: string): ParsedUrl {
  const trimmed = input.trim();

  if (PLACE_ID_REGEX.test(trimmed)) {
    return {
      url: `https://www.google.com/maps/place/?q=place_id:${trimmed}`,
      placeId: trimmed,
      isShortUrl: false,
    };
  }

  if (GOOGLE_MAPS_SHORT.test(trimmed)) {
    return {
      url: trimmed,
      placeId: null,
      isShortUrl: true,
    };
  }

  if (
    GOOGLE_MAPS_LONG.test(trimmed) ||
    GOOGLE_MAPS_CID.test(trimmed) ||
    GOOGLE_MAPS_FTID.test(trimmed)
  ) {
    const placeId = extractPlaceIdFromUrl(trimmed);
    return {
      url: trimmed,
      placeId,
      isShortUrl: false,
    };
  }

  throw new Error(
    `Invalid input: "${trimmed}". Provide a Google Maps URL or Place ID.`,
  );
}

export function extractPlaceIdFromUrl(url: string): string | null {
  // Decode percent-encoded chars (e.g., %3A → :) so regex matches URLs
  // processed by URLSearchParams, which encodes colons in query values
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }

  // ftid query param takes precedence over !1s data param when both present
  const ftidMatch = decoded.match(FTID_IN_URL);
  if (ftidMatch) return ftidMatch[1];

  const placeMatch = decoded.match(PLACE_ID_IN_URL);
  if (placeMatch) return placeMatch[1];

  return null;
}

export function isGoogleMapsUrl(input: string): boolean {
  const trimmed = input.trim();
  return (
    GOOGLE_MAPS_LONG.test(trimmed) ||
    GOOGLE_MAPS_SHORT.test(trimmed) ||
    GOOGLE_MAPS_CID.test(trimmed) ||
    GOOGLE_MAPS_FTID.test(trimmed) ||
    PLACE_ID_REGEX.test(trimmed)
  );
}
