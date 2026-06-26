/**
 * World Cup national-team Elo seed ratings.
 *
 * Problem this solves: ESPN's `soccer/fifa.world` team-schedule endpoint only
 * exposes the handful of games played inside the current tournament (typically
 * 2-3 per team). Replaying that tiny sample leaves every national team at
 * DEFAULT_RATING (1500), which collapses every prediction into a flat ~50/50
 * toss-up with identical 1.x/0.9 scorelines and copy-paste narratives.
 *
 * Fix: seed each national team with a realistic strength prior derived from the
 * World Football Elo ratings (eloratings.net) / FIFA ranking ordering as of
 * June 2026. The few real tournament games still adjust the rating on top of
 * this prior, but the prior carries the actual strength signal so favorites,
 * scorelines, draw risk and narratives all differentiate correctly.
 *
 * Values are expressed in the SAME Elo scale the engine uses internally
 * (centered on 1500), NOT the raw eloratings.net scale (centered ~1800-2100).
 * They are produced by compressing the real-world spread into a ~1350-1700 band
 * so home-advantage (8) and K-factor (40) math stays well behaved while still
 * producing meaningful favorites (a ~150-pt gap ≈ 70% win expectancy).
 *
 * Keyed by normalized country name (lowercase, no diacritics/punctuation).
 */

export const WORLDCUP_DEFAULT_SEED = 1480;

// Raw ordering anchor (World Football Elo, eloratings.net, ~June 2026):
//   Argentina 2144, Spain 2134, France 2090, England 2028, Brazil 2009 ...
// We map that ordering into a compressed engine-scale band below. Stronger
// sides sit ~1660-1700, mid-table ~1500-1560, minnows ~1360-1430.
const RAW_SEEDS: Record<string, number> = {
  // ── Elite (title contenders) ───────────────────────────────────────────
  argentina: 1700,
  spain: 1695,
  france: 1685,
  england: 1665,
  brazil: 1660,
  portugal: 1645,
  netherlands: 1640,
  belgium: 1625,
  germany: 1620,
  italy: 1615,

  // ── Strong (dark horses / seeded sides) ────────────────────────────────
  croatia: 1600,
  uruguay: 1598,
  colombia: 1592,
  morocco: 1588,
  switzerland: 1575,
  denmark: 1572,
  "united states": 1565,
  usa: 1565,
  mexico: 1562,
  japan: 1560,
  senegal: 1558,
  ecuador: 1552,
  austria: 1550,
  ukraine: 1545,
  "south korea": 1542,
  korea_republic: 1542,
  sweden: 1540,
  serbia: 1538,
  wales: 1535,
  poland: 1532,
  peru: 1528,
  turkey: 1525,
  "ivory coast": 1522,
  nigeria: 1520,
  iran: 1518,
  norway: 1515,
  egypt: 1512,
  scotland: 1510,
  czechia: 1508,
  "czech republic": 1508,
  algeria: 1505,
  canada: 1502,
  australia: 1500,

  // ── Mid (competitive group stage) ──────────────────────────────────────
  greece: 1495,
  romania: 1492,
  hungary: 1490,
  chile: 1488,
  cameroon: 1486,
  tunisia: 1484,
  "saudi arabia": 1482,
  mali: 1480,
  ghana: 1478,
  paraguay: 1476,
  "costa rica": 1474,
  qatar: 1472,
  "republic of ireland": 1470,
  ireland: 1470,
  slovakia: 1468,
  slovenia: 1466,
  finland: 1464,
  "south africa": 1462,
  venezuela: 1460,
  iraq: 1458,
  "burkina faso": 1456,
  panama: 1454,
  "cape verde": 1452,
  uzbekistan: 1450,
  jordan: 1448,
  jamaica: 1446,
  "north macedonia": 1444,
  albania: 1442,
  bosnia: 1440,
  "bosnia and herzegovina": 1440,
  georgia: 1438,
  "united arab emirates": 1436,
  oman: 1434,
  bahrain: 1430,

  // ── Developing (likely group-stage exit) ───────────────────────────────
  honduras: 1425,
  "new zealand": 1422,
  curacao: 1418,
  haiti: 1414,
  angola: 1412,
  zambia: 1410,
  "dr congo": 1408,
  benin: 1406,
  gabon: 1404,
  uganda: 1402,
  kenya: 1400,
  tanzania: 1395,
  namibia: 1392,
  mauritania: 1390,
  madagascar: 1388,
  "new caledonia": 1370,
  "trinidad and tobago": 1380,
  guatemala: 1378,
  "el salvador": 1376,
  suriname: 1374,
  bolivia: 1372,
};

