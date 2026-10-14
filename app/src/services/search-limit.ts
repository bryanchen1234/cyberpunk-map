/**
 * Self-imposed cap on destination-search calls, tracked per browser via
 * localStorage. This does NOT protect Photon's shared, keyless server from
 * other visitors -- it only bounds how much of it this one browser can
 * spend by itself. It's a courtesy limit, not an anti-abuse or security
 * mechanism: the source is public, and anyone can bypass it by clearing
 * storage, using a private window, or switching browsers. That's fine --
 * it only has to stop this browser from accidentally being the thing that
 * drains the pool, not survive an adversary.
 */

export interface SearchLimitRecord {
  /** "YYYY-MM" */
  month: string;
  count: number;
}

// Each debounced keystroke is one request, so ~5 per destination search.
export const SEARCH_LIMIT = 3000;

export function currentMonth(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Decides whether a search is allowed and what the record becomes.
 *
 * A record from a previous month resets the count to 0 first: the cap is
 * "per calendar month". Once at the
 * limit, the count stops climbing -- there's no need to keep counting past
 * it, and it keeps the stored value from growing without bound.
 */
export function nextSearchState(
  record: SearchLimitRecord | null,
  now: Date,
  limit: number,
): { record: SearchLimitRecord; allowed: boolean } {
  const month = currentMonth(now);
  const count = record && record.month === month ? record.count : 0;

  if (count >= limit) return { record: { month, count }, allowed: false };
  return { record: { month, count: count + 1 }, allowed: true };
}

const STORAGE_KEY = 'games-map:search-count';

function isRecord(value: unknown): value is SearchLimitRecord {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as SearchLimitRecord).month === 'string' &&
    typeof (value as SearchLimitRecord).count === 'number' &&
    Number.isFinite((value as SearchLimitRecord).count) &&
    (value as SearchLimitRecord).count >= 0
  );
}

/**
 * A wrong-shaped or corrupted value must not become a NaN comparison
 * further down: anything that doesn't parse or doesn't look like a real
 * record is treated as "no record yet", the same as a private-browsing
 * throw would be.
 */
function readRecord(): SearchLimitRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeRecord(record: SearchLimitRecord): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Private browsing / disabled storage: the cap just won't persist.
  }
}

/** The only place that increments the counter. */
export function trySearch(now = new Date()): boolean {
  const { record, allowed } = nextSearchState(readRecord(), now, SEARCH_LIMIT);
  writeRecord(record);
  return allowed;
}

/** Read-only peek, for UI purposes. Never increments. */
export function searchUsage(now = new Date()): { count: number; limit: number } {
  const record = readRecord();
  const month = currentMonth(now);
  const count = record && record.month === month ? record.count : 0;
  return { count, limit: SEARCH_LIMIT };
}
