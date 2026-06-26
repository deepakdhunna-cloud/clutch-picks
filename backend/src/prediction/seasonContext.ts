export type SeasonPhase =
  | "preseason"
  | "spring_training"
  | "regular_season"
  | "early_season"
  | "late_season"
  | "play_in"
  | "playoffs"
  | "finals"
  | "group_stage"
  | "tournament"
  | "cup"
  | "conference_title"
  | "bowl";

export interface NarrativeSeasonContext {
  phase: SeasonPhase;
  label: string;
  detail: string;
  source: "espn" | "date";
}

export interface SeasonContextSource {
  sport: string;
  gameTime: string;
  seasonType?: number | string | null;
  seasonSlug?: string | null;
  seasonName?: string | null;
  eventName?: string | null;
  competitionNotes?: string[];
}

function monthDay(date: Date): { month: number; day: number } {
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function inRange(
  value: { month: number; day: number },
  start: { month: number; day: number },
  end: { month: number; day: number },
): boolean {
  const numeric = value.month * 100 + value.day;
  const startNumeric = start.month * 100 + start.day;
  const endNumeric = end.month * 100 + end.day;
  if (startNumeric <= endNumeric) {
    return numeric >= startNumeric && numeric <= endNumeric;
  }
  return numeric >= startNumeric || numeric <= endNumeric;
}

function context(
  phase: SeasonPhase,
  label: string,
  detail: string,
  source: "espn" | "date",
): NarrativeSeasonContext {
  return { phase, label, detail, source };
}

export function deriveSeasonContext(
  input: SeasonContextSource,
): NarrativeSeasonContext | null {
  const sport = input.sport.toUpperCase();
  const explicitText = [
    input.seasonSlug,
    input.seasonName,
    input.eventName,
    ...(input.competitionNotes ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const seasonType = String(input.seasonType ?? "").toLowerCase();
  if (explicitText.includes("spring training")) {
    return context(
      "spring_training",
      "MLB spring training setting",
      "This is spring-training context, so the narrative should stay careful with normal season form and lean on only the matchup data provided.",
      "espn",
    );
  }
  if (explicitText.includes("super bowl")) {
    return context(
      "finals",
      "Super Bowl setting",
      "This is the Super Bowl setting, so regular-season numbers are background and the story should focus on matchup edges that matter in one game.",
      "espn",
    );
  }
  if (explicitText.includes("world series")) {
    return context(
      "finals",
      "World Series setting",
      "This is World Series context, so regular-season numbers are background and pitching, bullpen, availability, and current matchup data should drive the story.",
      "espn",
    );
  }
  if (
    explicitText.includes("stanley cup final") ||
    explicitText.includes("stanley cup finals")
  ) {
    return context(
      "finals",
      "Stanley Cup Final setting",
      "This is Stanley Cup Final context, so regular-season numbers are background and durable matchup edges, goalie form, and availability should carry the read.",
      "espn",
    );
  }
  if (explicitText.includes("mls cup")) {
    return context(
      "finals",
      "MLS Cup setting",
      "This is MLS Cup context, so regular-season table form is background and the pick should be framed like a one-match title game.",
      "espn",
    );
  }
  if (
    explicitText.includes("national championship") ||
    explicitText.includes("championship game")
  ) {
    return context(
      "finals",
      `${sport} championship setting`,
      "This is a championship-game setting, so regular-season numbers are background and the narrative should focus on the current matchup evidence.",
      "espn",
    );
  }
  if (explicitText.includes("final four")) {
    return context(
      "tournament",
      "Final Four setting",
      "This is Final Four context, so regular-season numbers are background and the pick should be explained through one-game tournament edges.",
      "espn",
    );
  }
  if (
    explicitText.includes("conference championship") ||
    explicitText.includes("conference title")
  ) {
    return context(
      "conference_title",
      `${sport} conference title setting`,
      "This is conference-title context, so the story should focus on current matchup data and the factors that hold up under title-game pressure.",
      "espn",
    );
  }
  if (explicitText.includes("play-in") || explicitText.includes("play in")) {
    return context(
      "play_in",
      `${sport} play-in setting`,
      "This is a play-in type game, so immediate matchup edges matter more than broad regular-season framing.",
      "espn",
    );
  }
  if (
    sport === "TENNIS" &&
    (
      explicitText.includes("singles") ||
      explicitText.includes("doubles") ||
      explicitText.includes("round") ||
      explicitText.includes("quarterfinal") ||
      explicitText.includes("semifinal") ||
      explicitText.includes("final") ||
      explicitText.includes("tournament")
    )
  ) {
    return context(
      "tournament",
      "Tennis tournament setting",
      "This is tennis tournament context, so rankings, draw slot, match format, surface/conditions, and one-match variance should guide the analysis.",
      "espn",
    );
  }
  if (
    explicitText.includes("group stage") ||
    explicitText.includes("league phase")
  ) {
    return context(
      "group_stage",
      sport === "UCL" ? "UCL league/group-stage setting" : `${sport} group-stage setting`,
      "This is group-stage context, so the pick should lean on current matchup data without pretending it is a knockout or final.",
      "espn",
    );
  }
  if (
    explicitText.includes("cup") &&
    !explicitText.includes("world series") &&
    !explicitText.includes("stanley cup") &&
    !explicitText.includes("mls cup")
  ) {
    return context(
      "cup",
      `${sport} cup setting`,
      "This is cup context, so the narrative should treat it as a special match and avoid sounding like a normal league-table game.",
      "espn",
    );
  }
  if (
    explicitText.includes("final") ||
    explicitText.includes("championship")
  ) {
    return context(
      "finals",
      `${sport} title-stage setting`,
      "This is a title-stage game, so regular-season numbers are background and the analysis should stay focused on the matchup pieces that travel under pressure.",
      "espn",
    );
  }
  if (
    explicitText.includes("postseason") ||
    explicitText.includes("post-season") ||
    explicitText.includes("playoff") ||
    explicitText.includes("knockout") ||
    explicitText.includes("semifinal") ||
    explicitText.includes("quarterfinal") ||
    explicitText.includes("round of 16") ||
    seasonType === "3"
  ) {
    return context(
      sport === "UCL" ? "tournament" : "playoffs",
      sport === "UCL" ? "UCL knockout setting" : `${sport} playoff setting`,
      "This is postseason context, so regular-season numbers are background and the pick should be explained through matchup-specific edges.",
      "espn",
    );
  }
  if (explicitText.includes("bowl")) {
    return context(
      "bowl",
      `${sport} bowl setting`,
      "This is a bowl setting, so regular-season numbers are background and any layoff, motivation, or roster-availability signals should be called out when they appear in the factors.",
      "espn",
    );
  }
  if (explicitText.includes("preseason") || seasonType === "1") {
    return context(
      "preseason",
      `${sport} preseason setting`,
      "This is preseason context, so the analysis should be careful with normal form and rating signals.",
      "espn",
    );
  }

  const date = new Date(input.gameTime);
  if (Number.isNaN(date.getTime())) return null;
  const md = monthDay(date);

  if (sport === "NBA") {
    if (inRange(md, { month: 4, day: 15 }, { month: 6, day: 25 })) {
      return context(
        "playoffs",
        "NBA playoff window",
        "This falls in the NBA playoff window, so regular-season numbers are background and the pick should lean on repeatable matchup edges.",
        "date",
      );
    }
    if (inRange(md, { month: 3, day: 1 }, { month: 4, day: 14 })) {
      return context(
        "late_season",
        "NBA late-season stretch",
        "This is late-season NBA, so seeding, rest, and availability signals deserve extra attention when present.",
        "date",
      );
    }
  }

  if (sport === "NHL") {
    if (inRange(md, { month: 4, day: 15 }, { month: 6, day: 25 })) {
      return context(
        "playoffs",
        "NHL playoff window",
        "This falls in the NHL playoff window, so regular-season numbers are background and the analysis should emphasize durable matchup edges plus goalie or injury signals when present.",
        "date",
      );
    }
  }

  if (sport === "MLB") {
    if (inRange(md, { month: 10, day: 1 }, { month: 11, day: 5 })) {
      return context(
        "playoffs",
        "MLB postseason window",
        "This falls in the MLB postseason window, so regular-season numbers are background and pitching, bullpen, and availability signals should drive the story when they are in the factors.",
        "date",
      );
    }
    if (inRange(md, { month: 9, day: 1 }, { month: 9, day: 30 })) {
      return context(
        "late_season",
        "MLB stretch run",
        "This is the MLB stretch run, so recent form, rest, and pitching context matter more than a generic season snapshot.",
        "date",
      );
    }
  }

  if (sport === "NFL") {
    if (inRange(md, { month: 1, day: 1 }, { month: 2, day: 15 })) {
      return context(
        "playoffs",
        "NFL playoff window",
        "This falls in the NFL playoff window, so regular-season numbers are background and the read should focus on matchup edges that can survive a one-game setting.",
        "date",
      );
    }
    if (inRange(md, { month: 12, day: 1 }, { month: 1, day: 10 })) {
      return context(
        "late_season",
        "NFL late-season stretch",
        "This is late-season NFL, so injuries, rest, and playoff-positioning type signals deserve attention when the factors show them.",
        "date",
      );
    }
  }

  if (sport === "NCAAB") {
    if (inRange(md, { month: 3, day: 1 }, { month: 4, day: 10 })) {
      return context(
        "tournament",
        "college basketball tournament window",
        "This is tournament-window college basketball, so regular-season numbers are background and the pick should be explained through matchup edges that hold up in a one-game setting.",
        "date",
      );
    }
  }

  if (sport === "NCAAF") {
    if (inRange(md, { month: 12, day: 1 }, { month: 1, day: 15 })) {
      return context(
        "bowl",
        "college football bowl/playoff window",
        "This is bowl/playoff-window college football, so regular-season numbers are background and roster availability or layoff context should be highlighted when the factors provide it.",
        "date",
      );
    }
  }

  if (sport === "MLS") {
    if (inRange(md, { month: 10, day: 15 }, { month: 12, day: 15 })) {
      return context(
        "playoffs",
        "MLS playoff window",
        "This falls in the MLS playoff window, so regular-season table form is background and the analysis should treat it as a knockout-style matchup.",
        "date",
      );
    }
  }

  if (sport === "EPL") {
    if (inRange(md, { month: 4, day: 1 }, { month: 5, day: 31 })) {
      return context(
        "late_season",
        "EPL run-in",
        "This is the EPL run-in, so title, Europe, relegation, and fatigue signals matter when they show up in the factors.",
        "date",
      );
    }
  }

  if (sport === "UCL") {
    if (inRange(md, { month: 2, day: 1 }, { month: 6, day: 15 })) {
      return context(
        "tournament",
        "UCL knockout window",
        "This falls in the Champions League knockout window, so league-phase results are background and the pick should be framed around matchup edges in a high-leverage tie.",
        "date",
      );
    }
    if (inRange(md, { month: 9, day: 1 }, { month: 1, day: 31 })) {
      return context(
        "group_stage",
        "UCL league/group-stage window",
        "This falls in the Champions League league/group-stage window, so the pick should focus on current matchup data without pretending it is knockout pressure.",
        "date",
      );
    }
  }

  if (sport === "WORLDCUP") {
    // Knockout phase typically begins after the group stage concludes.
    if (inRange(md, { month: 6, day: 28 }, { month: 7, day: 31 })) {
      return context(
        "tournament",
        "World Cup knockout window",
        "This falls in the World Cup knockout window, so group-stage results are background and the pick should be framed around matchup edges in a single-elimination, neutral-venue tie.",
        "date",
      );
    }
    return context(
      "group_stage",
      "World Cup group stage",
      "This is World Cup group-stage context at a neutral venue, so current matchup data, squad quality, and one-match variance should guide the analysis rather than home advantage.",
      "date",
    );
  }

  if (sport === "IPL") {
    if (inRange(md, { month: 3, day: 20 }, { month: 5, day: 31 })) {
      return context(
        "tournament",
        "IPL tournament window",
        "This is IPL T20 context, so venue, recent form, batting depth, and one-match variance should matter more than a generic league read.",
        "date",
      );
    }
  }

  if (sport === "TENNIS") {
    return context(
      "tournament",
      "Tennis tournament setting",
      "This is tennis tournament context, so rankings, draw slot, match format, surface/conditions, and one-match variance should guide the analysis.",
      "date",
    );
  }

  return null;
}
