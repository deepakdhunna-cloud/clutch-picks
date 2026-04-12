/**
 * Review shadow prediction logs for a given day.
 *
 * Usage: bun run backend/scripts/review-shadow-log.ts [YYYY-MM-DD]
 * Defaults to today if no date given.
 *
 * Reports:
 *   - Total games logged
 *   - Agreement rate (% old and new picked same winner)
 *   - Mean absolute confidence delta
 *   - Games with confidence delta > 10 points
 *   - Games where engines disagreed
 *   - Errors from the error log
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(__dirname, "../logs");

const dateArg = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const shadowPath = join(LOGS_DIR, `prediction_shadow_${dateArg}.jsonl`);
const errorPath = join(LOGS_DIR, `prediction_shadow_errors_${dateArg}.jsonl`);

console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║  SHADOW LOG REVIEW — ${dateArg}                          ║`);
console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

// ─── Shadow entries ─────────────────────────────────────────────────────

if (!existsSync(shadowPath)) {
  console.log(`  No shadow log found at: ${shadowPath}`);
  console.log(`  (Has the server generated any predictions today?)\n`);
} else {
  const lines = readFileSync(shadowPath, "utf-8")
    .split("\n")
    .filter(Boolean);

  const entries = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const total = entries.length;
  const agreed = entries.filter((e: any) => e.agreement).length;
  const disagreed = entries.filter((e: any) => !e.agreement);
  const agreementRate = total > 0 ? (agreed / total * 100).toFixed(1) : "N/A";

  const absDelta = entries.map((e: any) => Math.abs(e.confidenceDelta));
  const meanAbsDelta = absDelta.length > 0
    ? (absDelta.reduce((a: number, b: number) => a + b, 0) / absDelta.length).toFixed(1)
    : "N/A";

  const bigDeltas = entries.filter((e: any) => Math.abs(e.confidenceDelta) > 10);

  console.log(`  Total games logged:         ${total}`);
  console.log(`  Agreement rate:             ${agreementRate}% (${agreed}/${total})`);
  console.log(`  Mean |confidence delta|:    ${meanAbsDelta} pts`);
  console.log(`  Games with |delta| > 10:    ${bigDeltas.length}`);
  console.log(`  Disagreements:              ${disagreed.length}`);

  if (bigDeltas.length > 0) {
    console.log(`\n  ── LARGE CONFIDENCE DELTAS (> 10 pts) ──`);
    for (const e of bigDeltas) {
      const sign = e.confidenceDelta >= 0 ? "+" : "";
      console.log(`    ${e.matchup} (${e.league}): old=${e.old.confidence.toFixed(1)}% new=${e.new.confidence.toFixed(1)}% delta=${sign}${e.confidenceDelta.toFixed(1)}`);
    }
  }

  if (disagreed.length > 0) {
    console.log(`\n  ── DISAGREEMENTS (different predicted winner) ──`);
    for (const e of disagreed) {
      console.log(`    ${e.matchup} (${e.league}): old=${e.old.predictedWinner} new=${e.new.predictedWinner} | old conf=${e.old.confidence.toFixed(1)}% new conf=${e.new.confidence.toFixed(1)}%`);
    }
  }

  if (total > 0 && bigDeltas.length === 0 && disagreed.length === 0) {
    console.log(`\n  All games agree and no large deltas. Looking clean.`);
  }
}

// ─── Error entries ──────────────────────────────────────────────────────

console.log();
if (!existsSync(errorPath)) {
  console.log(`  No errors logged for ${dateArg}. ✓`);
} else {
  const errorLines = readFileSync(errorPath, "utf-8")
    .split("\n")
    .filter(Boolean);

  const errors = errorLines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  console.log(`  ⚠ ${errors.length} shadow engine errors:`);
  for (const e of errors.slice(0, 10)) {
    console.log(`    [${e.league}] game ${e.gameId}: ${e.error}`);
  }
  if (errors.length > 10) {
    console.log(`    ... and ${errors.length - 10} more`);
  }
}

console.log();
