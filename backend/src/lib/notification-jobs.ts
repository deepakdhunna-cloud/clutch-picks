/**
 * Background notification jobs.
 * Runs periodically to check for events that should trigger push notifications.
 *
 * Frequency rules:
 * - Max 4 notifications per user per day (enforced in sendPushToUser)
 * - Big game alerts: 3 hours before, max 2 per day of this type
 * - Game live alerts: only for games the user has picked
 * - Pick results: when picks are resolved
 */

import { prisma } from "../prisma";
import { sendPushToUser, sendPushToAll } from "../routes/notifications";

const ESPN_ENDPOINTS: Record<string, string> = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLS: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
  NCAAB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
  EPL: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
};

// ─── GAME GOING LIVE — notify users who picked this game ─────
export async function notifyGameLive(gameId: string, homeAbbr: string, awayAbbr: string, sport: string) {
  try {
    // Find all users who picked this game
    const picks = await prisma.userPick.findMany({
      where: { gameId, result: null }, // Only pending picks
      select: { odId: true },
    });

    const userIds = [...new Set(picks.map(p => p.odId))];

    for (const userId of userIds) {
      // Check if we already sent a live alert for this game
      const already = await prisma.notificationLog.findFirst({
        where: { userId, type: 'game_live', gameId },
      });
      if (already) continue;

      await sendPushToUser(userId,
        `🔴 ${awayAbbr} vs ${homeAbbr} is LIVE`,
        `Your ${sport} pick is in play. Tap to watch.`,
        { type: 'game_live', gameId, screen: 'game' }
      );
    }
  } catch (err) {
    console.error('[NotifyJobs] notifyGameLive error:', err);
  }
}

// ─── PICK RESULT — notify when a pick is resolved ────────────
export async function notifyPickResult(userId: string, gameId: string, result: 'win' | 'loss', homeAbbr: string, awayAbbr: string) {
  try {
    // Check if already notified for this game result
    const already = await prisma.notificationLog.findFirst({
      where: { userId, type: 'pick_result', gameId },
    });
    if (already) return;

    if (result === 'win') {
      await sendPushToUser(userId,
        `✅ Your pick was correct!`,
        `${awayAbbr} vs ${homeAbbr} — you called it. Check your updated record.`,
        { type: 'pick_result', gameId, screen: 'profile' }
      );
    } else {
      await sendPushToUser(userId,
        `${awayAbbr} vs ${homeAbbr} — Final`,
        `This one didn't go your way. Check the breakdown.`,
        { type: 'pick_result', gameId, screen: 'game' }
      );
    }
  } catch (err) {
    console.error('[NotifyJobs] notifyPickResult error:', err);
  }
}

// ─── CHECK LIVE GAMES — scans ESPN for newly live games and notifies pickers ─
export async function checkLiveGamesAndNotify() {
  try {
    // Get all pending picks to know which games users care about
    const pendingPicks = await prisma.userPick.findMany({
      where: { result: null },
      select: { gameId: true, sport: true, homeTeam: true, awayTeam: true },
    });

    if (pendingPicks.length === 0) return;

    // Unique game IDs users have picked
    const pickedGameIds = new Set(pendingPicks.map(p => p.gameId));
    // Map game → sport/teams for notification text
    const gameInfo = new Map<string, { sport: string; home: string; away: string }>();
    for (const p of pendingPicks) {
      if (!gameInfo.has(p.gameId)) {
        gameInfo.set(p.gameId, { sport: p.sport ?? '', home: p.homeTeam ?? '', away: p.awayTeam ?? '' });
      }
    }

    // Check each sport's scoreboard for live games
    const today = new Date().toISOString().split("T")[0]!.replace(/-/g, "");

    for (const [sport, url] of Object.entries(ESPN_ENDPOINTS)) {
      try {
        const params = new URLSearchParams({ dates: today });
        if (sport === "NCAAB") { params.set("groups", "50"); params.set("limit", "300"); }
        if (sport === "NCAAF") { params.set("groups", "80"); params.set("limit", "300"); }

        const res = await fetch(`${url}?${params.toString()}`);
        if (!res.ok) continue;

        const data = await res.json() as { events?: Array<{
          id: string;
          competitions: Array<{
            competitors: Array<{ homeAway: string; team?: { abbreviation?: string } }>;
            status: { type: { state: string } };
          }>;
        }> };

        if (!data.events) continue;

        for (const event of data.events) {
          if (!pickedGameIds.has(event.id)) continue;

          const comp = event.competitions[0];
          if (!comp) continue;

          const state = comp.status.type.state.toLowerCase();
          if (state !== 'in') continue; // 'in' = in progress

          const home = comp.competitors.find(c => c.homeAway === 'home');
          const away = comp.competitors.find(c => c.homeAway === 'away');
          const info = gameInfo.get(event.id);

          const homeAbbr = home?.team?.abbreviation ?? info?.home ?? 'HOME';
          const awayAbbr = away?.team?.abbreviation ?? info?.away ?? 'AWAY';
          const sportName = info?.sport ?? sport;

          await notifyGameLive(event.id, homeAbbr, awayAbbr, sportName);
        }
      } catch {
        // Skip this sport and continue
      }
    }

    console.log('[NotifyJobs] Live game check completed');
  } catch (err) {
    console.error('[NotifyJobs] checkLiveGamesAndNotify error:', err);
  }
}

