/**
 * Admin monitoring endpoint for the beat-writer ingestion pipeline.
 *
 *   GET /api/ingestion/status   — gated on x-ingestion-admin-key
 *
 * Surfaces the live health of the pipeline without a DB console — which
 * cron cycle ran last, what came through, which sources are alive, and
 * how many active player signals are in the store per team.
 *
 * We reuse the same gate pattern as /api/calibration/run — 503 when the
 * env var is unset, 403 on bad header.
 */

import { Hono } from "hono";
import { prisma } from "../prisma";
import { getRecentCycles } from "../lib/ingestion/orchestrator";

const ingestionRouter = new Hono();

ingestionRouter.get("/status", async (c) => {
  const adminKey = process.env.INGESTION_ADMIN_KEY ?? process.env.CALIBRATION_ADMIN_KEY;
  if (!adminKey) {
    return c.json(
      {
        error: {
          message:
            "INGESTION_ADMIN_KEY (or CALIBRATION_ADMIN_KEY) not set — status endpoint disabled",
          code: "ADMIN_KEY_UNSET",
        },
      },
      503,
    );
  }
  const provided = c.req.header("x-ingestion-admin-key") ?? c.req.header("x-calibration-admin-key");
  if (provided !== adminKey) {
    return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
  }

  const recent = getRecentCycles(5);

  // Totals in the last hour — two separate queries so a slow one on
  // either side doesn't delay the other.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [itemsLastHour, signalsLastHour, activeByTeam, rePredictsLastHour] = await Promise.all([
    // "Items processed" isn't persisted per row; approximate with unique
    // sourceUrls on PlayerAvailability rows created in the last hour.
    // Null sourceUrls (tests, manual inserts) are excluded from the count
    // but that's fine — the stat is diagnostic, not billable.
    prisma.playerAvailability.findMany({
      where: { createdAt: { gte: oneHourAgo }, sourceUrl: { not: null } },
      distinct: ["sourceUrl"],
      select: { sourceUrl: true },
    }).then((rows) => rows.length).catch(() => 0),
    prisma.playerAvailability.count({
      where: { createdAt: { gte: oneHourAgo } },
    }).catch(() => 0),
    prisma.playerAvailability.groupBy({
      by: ["teamAbbreviation"],
      where: {
        supersededById: null,
        expiresAt: { gt: new Date() },
      },
      _count: { _all: true },
    }).catch(() => [] as Array<{ teamAbbreviation: string; _count: { _all: number } }>),
    prisma.predictionVersion.count({
      where: { createdAt: { gte: oneHourAgo }, triggerReason: { not: "initial" } },
    }).catch(() => 0),
  ]);

  const sourceHealth = recent[0]?.sourceStats ?? [];
  const lastErrors = recent.flatMap((c) => c.errors).slice(0, 20);

  return c.json({
    data: {
      generatedAt: new Date().toISOString(),
      lastCycleAt: recent[0]?.runAt ?? null,
      lastHour: {
        itemsProcessed: itemsLastHour,
        signalsStored: signalsLastHour,
        rePredictionsTriggered: rePredictsLastHour,
      },
      activeSignalsByTeam: activeByTeam.map((row) => ({
        teamAbbreviation: row.teamAbbreviation,
        activeSignals: row._count._all,
      })),
      sourceHealth,
      recentCycles: recent,
      recentErrors: lastErrors,
    },
  });
});

export { ingestionRouter };
