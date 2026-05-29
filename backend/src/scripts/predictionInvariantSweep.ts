type Side = "home" | "away" | "draw" | "none";
type ApiObject = Record<string, any>;

type SweepIssue = {
  id: string;
  sport: string;
  name: string;
  issue: string;
  details?: ApiObject;
};

const DEFAULT_BASE_URL = "https://clutch-picks-production.up.railway.app";
const EXPECTED_ENGINE_VERSION = "2.10.0-source-aware-availability";

const baseUrl = (process.env.PREDICTION_SWEEP_BASE_URL ?? process.env.BACKEND_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
const sweepDate = process.env.PREDICTION_SWEEP_DATE ?? new Date().toISOString().slice(0, 10);
const expectedEngineVersion = process.env.EXPECTED_PREDICTION_ENGINE_VERSION ?? EXPECTED_ENGINE_VERSION;
const endpoints = [
  "/api/games",
  "/api/games/top-picks",
  `/api/games/date/${sweepDate}`,
];

const TOP_PICK_MIN_CONFIDENCE = 56;
const TOP_PICK_BLOCKED_TAGS = new Set(["thin-data", "low-conviction"]);
const TOP_PICK_BLOCKED_WARNING_REGEX =
  /reliability reserve|missing critical|data coverage is thin|source unavailable|confidence compressed/i;

function asGames(payload: unknown): ApiObject[] {
  if (Array.isArray(payload)) return payload as ApiObject[];
  const object = payload as ApiObject | null;
  if (Array.isArray(object?.games)) return object.games;
  if (Array.isArray(object?.data)) return object.data;
  return [];
}

function gameId(game: ApiObject): string {
  return String(game.id ?? game.gameId ?? game.eventId ?? "unknown");
}

function sport(game: ApiObject): string {
  return String(game.sport ?? game.league ?? game.prediction?.sport ?? "").toUpperCase();
}

function gameName(game: ApiObject): string {
  const away = game.awayTeam?.abbreviation ?? game.awayTeam?.name ?? "Away";
  const home = game.homeTeam?.abbreviation ?? game.homeTeam?.name ?? "Home";
  return `${away} @ ${home}`;
}

function pickSide(game: ApiObject): Side {
  const canonical = game.prediction?.canonicalResult ?? game.canonicalResult;
  const pick = canonical?.finalPick;
  if (pick === "home" || pick === "away" || pick === "draw") return pick;

  const winner = game.prediction?.predictedWinner ?? game.predictedWinner;
  if (!winner) return "none";
  if (winner.teamId && winner.teamId === game.homeTeam?.id) return "home";
  if (winner.teamId && winner.teamId === game.awayTeam?.id) return "away";
  return "none";
}

function probabilities(game: ApiObject): { home: number; away: number; draw?: number } {
  const prediction = game.prediction ?? {};
  const canonical = prediction.canonicalResult?.probabilities ?? game.canonicalResult?.probabilities;
  return {
    home: Number(canonical?.home ?? prediction.homeWinProbability),
    away: Number(canonical?.away ?? prediction.awayWinProbability),
    draw: canonical?.draw === undefined ? undefined : Number(canonical.draw),
  };
}

function projection(game: ApiObject): ApiObject | null {
  return game.prediction?.projection ?? game.projection ?? game.prediction?.simulationSummary ?? null;
}

function spreadThreshold(sportKey: string): number {
  if (sportKey === "NBA" || sportKey === "NCAAB") return 0.6;
  if (sportKey === "NFL" || sportKey === "NCAAF") return 0.45;
  if (sportKey === "IPL") return 3;
  if (["MLB", "NHL", "MLS", "EPL", "UCL"].includes(sportKey)) return 0.12;
  if (sportKey === "TENNIS") return 0.08;
  return 0.25;
}

function projectedTotalBounds(sportKey: string): { min: number; max: number } {
  const bounds: Record<string, { min: number; max: number }> = {
    NBA: { min: 185, max: 255 },
    NCAAB: { min: 108, max: 178 },
    NFL: { min: 30, max: 63 },
    NCAAF: { min: 34, max: 78 },
    MLB: { min: 5.2, max: 13.4 },
    NHL: { min: 4.0, max: 8.6 },
    MLS: { min: 1.4, max: 4.4 },
    EPL: { min: 1.4, max: 4.5 },
    UCL: { min: 1.5, max: 4.8 },
    IPL: { min: 245, max: 430 },
    TENNIS: { min: 16.0, max: 38.0 },
  };
  return bounds[sportKey] ?? { min: 0, max: Number.POSITIVE_INFINITY };
}

function projectionSide(game: ApiObject, projected: ApiObject): Side {
  const sportKey = sport(game);
  const spread = Number(
    projected.projectedSpread ??
      Number(projected.projectedHomeScore) - Number(projected.projectedAwayScore),
  );
  if (!Number.isFinite(spread)) return "none";
  if (Math.abs(spread) < spreadThreshold(sportKey)) {
    return ["MLS", "EPL", "UCL"].includes(sportKey) ? "draw" : "none";
  }
  return spread > 0 ? "home" : "away";
}

function roundedTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function marketFields(values: unknown[]): unknown[] {
  return values.filter((value) => value !== undefined && value !== null);
}

function issue(game: ApiObject, message: string, details?: ApiObject): SweepIssue {
  return {
    id: gameId(game),
    sport: sport(game),
    name: gameName(game),
    issue: message,
    ...(details ? { details } : {}),
  };
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

async function main(): Promise<void> {
  const endpointCounts: Array<{ endpoint: string; games: number; predicted: number }> = [];
  const seen = new Map<string, ApiObject>();
  const issues: SweepIssue[] = [];

  const health = await fetchJson("/health") as ApiObject;
  const healthVersion = health.build?.predictionEngineVersion;
  if (healthVersion !== expectedEngineVersion) {
    throw new Error(`health reports engine ${healthVersion}; expected ${expectedEngineVersion}`);
  }

  for (const endpoint of endpoints) {
    const games = asGames(await fetchJson(endpoint));
    endpointCounts.push({
      endpoint,
      games: games.length,
      predicted: games.filter((game) => game.prediction || game.canonicalResult).length,
    });
    for (const game of games) seen.set(gameId(game), game);

    if (endpoint === "/api/games/top-picks") {
      for (const game of games) {
        const prediction = game.prediction;
        const canonical = prediction?.canonicalResult;
        if (!prediction || !canonical) {
          issues.push(issue(game, "top-pick response included a game without canonical prediction"));
          continue;
        }
        const confidence = Number(canonical.confidence ?? prediction.confidence);
        const tags = canonical.decisionProfile?.tags ?? [];
        const warnings = canonical.warnings ?? [];
        if (!Number.isFinite(confidence) || confidence < TOP_PICK_MIN_CONFIDENCE) {
          issues.push(issue(game, `top-pick confidence ${confidence} is below ${TOP_PICK_MIN_CONFIDENCE}`));
        }
        if (prediction.snapshotType === "stored-pregame") {
          issues.push(issue(game, "top-pick response included a stored pregame snapshot"));
        }
        if (canonical.decisionProfile?.lowDataWarning) {
          issues.push(issue(game, "top-pick response included a low-data prediction"));
        }
        if (tags.some((tag: string) => TOP_PICK_BLOCKED_TAGS.has(tag))) {
          issues.push(issue(game, "top-pick response included a blocked decision tag", { tags }));
        }
        if (warnings.some((warning: string) => TOP_PICK_BLOCKED_WARNING_REGEX.test(warning))) {
          issues.push(issue(game, "top-pick response included blocked warning", { warnings }));
        }
      }
    }
  }

  for (const game of seen.values()) {
    const predictionObject = game.prediction;
    if (!predictionObject) continue;

    const canonical = predictionObject.canonicalResult;
    const isStoredPregameSnapshot = predictionObject.snapshotType === "stored-pregame";
    const pick = pickSide(game);
    const p = probabilities(game);
    const finalProbability = Number(canonical?.finalProbability ?? predictionObject.confidence / 100);

    if (canonical?.dataVersion && canonical.dataVersion !== expectedEngineVersion && !isStoredPregameSnapshot) {
      issues.push(issue(game, `unexpected dataVersion ${canonical.dataVersion}`));
    }
    if (isStoredPregameSnapshot && !canonical?.warnings?.includes("Stored pregame prediction snapshot; not recomputed after final.")) {
      issues.push(issue(game, "stored pregame snapshot is missing audit warning"));
    }

    const probabilitySum = p.draw === undefined ? p.home + p.away : p.home + p.away + p.draw;
    if (!Number.isFinite(probabilitySum) || Math.abs(probabilitySum - 1) > 0.012) {
      issues.push(issue(game, `probabilities sum to ${probabilitySum}`));
    }

    if (pick === "home" && p.home + 0.001 < p.away) {
      issues.push(issue(game, `home pick but home probability ${p.home} < away ${p.away}`));
    }
    if (pick === "away" && p.away + 0.001 < p.home) {
      issues.push(issue(game, `away pick but away probability ${p.away} < home ${p.home}`));
    }
    if (pick === "draw" && p.draw !== undefined && (p.draw + 0.001 < p.home || p.draw + 0.001 < p.away)) {
      issues.push(issue(game, `draw pick but draw probability ${p.draw} is not highest`));
    }

    const expectedProbability = pick === "home" ? p.home : pick === "away" ? p.away : pick === "draw" ? p.draw : undefined;
    if (expectedProbability !== undefined && Number.isFinite(finalProbability) && Math.abs(finalProbability - expectedProbability) > 0.012) {
      issues.push(issue(game, `finalProbability ${finalProbability} does not match picked probability ${expectedProbability}`));
    }

    const projected = projection(game);
    if (projected) {
      const projectedSide = projectionSide(game, projected);
      if (pick !== "none" && projectedSide !== pick) {
        issues.push(issue(game, `projection favors ${projectedSide} while final pick is ${pick}`, {
          projectedSpread: projected.projectedSpread,
          projectedHomeScore: projected.projectedHomeScore,
          projectedAwayScore: projected.projectedAwayScore,
        }));
      }

      const scoreSpread = roundedTenth(Number(projected.projectedHomeScore) - Number(projected.projectedAwayScore));
      const reportedSpread = Number(projected.projectedSpread);
      if (Number.isFinite(scoreSpread) && Number.isFinite(reportedSpread) && Math.abs(scoreSpread - reportedSpread) > 0.001) {
        issues.push(issue(game, `projectedSpread ${reportedSpread} does not match displayed score spread ${scoreSpread}`));
      }

      const scoreTotal = roundedTenth(Number(projected.projectedHomeScore) + Number(projected.projectedAwayScore));
      const reportedTotal = Number(projected.projectedTotal);
      if (Number.isFinite(scoreTotal) && Number.isFinite(reportedTotal) && Math.abs(scoreTotal - reportedTotal) > 0.001) {
        issues.push(issue(game, `projectedTotal ${reportedTotal} does not match displayed score total ${scoreTotal}`));
      }
      const totalBounds = projectedTotalBounds(sport(game));
      if (Number.isFinite(reportedTotal) && (reportedTotal < totalBounds.min || reportedTotal > totalBounds.max)) {
        issues.push(issue(game, `projectedTotal ${reportedTotal} is outside ${sport(game)} bounds ${totalBounds.min}-${totalBounds.max}`));
      }
    }

    const gameMarketFields = marketFields([game.marketFavorite, game.spread, game.overUnder]);
    const predictionMarketFields = marketFields([predictionObject.marketFavorite, predictionObject.spread, predictionObject.overUnder]);
    if (gameMarketFields.length === 0 && predictionMarketFields.length > 0) {
      issues.push(issue(game, "prediction exposes market fields when game has no market fields"));
    }
  }

  const summary = {
    baseUrl,
    sweepDate,
    healthCommit: health.build?.gitCommit ?? null,
    engineVersion: health.build?.predictionEngineVersion ?? null,
    endpointCounts,
    uniqueGames: seen.size,
    predictedGames: [...seen.values()].filter((game) => game.prediction).length,
    issueCount: issues.length,
    issues: issues.slice(0, 50),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (issues.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