/** Normalize a country name for lookup: lowercase, strip diacritics & punctuation. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/&/g, "and")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Common abbreviation → canonical name (ESPN abbreviations seen in the feed).
const ABBR_TO_NAME: Record<string, string> = {
  ARG: "argentina", ESP: "spain", FRA: "france", ENG: "england", BRA: "brazil",
  POR: "portugal", NED: "netherlands", BEL: "belgium", GER: "germany", ITA: "italy",
  CRO: "croatia", URU: "uruguay", COL: "colombia", MAR: "morocco", SUI: "switzerland",
  DEN: "denmark", USA: "usa", MEX: "mexico", JPN: "japan", SEN: "senegal",
  ECU: "ecuador", AUT: "austria", UKR: "ukraine", KOR: "south korea", SWE: "sweden",
  SRB: "serbia", WAL: "wales", POL: "poland", PER: "peru", TUR: "turkey",
  CIV: "ivory coast", NGA: "nigeria", IRN: "iran", NOR: "norway", EGY: "egypt",
  SCO: "scotland", CZE: "czechia", ALG: "algeria", CAN: "canada", AUS: "australia",
  GRE: "greece", ROU: "romania", HUN: "hungary", CHI: "chile", CMR: "cameroon",
  TUN: "tunisia", KSA: "saudi arabia", MLI: "mali", GHA: "ghana", PAR: "paraguay",
  CRC: "costa rica", QAT: "qatar", IRL: "ireland", SVK: "slovakia", SVN: "slovenia",
  FIN: "finland", RSA: "south africa", VEN: "venezuela", IRQ: "iraq", BFA: "burkina faso",
  PAN: "panama", CPV: "cape verde", UZB: "uzbekistan", JOR: "jordan", JAM: "jamaica",
  MKD: "north macedonia", ALB: "albania", BIH: "bosnia and herzegovina", GEO: "georgia",
  UAE: "united arab emirates", OMA: "oman", BHR: "bahrain", HON: "honduras",
  NZL: "new zealand", CUW: "curacao", HAI: "haiti", ANG: "angola", ZAM: "zambia",
  COD: "dr congo", BEN: "benin", GAB: "gabon", UGA: "uganda", KEN: "kenya",
  NCL: "new caledonia", TRI: "trinidad and tobago", GUA: "guatemala", SLV: "el salvador",
  SUR: "suriname", BOL: "bolivia",
};

/**
 * Look up a national team's seed Elo rating by display name and/or abbreviation.
 * Returns WORLDCUP_DEFAULT_SEED when the team is unknown so brand-new/obscure
 * sides still get a sensible mid-low prior instead of a flat 1500 toss-up.
 */
export function getWorldCupSeedRating(name?: string, abbreviation?: string): number {
  if (name) {
    const direct = RAW_SEEDS[normalizeName(name)];
    if (direct !== undefined) return direct;
  }
  if (abbreviation) {
    const canonical = ABBR_TO_NAME[abbreviation.toUpperCase()];
    if (canonical && RAW_SEEDS[canonical] !== undefined) return RAW_SEEDS[canonical]!;
  }
  return WORLDCUP_DEFAULT_SEED;
}

/** True when the sport is the World Cup (national-team) competition. */
export function isWorldCup(sport: string): boolean {
  return sport === "WORLDCUP";
}
