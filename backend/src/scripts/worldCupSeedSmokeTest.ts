/**
 * Smoke test: verify World Cup national-team seed ratings produce differentiated
 * win probabilities (not flat toss-ups) using the real Elo + home-bonus math.
 *
 * Run: bun run src/scripts/worldCupSeedSmokeTest.ts
 */
import { getWorldCupSeedRating } from "../lib/worldCupSeeds";

// Inline pure Elo math (avoids importing elo.ts, which pulls in prisma).
const WORLDCUP_HOME_BONUS = 8;
function expectedScore(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}
function getEloPrediction(homeRating: number, awayRating: number): { homeWinProb: number; awayWinProb: number } {
  const homeWinProb = expectedScore(homeRating + WORLDCUP_HOME_BONUS, awayRating);
  return { homeWinProb, awayWinProb: 1 - homeWinProb };
}

const matchups: Array<[string, string]> = [
  ["France", "Norway"],
  ["Saudi Arabia", "Cape Verde"],
  ["Iraq", "Senegal"],
  ["Spain", "Uruguay"],
  ["Brazil", "South Korea"],
  ["Argentina", "Australia"],
  ["England", "Iran"],
];

let allDifferentiated = true;

console.log("World Cup seed-rating prediction check\n" + "=".repeat(60));
for (const [home, away] of matchups) {
  const hr = getWorldCupSeedRating(home);
  const ar = getWorldCupSeedRating(away);
  const { homeWinProb, awayWinProb } = getEloPrediction(hr, ar);
  // crude draw allocation just for display sanity
  const drawApprox = Math.max(0.16, 0.30 - Math.abs(homeWinProb - awayWinProb) * 0.35);
  const scale = (1 - drawApprox);
  const h = (homeWinProb * scale * 100).toFixed(1);
  const a = (awayWinProb * scale * 100).toFixed(1);
  const d = (drawApprox * 100).toFixed(1);
  const pick = homeWinProb > awayWinProb ? home : away;
  const spread = Math.abs(homeWinProb - awayWinProb);
  if (spread < 0.04) allDifferentiated = false; // essentially a toss-up
  console.log(
    `${home} (${Math.round(hr)}) vs ${away} (${Math.round(ar)})  ->  ` +
    `H ${h}% / D ${d}% / A ${a}%  pick=${pick}`
  );
}
console.log("=".repeat(60));
console.log(allDifferentiated ? "PASS: all matchups differentiated" : "FAIL: some matchups still toss-ups");
process.exit(allDifferentiated ? 0 : 1);
