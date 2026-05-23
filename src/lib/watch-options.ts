export type WatchOptionKind = 'broadcast' | 'streaming';

export type WatchOption = {
  name: string;
  kind: WatchOptionKind;
  note: string;
};

const UNKNOWN_WATCH_LABELS = new Set([
  'tbd',
  'tba',
  'n/a',
  'na',
  'none',
  'not listed',
  'broadcast info not listed',
  'watch info tbd',
]);

const DIRECT_STREAMING_SOURCE_RE = /(mlb\.tv|espn\+|espn plus|peacock|paramount\+|prime video|amazon prime|apple tv\+|youtube tv|hulu|fubo|sling|directv stream|nba league pass|league pass|nfl\+|willow)/i;

function watchKindForName(name: string): WatchOptionKind {
  return DIRECT_STREAMING_SOURCE_RE.test(name) ? 'streaming' : 'broadcast';
}

function splitWatchString(value: string): string[] {
  if (/^https?:\/\//i.test(value.trim())) return [value.trim()];
  return value
    .split(/\s*(?:,|;|\||\/)\s*/g)
    .map((source) => source.trim())
    .filter(Boolean);
}

export function collectWatchNames(source: unknown): string[] {
  if (!source) return [];
  if (typeof source === 'string') return splitWatchString(source);
  if (Array.isArray(source)) return source.flatMap((item) => collectWatchNames(item));
  if (typeof source === 'object') {
    const maybe = source as {
      name?: unknown;
      displayName?: unknown;
      shortName?: unknown;
      label?: unknown;
      names?: unknown;
    };
    const direct = [maybe.name, maybe.displayName, maybe.shortName, maybe.label].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return direct ? splitWatchString(direct) : collectWatchNames(maybe.names);
  }
  return [];
}

export function getListedWatchOptions(primaryChannel?: string | null, watchSources?: unknown): WatchOption[] {
  const names = [...collectWatchNames(primaryChannel), ...collectWatchNames(watchSources)];
  const seen = new Set<string>();

  return names.reduce<WatchOption[]>((options, name) => {
    const cleaned = name.replace(/\s+/g, ' ').trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || UNKNOWN_WATCH_LABELS.has(key) || seen.has(key)) return options;

    const kind = watchKindForName(cleaned);
    seen.add(key);
    options.push({
      name: cleaned,
      kind,
      note: kind === 'streaming' ? 'Listed streaming source' : 'Listed broadcast',
    });
    return options;
  }, []);
}

export function getFeaturedWatchOption(primaryChannel?: string | null, watchSources?: unknown): WatchOption | null {
  const options = getListedWatchOptions(primaryChannel, watchSources);
  return options.find((option) => option.kind === 'streaming') ?? options[0] ?? null;
}
