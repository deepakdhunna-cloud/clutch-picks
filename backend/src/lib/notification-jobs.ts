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
import { fetchWithTimeout } from "./fetch-with-timeout";

const ESPN_ENDPOINTS: Record<string, string> = {
  NFL: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  NBA: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  MLB: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  NHL: "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard",
  MLS: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
  NCAAF: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
  NCAAB: "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard",
  EPL: "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard",
  UCL: "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard",
  IPL: "https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard",
};

type ESPNNotificationTeam = {
  abbreviation?: string;
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  logo?: string;
  logos?: Array<{ href?: string }>;
};

type ESPNNotificationCompetitor = {
  homeAway: string;
  team?: ESPNNotificationTeam;
};

type ESPNNotificationCompetition = {
  competitors: ESPNNotificationCompetitor[];
  odds?: Array<{
    homeTeamOdds?: { favorite?: boolean };
    awayTeamOdds?: { favorite?: boolean };
  }>;
  status: { type: { state: string } };
};

function logoForTeam(team?: ESPNNotificationTeam): string | undefined {
  return team?.logo ?? team?.logos?.find((logo) => logo.href)?.href;
}

function displayForTeam(team?: ESPNNotificationTeam, fallback = "Team"): string {
  return team?.displayName ?? team?.shortDisplayName ?? team?.name ?? team?.abbreviation ?? fallback;
}

function gamePayload(args: {
  type: string;
  gameId: string;
  sport: string;
  home?: ESPNNotificationCompetitor;
  away?: ESPNNotificationCompetitor;
  highlightSide?: "home" | "away";
}) {
  const highlight = args.highlightSide === "home" ? args.home : args.highlightSide === "away" ? args.away : undefined;
  return {
    type: args.type,
    gameId: args.gameId,
    screen: "game",
    sport: args.sport,
    homeTeam: displayForTeam(args.home?.team, "Home"),
    awayTeam: displayForTeam(args.away?.team, "Away"),
    homeAbbr: args.home?.team?.abbreviation,
    awayAbbr: args.away?.team?.abbreviation,
    homeLogo: logoForTeam(args.home?.team),
    awayLogo: logoForTeam(args.away?.team),
    highlightTeam: highlight ? displayForTeam(highlight.team) : undefined,
    highlightLogo: logoForTeam(highlight?.team),
  };
}

function eventTeams(comp: ESPNNotificationCompetition) {
  return {
    home: comp.competitors.find(c => c.homeAway === "home"),
    away: comp.competitors.find(c => c.homeAway === "away"),
  };
}

function marketFavoriteSide(comp: ESPNNotificationCompetition): "home" | "away" | null {
  const odds = comp.odds?.[0];
  if (odds?.homeTeamOdds?.favorite) return "home";
  if (odds?.awayTeamOdds?.favorite) return "away";
  return null;
}

