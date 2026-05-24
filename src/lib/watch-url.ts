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

// Native iOS/Android URL schemes for opening the source's app directly.
// Linking.openURL with these will succeed if the app is installed; otherwise
// the caller should fall back to the web URL. We don't gate on canOpenURL
// because that requires LSApplicationQueriesSchemes entries in Info.plist.
const WATCH_SOURCE_APP_SCHEMES: Record<string, string> = {
  espn: 'sportscenter://',
  fox: 'foxsportsgo://',
  fs1: 'foxsportsgo://',
  fs2: 'foxsportsgo://',
  nbc: 'peacock://',
  peacock: 'peacock://',
  cbs: 'paramountplus://',
  'paramount+': 'paramountplus://',
  tnt: 'maxgo://',
  tbs: 'maxgo://',
  nfl: 'nflmobile://',
  mlb: 'mlbatbat://',
  nba: 'nba://',
  nhl: 'nhl://',
  prime: 'aiv://',
  amazon: 'aiv://',
  apple: 'videos://',
  youtube: 'youtubetv://',
  hulu: 'hulu://',
  fubo: 'fubo://',
  sling: 'sling://',
  directv: 'directvnow://',
  max: 'maxgo://',
  willow: 'willowtv://',
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

// Returns a native app URL scheme for opening the source's app, or null if
// no known app mapping exists. Callers should attempt the app URL first and
// fall back to getWatchSourceUrl on failure.
export function getWatchSourceAppUrl(source: string): string | null {
  const cleaned = source.trim();
  const lower = cleaned.toLowerCase();
  if (!cleaned) return null;
  // If the source itself is already a URL we have no way to derive an app scheme.
  if (/^https?:\/\//i.test(cleaned)) return null;

  if (lower.includes('espn+') || lower.includes('espn plus')) return WATCH_SOURCE_APP_SCHEMES.espn;
  if (lower.includes('nba league pass') || lower.includes('league pass')) return WATCH_SOURCE_APP_SCHEMES.nba;
  if (lower.includes('nfl+')) return WATCH_SOURCE_APP_SCHEMES.nfl;
  if (lower.includes('apple tv+')) return WATCH_SOURCE_APP_SCHEMES.apple;
  if (lower.includes('youtube tv')) return WATCH_SOURCE_APP_SCHEMES.youtube;
  if (lower.includes('directv stream')) return WATCH_SOURCE_APP_SCHEMES.directv;
  if (lower.includes('fox sports')) return WATCH_SOURCE_APP_SCHEMES.fox;
  if (lower.includes('nbc sports')) return WATCH_SOURCE_APP_SCHEMES.nbc;
  if (lower.includes('cbs sports')) return WATCH_SOURCE_APP_SCHEMES.cbs;
  if (lower.includes('mlb.tv')) return WATCH_SOURCE_APP_SCHEMES.mlb;

  for (const [key, scheme] of Object.entries(WATCH_SOURCE_APP_SCHEMES)) {
    if (lower.includes(key)) return scheme;
  }

  return null;
}