// ─── BIG GAME ALERTS — 3 hours before high-interest games ────
export async function checkBigGameAlerts() {
  try {
    // Check NotificationLog to avoid spamming
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const bigGamesSentToday = await prisma.notificationLog.count({
      where: { type: 'big_game', sentAt: { gte: todayStart } },
    });

    // Max 2 big game alerts per day
    if (bigGamesSentToday >= 2) return;

    const now = new Date();
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const threeHoursThirtyLater = new Date(now.getTime() + 3.5 * 60 * 60 * 1000);
    const today = now.toISOString().split("T")[0]!.replace(/-/g, "");

    // Scan each sport for upcoming games with high confidence predictions
    for (const [sport, url] of Object.entries(ESPN_ENDPOINTS)) {
      if (bigGamesSentToday >= 2) break;

      try {
        const params = new URLSearchParams({ dates: today });
        if (sport === "NCAAB") { params.set("groups", "50"); params.set("limit", "300"); }
        if (sport === "NCAAF") { params.set("groups", "80"); params.set("limit", "300"); }

        const res = await fetch(`${url}?${params.toString()}`);
        if (!res.ok) continue;

        const data = await res.json() as { events?: Array<{
          id: string;
          date: string;
          name: string;
          competitions: Array<{
            competitors: Array<{ homeAway: string; team?: { abbreviation?: string; displayName?: string } }>;
            status: { type: { state: string } };
          }>;
        }> };

        if (!data.events) continue;

        for (const event of data.events) {
          const comp = event.competitions[0];
          if (!comp) continue;

          const state = comp.status.type.state.toLowerCase();
          if (state !== 'pre') continue; // Only upcoming games

          const gameTime = new Date(event.date);
          // Check if game starts in the 3h–3.5h window
          if (gameTime < threeHoursLater || gameTime > threeHoursThirtyLater) continue;

          // Check if we have a high-confidence prediction for this game
          const prediction = await prisma.predictionResult.findFirst({
            where: { gameId: event.id, confidence: { gte: 70 } },
          });
          if (!prediction) continue;

          // Already sent alert for this game?
          const alreadySent = await prisma.notificationLog.findFirst({
            where: { type: 'big_game', gameId: event.id },
          });
          if (alreadySent) continue;

          const home = comp.competitors.find(c => c.homeAway === 'home');
          const away = comp.competitors.find(c => c.homeAway === 'away');
          const homeAbbr = home?.team?.abbreviation ?? 'HOME';
          const awayAbbr = away?.team?.abbreviation ?? 'AWAY';

          await sendPushToAll(
            `🏆 Big Game Alert: ${awayAbbr} vs ${homeAbbr}`,
            `${sport} kicks off in 3 hours — our model has ${prediction.confidence}% confidence. Make your pick!`,
            { type: 'big_game', gameId: event.id, screen: 'game' }
          );

          console.log(`[NotifyJobs] Big game alert sent: ${awayAbbr} vs ${homeAbbr} (${sport})`);
          break; // One alert per sport check cycle
        }
      } catch {
        // Skip sport
      }
    }
  } catch (err) {
    console.error('[NotifyJobs] checkBigGameAlerts error:', err);
  }
}

// ─── STREAK MILESTONE — notify on 5, 7, 10 correct in a row ─
export async function checkStreakMilestone(userId: string, currentStreak: number) {
  try {
    const milestones = [5, 7, 10, 15, 20];
    if (!milestones.includes(currentStreak)) return;

    // Check if already notified for this milestone
    const already = await prisma.notificationLog.findFirst({
      where: { userId, type: 'streak', body: { contains: String(currentStreak) } },
    });
    if (already) return;

    await sendPushToUser(userId,
      `🔥 ${currentStreak}-pick win streak!`,
      `You're on fire — ${currentStreak} correct in a row. Keep it going.`,
      { type: 'streak', screen: 'profile' }
    );
  } catch (err) {
    console.error('[NotifyJobs] checkStreakMilestone error:', err);
  }
}

// ─── CALCULATE CURRENT WIN STREAK — counts consecutive wins ──
export async function calculateWinStreak(userId: string): Promise<number> {
  const picks = await prisma.userPick.findMany({
    where: { odId: userId, result: { not: null } },
    orderBy: { updatedAt: 'desc' },
    select: { result: true },
    take: 50,
  });

  let streak = 0;
  for (const pick of picks) {
    if (pick.result === 'win') {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
