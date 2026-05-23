const WATCH_SOURCE_URLS: Record<string, string> = {
  espn: 'https://www.espn.com/watch/',
  fox: 'https://www.foxsports.com/live',
  fs1: 'https://www.foxsports.com/live',
  fs2: 'https://www.foxsports.com/live',
  nbc: 'https://www.peacocktv.com/sports',
  peacock: 'https://www.peacocktv.com/sports',
  cbs: 'https://www.paramountplus.com/sports/',
  'paramount+': 'https://www.paramountplus.com/sports/',
  tnt: 'https://www.tntdrama.com/watchtnt',
  tbs: 'https://www.tntdrama.com/watchtnt',
  abc: 'https://abc.com/watch-live',
  nfl: 'https://www.nfl.com/network/watch/',
  mlb: 'https://www.mlb.com/tv',
  nba: 'https://www.nba.com/watch',
  nhl: 'https://www.nhl.com/tv',
  prime: 'https://www.amazon.com/primevideo',
  amazon: 'https://www.amazon.com/primevideo',
  apple: 'https://tv.apple.com/',
  youtube: 'https://tv.youtube.com/',
  hulu: 'https://www.hulu.com/live-tv',
  fubo: 'https://www.fubo.tv/',
  sling: 'https://www.sling.com/',
  directv: 'https://streamtv.directv.com/',
  max: 'https://www.max.com/sports',
  willow: 'https://www.willow.tv/',
};

export function getWatchSourceUrl(source: string): string {
  const cleaned = source.trim();
  const lower = cleaned.toLowerCase();
  if (/^https?:\/\//i.test(cleaned)) return cleaned;

  if (lower.includes('espn+') || lower.includes('espn plus')) return 'https://www.espn.com/espnplus/';
  if (lower.includes('nba league pass') || lower.includes('league pass')) return 'https://www.nba.com/watch/league-pass-stream';
  if (lower.includes('nfl+')) return 'https://www.nfl.com/plus/';
  if (lower.includes('apple tv+')) return 'https://tv.apple.com/';
  if (lower.includes('youtube tv')) return 'https://tv.youtube.com/';
  if (lower.includes('directv stream')) return WATCH_SOURCE_URLS.directv;
  if (lower.includes('fox sports')) return WATCH_SOURCE_URLS.fox;
  if (lower.includes('nbc sports')) return 'https://www.nbcsports.com/watch';
  if (lower.includes('cbs sports')) return 'https://www.cbssports.com/watch/';
  if (lower.includes('mlb.tv')) return WATCH_SOURCE_URLS.mlb;

  for (const [key, url] of Object.entries(WATCH_SOURCE_URLS)) {
    if (lower.includes(key)) return url;
  }

  return `https://www.google.com/search?q=watch+${encodeURIComponent(cleaned)}+live+stream`;
}
