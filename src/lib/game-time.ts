// Single source of truth for parsing and formatting game timestamps.
//
// WHY THIS EXISTS:
// The backend emits ISO-ish timestamps WITHOUT seconds for ~90% of games,
// e.g. "2026-06-29T10:05Z". V8 (Node, web) parses that leniently, but Hermes
// (the engine that ships in the production React Native app) follows the
// ECMAScript Date Time String grammar strictly, where seconds are part of the
// time portion. On Hermes, `new Date("2026-06-29T10:05Z")` returns an
// Invalid Date. Every screen previously called `new Date(game.gameTime)`
// directly, so on device the date silently became NaN, the "is this game
// today?" comparisons all failed, and EVERY sport tile rendered 0 even though
// the fetch succeeded and the data was correct.
//
// This module normalizes the timestamp (injecting ":00" seconds when absent,
// normalizing the timezone suffix) before parsing, and NEVER returns an
// Invalid Date: callers get a valid Date or null and can branch deliberately.
//
// Use these helpers everywhere instead of `new Date(gameTime)`.

const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Normalize an ISO-ish timestamp into a strictly-parseable form.
 * - Injects ":00" seconds when the time portion has only HH:MM.
 * - Normalizes a "+HHMM" offset into "+HH:MM".
 * - Defaults a missing timezone designator to "Z" (UTC), which is how the
 *   backend intends these values.
 * Returns the original string unchanged when it does not match the ISO shape,
 * so non-ISO inputs still get a chance via the fallback parse below.
 */
export function normalizeGameTimeString(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  const m = ISO_DATETIME.exec(s);
  if (!m) return s;

  const [, y, mo, d, hh, mm, ss = '00', frac, tz = 'Z'] = m;
  const fracPart = frac ? `.${frac}` : '';
  const tzNorm = tz === 'Z' ? 'Z' : tz.length === 5 ? `${tz.slice(0, 3)}:${tz.slice(3)}` : tz;
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}${fracPart}${tzNorm}`;
}

/**
 * Parse a game timestamp into a valid Date, or null. Never returns Invalid Date.
 */
export function parseGameTime(input: string | null | undefined): Date | null {
  const normalized = normalizeGameTimeString(input);
  if (normalized == null) return null;

  let ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    // Fallback: try the raw input in case it was a format we did not normalize.
    ms = Date.parse(String(input));
  }
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Milliseconds since epoch for sorting. Invalid/missing times sort to the end
 * (Number.POSITIVE_INFINITY) rather than NaN, which would corrupt comparisons.
 */
export function gameTimeMs(input: string | null | undefined): number {
  const d = parseGameTime(input);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

/** Local YYYY-MM-DD for a Date (device timezone). */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Local YYYY-MM-DD for a game timestamp, or null when it cannot be parsed.
 * This is the safe replacement for the old inline getLocalDateStr that built
 * "NaN-NaN-NaN" on Hermes.
 */
export function getLocalDateStr(input: string | null | undefined): string | null {
  const d = parseGameTime(input);
  return d ? formatLocalDate(d) : null;
}

/** Today's local date as YYYY-MM-DD. */
export function todayLocalDateStr(now: Date = new Date()): string {
  return formatLocalDate(now);
}

/**
 * Format a game start time for display (e.g. "7:05 PM"). Returns a fallback
 * string when the timestamp is unparseable rather than "Invalid Date".
 */
export function formatGameTimeLabel(
  input: string | null | undefined,
  fallback = 'TBD',
): string {
  const d = parseGameTime(input);
  if (!d) return fallback;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