// ─── GAME GOING LIVE — notify users who picked this game ─────
export async function notifyGameLive(
  gameId: string,
  homeAbbr: string,
  awayAbbr: string,
  sport: string,
  meta: Record<string, any> = {},
) {
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
        `${awayAbbr} vs ${homeAbbr} is live`,
        `Your ${sport} pick is moving now. Jump in for the live board.`,
        { type: 'game_live', gameId, screen: 'game', sport, ...meta }
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
        `You called it`,
        `${awayAbbr} vs ${homeAbbr} landed your way. Your record just got brighter.`,
        { type: 'pick_result', gameId, screen: 'profile' }
      );
    } else {
      await sendPushToUser(userId,
        `${awayAbbr} vs ${homeAbbr} — Final`,
        `The board gets another data point. Open the breakdown and reset for the next pick.`,
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

        const res = await fetchWithTimeout(`${url}?${params.toString()}`, { timeoutMs: 20000 });
        if (!res.ok) continue;

        const data = await res.json() as { events?: Array<{
          id: string;
          competitions: Array<{
            competitors: ESPNNotificationCompetitor[];
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

          const { home, away } = eventTeams(comp);
          const info = gameInfo.get(event.id);

          const homeAbbr = home?.team?.abbreviation ?? info?.home ?? 'HOME';
          const awayAbbr = away?.team?.abbreviation ?? info?.away ?? 'AWAY';
          const sportName = info?.sport ?? sport;

          await notifyGameLive(event.id, homeAbbr, awayAbbr, sportName, gamePayload({
            type: 'game_live',
            gameId: event.id,
            sport: sportName,
            home,
            away,
          }));
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
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [sentBigGames, sentSpotlights, sentUnderdogs] = await Promise.all([
      prisma.notificationLog.findMany({
        where: { type: 'big_game', sentAt: { gte: todayStart }, gameId: { not: null } },
        select: { gameId: true },
        distinct: ['gameId'],
      }),
      prisma.notificationLog.findMany({
        where: { type: 'game_spotlight', sentAt: { gte: todayStart }, gameId: { not: null } },
        select: { gameId: true },
        distinct: ['gameId'],
      }),
      prisma.notificationLog.findMany({
        where: { type: 'underdog_alert', sentAt: { gte: todayStart }, gameId: { not: null } },
        select: { gameId: true },
        distinct: ['gameId'],
      }),
    ]);

    const sentBigGameIds = new Set(sentBigGames.map((log) => log.gameId).filter(Boolean));
    const sentSpotlightIds = new Set(sentSpotlights.map((log) => log.gameId).filter(Boolean));
    const sentUnderdogIds = new Set(sentUnderdogs.map((log) => log.gameId).filter(Boolean));
    let bigGamesSentToday = sentBigGameIds.size;
    let spotlightsSentToday = sentSpotlightIds.size;
    let underdogsSentToday = sentUnderdogIds.size;

    const now = new Date();
    const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const threeHoursThirtyLater = new Date(now.getTime() + 3.5 * 60 * 60 * 1000);
    const fortyFiveMinutesLater = new Date(now.getTime() + 45 * 60 * 1000);
    const twoHoursThirtyLater = new Date(now.getTime() + 2.5 * 60 * 60 * 1000);
    const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const today = now.toISOString().split("T")[0]!.replace(/-/g, "");

    // Scan each sport for upcoming games with high-confidence, spotlight, and
    // underdog notification opportunities.
    for (const [sport, url] of Object.entries(ESPN_ENDPOINTS)) {
      if (bigGamesSentToday >= 2 && spotlightsSentToday >= 1 && underdogsSentToday >= 2) break;

      try {
        const params = new URLSearchParams({ dates: today });
        if (sport === "NCAAB") { params.set("groups", "50"); params.set("limit", "300"); }
        if (sport === "NCAAF") { params.set("groups", "80"); params.set("limit", "300"); }

        const res = await fetchWithTimeout(`${url}?${params.toString()}`, { timeoutMs: 20000 });
        if (!res.ok) continue;

        const data = await res.json() as { events?: Array<{
          id: string;
          date: string;
          name: string;
          competitions: ESPNNotificationCompetition[];
        }> };

        if (!data.events) continue;

        for (const event of data.events) {
          const comp = event.competitions[0];
          if (!comp) continue;

          const state = comp.status.type.state.toLowerCase();
          if (state !== 'pre') continue; // Only upcoming games

          const gameTime = new Date(event.date);

          const prediction = await prisma.predictionResult.findFirst({
            where: { gameId: event.id, confidence: { gte: 55 } },
          });
          if (!prediction) continue;

          const { home, away } = eventTeams(comp);
          const homeAbbr = home?.team?.abbreviation ?? 'HOME';
          const awayAbbr = away?.team?.abbreviation ?? 'AWAY';
          const predictedSide = prediction.predictedWinner === 'home' ? 'home' : 'away';
          const pick = predictedSide === 'home' ? home : away;
          const favoriteSide = marketFavoriteSide(comp);
          const favorite = favoriteSide === 'home' ? home : favoriteSide === 'away' ? away : undefined;
          const pickAbbr = pick?.team?.abbreviation ?? (predictedSide === 'home' ? homeAbbr : awayAbbr);
          const favoriteAbbr = favorite?.team?.abbreviation;
          const baseData = gamePayload({
            type: 'big_game',
            gameId: event.id,
            sport,
            home,
            away,
            highlightSide: predictedSide,
          });

          let sentForEvent = false;

          if (
            bigGamesSentToday < 2 &&
            !sentBigGameIds.has(event.id) &&
            prediction.confidence >= 70 &&
            gameTime >= threeHoursLater &&
            gameTime <= threeHoursThirtyLater
          ) {
            await sendPushToAll(
              `Prime pick warming up: ${awayAbbr} vs ${homeAbbr}`,
              `${sport} starts in about 3 hours. Clutch Picks likes ${pickAbbr} at ${prediction.confidence}% confidence.`,
              { ...baseData, type: 'big_game' }
            );
            sentBigGameIds.add(event.id);
            bigGamesSentToday = sentBigGameIds.size;
            sentForEvent = true;
            console.log(`[NotifyJobs] Big game alert sent: ${awayAbbr} vs ${homeAbbr} (${sport})`);
          }

          if (
            !sentForEvent &&
            underdogsSentToday < 2 &&
            favoriteSide &&
            favoriteSide !== predictedSide &&
            !sentUnderdogIds.has(event.id) &&
            gameTime >= fortyFiveMinutesLater &&
            gameTime <= fourHoursLater
          ) {
            await sendPushToAll(
              `Underdog watch: ${pickAbbr} has a real path`,
              `${favoriteAbbr ? `The market leans ${favoriteAbbr}, but ` : ''}Clutch Picks gives ${pickAbbr} the edge at ${prediction.confidence}%. This is worth a look.`,
              { ...baseData, type: 'underdog_alert' },
            );
            sentUnderdogIds.add(event.id);
            underdogsSentToday = sentUnderdogIds.size;
            sentForEvent = true;
            console.log(`[NotifyJobs] Underdog alert sent: ${pickAbbr} in ${awayAbbr} vs ${homeAbbr} (${sport})`);
          }

          if (
            !sentForEvent &&
            spotlightsSentToday < 1 &&
            !sentSpotlightIds.has(event.id) &&
            prediction.confidence >= 58 &&
            gameTime >= fortyFiveMinutesLater &&
            gameTime <= twoHoursThirtyLater
          ) {
            await sendPushToAll(
              `Spotlight game: ${awayAbbr} vs ${homeAbbr}`,
              `The board is heating up: ${pickAbbr} is the current model lean at ${prediction.confidence}%. Open the matchup read.`,
              { ...baseData, type: 'game_spotlight' },
            );
            sentSpotlightIds.add(event.id);
            spotlightsSentToday = sentSpotlightIds.size;
            console.log(`[NotifyJobs] Game spotlight sent: ${awayAbbr} vs ${homeAbbr} (${sport})`);
          }
        }
      } catch {
        // Skip sport
      }
    }
  } catch (err) {
    console.error('[NotifyJobs] checkBigGameAlerts error:', err);
  }
}

// ─── PREDICTION WINNER CHANGED — notify users who picked the affected game ─
export async function notifyWinnerFlip(gameId: string, homeAbbr: string, awayAbbr: string, sport: string, newWinner: 'home' | 'away', confidence: number) {
  try {
    const newWinnerAbbr = newWinner === 'home' ? homeAbbr : awayAbbr;

    // Find all users who picked this game (pending picks only — game hasn't ended)
    const picks = await prisma.userPick.findMany({
      where: { gameId, result: null },
      select: { odId: true },
    });

    const userIds = [...new Set(picks.map(p => p.odId))];

    for (const userId of userIds) {
      // Only send one winner-flip notification per game per user
      const already = await prisma.notificationLog.findFirst({
        where: { userId, type: 'winner_flip', gameId },
      });
      if (already) continue;

      await sendPushToUser(userId,
        `New edge: ${newWinnerAbbr} is now the lean`,
        `${awayAbbr} vs ${homeAbbr} just shifted. Updated data moved the pick to ${confidence}%.`,
        { type: 'winner_flip', gameId, screen: 'game', sport }
      );
    }

    // Also notify all users (not just pickers) since this is a significant event
    await sendPushToAll(
      `Board shift: ${awayAbbr} vs ${homeAbbr}`,
      `${sport} just got interesting: Clutch Picks now leans ${newWinnerAbbr} at ${confidence}%.`,
      { type: 'winner_flip', gameId, screen: 'game', sport, highlightTeam: newWinnerAbbr },
      2,
      userIds,
    );

    console.log(`[NotifyJobs] Winner flip: ${awayAbbr} vs ${homeAbbr} → now ${newWinnerAbbr} (${confidence}%)`);
  } catch (err) {
    console.error('[NotifyJobs] notifyWinnerFlip error:', err);
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
      `${currentStreak}-pick win streak`,
      `That run is getting loud: ${currentStreak} correct in a row. Your board is rolling.`,
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
