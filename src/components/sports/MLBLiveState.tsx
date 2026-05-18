/**
 * MLBLiveState.tsx
 *
 * Components for rendering live MLB game state in the jersey hero area.
 *
 * Exports two pieces because the live state can span two different parts of
 * the existing layout:
 *
 *   1. <MLBTeamRoleBlock />  — standalone role helper for "PITCHING" or
 *      "AT BAT" + the player name. The center stack now places this context
 *      under the jerseys.
 *
 *   2. <MLBLiveCenterStack /> — replaces the existing score row for live
 *      MLB games. Shows the LED scoreboard, then jersey + base field +
 *      jersey, with B/S/O and inning context below the field.
 *
 * INTEGRATION (in src/app/game/[id].tsx, inside TappableJerseyHero):
 *
 *   // Replace the existing score row for live MLB games:
 *   {isLiveMLB && game.liveState ? (
 *     <MLBLiveCenterStack
 *       liveState={game.liveState}
 *       homeTeamAbbr={game.homeTeam.abbreviation}
 *       awayTeamAbbr={game.awayTeam.abbreviation}
 *       homeScore={game.homeScore}
 *       awayScore={game.awayScore}
 *       homeJersey={<TeamJersey team={game.homeTeam} size={60} />}
 *       awayJersey={<TeamJersey team={game.awayTeam} size={60} />}
 *     />
 *   ) : (
 *     <ExistingScoreRow ... />
 *   )}
 *
 * The home team always renders on the LEFT and the away team always
 * renders on the RIGHT (or whatever the existing convention is). Team
 * positions are LOCKED. Only the role labels (PITCHING / AT BAT) and
 * the player names swap based on liveState.inningHalf.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Polygon,
  Path,
  G,
  Filter,
  FeGaussianBlur,
  FeMerge,
  FeMergeNode,
} from 'react-native-svg';
import { getTeamColors } from '../../lib/team-colors';
import { ArenaScoreboard } from './ArenaScoreboard';

// ============================================================================
// Types
// ============================================================================

export type MLBLiveState = {
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  inningHalf: 'top' | 'bottom' | null;
  inning?: number;
  inningNumber?: number | null;
  betweenInnings?: boolean;
  inningTransition?: 'mid' | 'end' | null;
  pitcher: { name: string | null; teamAbbr: string } | null;
  batter: { name: string | null; teamAbbr: string } | null;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Brighten or darken a hex color. amount > 0 brightens, < 0 darkens.
 * Used to derive the gradient stops from a team's primary color.
 */
function shiftColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amount));
  return (
    '#' +
    [r, g, b]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

/** 1 → "1ST", 2 → "2ND", 3 → "3RD", 4-9 → "4TH"…"9TH", 10+ → "10TH" etc. */
function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}TH`;
  switch (n % 10) {
    case 1:
      return `${n}ST`;
    case 2:
      return `${n}ND`;
    case 3:
      return `${n}RD`;
    default:
      return `${n}TH`;
  }
}

/** Resolve a team's primary color, with a safe fallback. */
function teamPrimary(abbr: string): string {
  try {
    return getTeamColors(abbr, 'MLB' as any).primary;
  } catch {
    return '#888888';
  }
}

/** Determines whether a given team (home or away) is currently batting. */
function teamIsBatting(inningHalf: MLBLiveState['inningHalf'], isHome: boolean): boolean {
  // Top of inning = away batting; bottom = home batting
  const homeBatting = inningHalf === 'bottom';
  return isHome ? homeBatting : !homeBatting;
}

// ============================================================================
// MLBTeamRoleBlock
// ----------------------------------------------------------------------------
// Renders the role label + player name pair that nests under each team name.
// The team name stays locked in its column; this block's contents swap
// based on which team is currently batting.
// ============================================================================

type MLBTeamRoleBlockProps = {
  liveState: MLBLiveState;
  teamAbbr: string;
  isHome: boolean;
  align: 'left' | 'right';
};

export function MLBTeamRoleBlock({
  liveState,
  teamAbbr,
  isHome,
  align,
}: MLBTeamRoleBlockProps) {
  // Between innings: no current pitcher/batter — show a neutral placeholder
  // instead of mis-labeling roles based on the previous half-inning.
  if (liveState.betweenInnings) {
    return (
      <View style={[styles.roleBlock, align === 'right' && styles.alignRight]}>
        <Text style={[styles.roleLabel, align === 'right' && styles.textRight]}>
          ON DECK
        </Text>
        <Text style={[styles.playerName, align === 'right' && styles.textRight]}>
          —
        </Text>
      </View>
    );
  }

  const isBatting = teamIsBatting(liveState.inningHalf, isHome);
  const role = isBatting ? 'AT BAT' : 'PITCHING';
  const player = isBatting ? liveState.batter : liveState.pitcher;
  const playerName = player?.name ?? teamAbbr;

  return (
    <View style={[styles.roleBlock, align === 'right' && styles.alignRight]}>
      <Text style={[styles.roleLabel, align === 'right' && styles.textRight]}>
        {role}
      </Text>
      <Text style={[styles.playerName, align === 'right' && styles.textRight]}>
        {playerName}
      </Text>
    </View>
  );
}

// ============================================================================
// MLBLiveCenterStack
// ----------------------------------------------------------------------------
// Replaces the score row for live MLB games. Renders:
//   1. The same realistic LED scoreboard used by live cards
//   2. Jersey + base field + jersey
//   3. B/S/O under the field and inning context below the jerseys
// ============================================================================

type MLBLiveCenterStackProps = {
  liveState: MLBLiveState;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  homeScore: number;
  awayScore: number;
  homeJersey: React.ReactNode;
  awayJersey: React.ReactNode;
};

export function MLBLiveCenterStack({
  liveState,
  homeTeamAbbr,
  awayTeamAbbr,
  homeScore,
  awayScore,
  homeJersey,
  awayJersey,
}: MLBLiveCenterStackProps) {
  const homeBatting = liveState.inningHalf === 'bottom';
  const battingTeamAbbr = homeBatting ? homeTeamAbbr : awayTeamAbbr;

  const battingColor = teamPrimary(battingTeamAbbr);
  const homeColor = teamPrimary(homeTeamAbbr);
  const awayColor = teamPrimary(awayTeamAbbr);
  const battingBright = shiftColor(battingColor, 60);
  const battingDark = shiftColor(battingColor, -90);
  const battingStroke = shiftColor(battingColor, 30);
  const scoreTextLength = `${homeScore}-${awayScore}`.length;
  const scoreboardScale = scoreTextLength >= 7 ? 1.14 : scoreTextLength >= 6 ? 1.26 : 1.42;

  // Clamp counts to baseball maxes (defensive — ESPN can briefly emit
  // transient values during the moment between events)
  const balls = Math.min(Math.max(liveState.balls ?? 0, 0), 4);
  const strikes = Math.min(Math.max(liveState.strikes ?? 0, 0), 3);
  const outs = Math.min(Math.max(liveState.outs ?? 0, 0), 3);

  const inningNum = liveState.inning ?? liveState.inningNumber ?? null;
  const halfLabel =
    liveState.inningHalf === 'top'
      ? '▲ TOP'
      : liveState.inningHalf === 'bottom'
      ? '▼ BOT'
      : '';
  const inningText = liveState.betweenInnings
    ? inningNum
      ? liveState.inningTransition === 'mid'
        ? `MID ${ordinal(inningNum)}`
        : liveState.inningTransition === 'end'
        ? `END ${ordinal(inningNum)}`
        : `BETWEEN ${ordinal(inningNum)}`
      : 'BETWEEN INNINGS'
    : halfLabel
    ? inningNum
      ? `${halfLabel} ${ordinal(inningNum)}`
      : halfLabel
    : '';

  return (
    <View style={styles.liveStack}>
      <View style={styles.scoreboardWrap}>
        <ArenaScoreboard
          homeScore={homeScore}
          awayScore={awayScore}
          homeColor={homeColor}
          awayColor={awayColor}
          scale={scoreboardScale}
        />
      </View>

      {inningText !== '' && (
        <Text style={styles.scoreboardInningCaption}>{inningText}</Text>
      )}

      <View style={styles.fieldRow}>
        <View style={styles.teamJerseyColumn}>
          {homeJersey}
          <TeamRoleUnderJersey
            liveState={liveState}
            teamAbbr={homeTeamAbbr}
            isHome={true}
          />
        </View>

        <View style={styles.fieldColumn}>
          <Diamond
            onFirst={liveState.onFirst}
            onSecond={liveState.onSecond}
            onThird={liveState.onThird}
            battingBright={battingBright}
            battingMid={battingColor}
            battingDark={battingDark}
            battingStroke={battingStroke}
          />
          <View style={styles.dotRow}>
            <DotGroup label="B" total={4} lit={balls} type="b" />
            <DotGroup label="S" total={3} lit={strikes} type="s" />
            <DotGroup label="O" total={3} lit={outs} type="o" />
          </View>
        </View>

        <View style={styles.teamJerseyColumn}>
          {awayJersey}
          <TeamRoleUnderJersey
            liveState={liveState}
            teamAbbr={awayTeamAbbr}
            isHome={false}
          />
        </View>
      </View>
    </View>
  );
}

type TeamRoleUnderJerseyProps = Omit<MLBTeamRoleBlockProps, 'align'>;

function TeamRoleUnderJersey({
  liveState,
  teamAbbr,
  isHome,
}: TeamRoleUnderJerseyProps) {
  if (liveState.betweenInnings) {
    return (
      <View style={styles.jerseyRoleBlock}>
        <Text style={styles.jerseyRoleLabel}>
          ON DECK
        </Text>
        <Text style={styles.jerseyPlayerName}>
          —
        </Text>
      </View>
    );
  }

  const isBatting = teamIsBatting(liveState.inningHalf, isHome);
  const role = isBatting ? 'AT BAT' : 'PITCHING';
  const player = isBatting ? liveState.batter : liveState.pitcher;
  const playerName = player?.name ?? teamAbbr;

  return (
    <View style={styles.jerseyRoleBlock}>
      <Text style={styles.jerseyRoleLabel}>
        {role}
      </Text>
      <Text
        style={styles.jerseyPlayerName}
        numberOfLines={2}
      >
        {playerName}
      </Text>
    </View>
  );
}

// ============================================================================
// DotGroup
// ----------------------------------------------------------------------------
// Renders a single labeled group of count dots (B / S / O). Lit dots are
// color-coded with a soft glow; unlit dots are dim white.
// ============================================================================

type DotGroupProps = {
  label: string;
  total: number;
  lit: number;
  type: 'b' | 's' | 'o';
};

function DotGroup({ label, total, lit, type }: DotGroupProps) {
  const litStyle =
    type === 'b' ? styles.dotB : type === 's' ? styles.dotS : styles.dotO;

  return (
    <View style={styles.dotGroup}>
      <Text style={styles.dotLabel}>{label}</Text>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i < lit ? litStyle : styles.dotOff]}
        />
      ))}
    </View>
  );
}

// ============================================================================
// Diamond
// ----------------------------------------------------------------------------
// Three bases in a premium perspective layout (3rd left, 2nd top center,
// 1st right). Occupied bases fill with the batting team's primary color,
// while the next advancing base gets a subtle color outline.
// ============================================================================

type DiamondProps = {
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  battingBright: string;
  battingMid: string;
  battingDark: string;
  battingStroke: string;
};

function Diamond({
  onFirst,
  onSecond,
  onThird,
  battingBright,
  battingMid,
  battingStroke,
}: DiamondProps) {
  const nextOutlinedBase =
    !onFirst && !onSecond && !onThird
      ? 'first'
      : onSecond && !onThird
      ? 'third'
      : onFirst && !onSecond
      ? 'second'
      : null;

  return (
    <Svg width={128} height={54} viewBox="0 0 112 48">
      <Defs>
        <LinearGradient id="emptyBaseGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#edf5f8" stopOpacity={0.68} />
          <Stop offset="48%" stopColor="#7f8b91" stopOpacity={0.34} />
          <Stop offset="100%" stopColor="#12191d" stopOpacity={0.78} />
        </LinearGradient>
        <LinearGradient id="emptySideGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#76838a" stopOpacity={0.32} />
          <Stop offset="100%" stopColor="#020405" stopOpacity={0.88} />
        </LinearGradient>
        <LinearGradient id="occupiedBaseFlushGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.38} />
          <Stop offset="42%" stopColor={battingBright} stopOpacity={0.3} />
          <Stop offset="100%" stopColor={battingMid} stopOpacity={0.46} />
        </LinearGradient>
        <LinearGradient id="nextBaseFlushGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.56} />
          <Stop offset="58%" stopColor="#f5fbff" stopOpacity={0.26} />
          <Stop offset="100%" stopColor="#c8d7df" stopOpacity={0.12} />
        </LinearGradient>
        <Filter id="premiumBaseGlow" x="-55%" y="-55%" width="210%" height="210%">
          <FeGaussianBlur stdDeviation="1.1" result="blur" />
          <FeMerge>
            <FeMergeNode in="blur" />
            <FeMergeNode in="SourceGraphic" />
          </FeMerge>
        </Filter>
      </Defs>

      <G filter="url(#premiumBaseGlow)">
        <Base
          left={{ x: 16, y: 30 }}
          top={{ x: 32, y: 21 }}
          right={{ x: 48, y: 30 }}
          bottom={{ x: 32, y: 39 }}
          occupied={onThird}
          outlined={nextOutlinedBase === 'third'}
          battingStroke={battingStroke}
        />
        <Base
          left={{ x: 40, y: 18 }}
          top={{ x: 56, y: 9 }}
          right={{ x: 72, y: 18 }}
          bottom={{ x: 56, y: 27 }}
          occupied={onSecond}
          outlined={nextOutlinedBase === 'second'}
          battingStroke={battingStroke}
        />
        <Base
          left={{ x: 64, y: 30 }}
          top={{ x: 80, y: 21 }}
          right={{ x: 96, y: 30 }}
          bottom={{ x: 80, y: 39 }}
          occupied={onFirst}
          outlined={nextOutlinedBase === 'first'}
          battingStroke={battingStroke}
        />
      </G>
    </Svg>
  );
}

// ============================================================================
// Base (single base inside the diamond)
// ============================================================================

type BaseProps = {
  left: { x: number; y: number };
  top: { x: number; y: number };
  right: { x: number; y: number };
  bottom: { x: number; y: number };
  occupied: boolean;
  outlined: boolean;
  battingStroke: string;
};

function pointList(points: { x: number; y: number }[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

function pointToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
  amount: number
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: from.x + (dx / length) * amount,
    y: from.y + (dy / length) * amount,
  };
}

function roundedDiamondPath(
  left: { x: number; y: number },
  top: { x: number; y: number },
  right: { x: number; y: number },
  bottom: { x: number; y: number },
  radius: number
): string {
  const corners = [left, top, right, bottom];
  const commands: string[] = [];

  corners.forEach((corner, index) => {
    const prev = corners[(index + corners.length - 1) % corners.length];
    const next = corners[(index + 1) % corners.length];
    const start = pointToward(corner, prev, radius);
    const end = pointToward(corner, next, radius);

    if (index === 0) {
      commands.push(`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`);
    } else {
      commands.push(`L ${start.x.toFixed(2)} ${start.y.toFixed(2)}`);
    }

    commands.push(`Q ${corner.x.toFixed(2)} ${corner.y.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`);
  });

  commands.push('Z');
  return commands.join(' ');
}

function lower(point: { x: number; y: number }, amount: number): { x: number; y: number } {
  return { x: point.x, y: point.y + amount };
}

function Base({
  left,
  top,
  right,
  bottom,
  occupied,
  outlined,
  battingStroke,
}: BaseProps) {
  const depth = 3.6;
  const topFacePath = roundedDiamondPath(left, top, right, bottom, 3.6);
  const shadowFacePath = roundedDiamondPath(
    lower(left, 5.3),
    lower(top, 5.3),
    lower(right, 5.3),
    lower(bottom, 5.3),
    3.3
  );
  const sideFace = pointList([left, bottom, right, lower(right, depth), lower(bottom, depth + 1.25), lower(left, depth)]);
  const frontLip = pointList([
    lower(left, depth - 0.15),
    lower(bottom, depth + 0.8),
    lower(right, depth - 0.15),
    lower(right, depth + 0.75),
    lower(bottom, depth + 1.55),
    lower(left, depth + 0.75),
  ]);
  const active = occupied || outlined;
  const glowColor = occupied ? battingStroke : '#F4FAFF';

  return (
    <>
      <Path
        d={shadowFacePath}
        fill="#000000"
        opacity={active ? 0.26 : 0.2}
      />
      {active ? (
        <>
          <Path
            d={shadowFacePath}
            fill={glowColor}
            opacity={occupied ? 0.18 : 0.14}
          />
          <Path
            d={topFacePath}
            fill="none"
            stroke={glowColor}
            strokeWidth={occupied ? 2.55 : 2.35}
            strokeOpacity={occupied ? 0.42 : 0.5}
            strokeLinejoin="round"
          />
        </>
      ) : null}
      <Polygon
        points={sideFace}
        fill="url(#emptySideGrad)"
        opacity={active ? 0.64 : 0.56}
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={0.34}
        strokeLinejoin="round"
      />
      <Polygon
        points={frontLip}
        fill={active ? glowColor : '#e3edf2'}
        opacity={active ? 0.16 : 0.09}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={0.28}
      />
      <Path
        d={topFacePath}
        fill="url(#emptyBaseGrad)"
        stroke="rgba(247,252,255,0.84)"
        strokeWidth={0.72}
        strokeOpacity={1}
        strokeLinejoin="round"
      />
      {occupied ? (
        <Path
          d={topFacePath}
          fill="url(#occupiedBaseFlushGrad)"
          strokeLinejoin="round"
        />
      ) : null}
      {!occupied && outlined ? (
        <Path
          d={topFacePath}
          fill="url(#nextBaseFlushGrad)"
          strokeLinejoin="round"
        />
      ) : null}
      <Path
        d={topFacePath}
        fill="none"
        stroke="rgba(255,255,255,0.94)"
        strokeWidth={0.72}
        strokeLinejoin="round"
      />
      {active ? (
        <Path
          d={topFacePath}
          fill="none"
          stroke={glowColor}
          strokeWidth={occupied ? 1.08 : 1.16}
          strokeOpacity={occupied ? 0.62 : 0.74}
          strokeLinejoin="round"
        />
      ) : null}
    </>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // ---- Role block (used in team columns) ----
  roleBlock: {
    marginTop: 14,
  },
  alignRight: {
    alignItems: 'flex-end',
  },
  roleLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.42)',
    letterSpacing: 1.5,
    fontWeight: '700',
    marginBottom: 3,
  },
  playerName: {
    fontSize: 13,
    color: 'white',
    fontWeight: '600',
    lineHeight: 15,
  },
  textRight: {
    textAlign: 'right',
  },

  // ---- Live field stack ----
  liveStack: {
    alignItems: 'center',
    paddingTop: 6,
    paddingHorizontal: 10,
  },
  scoreboardWrap: {
    alignItems: 'center',
    marginBottom: 3,
  },
  scoreboardInningCaption: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.58)',
    letterSpacing: 2.2,
    fontWeight: '800',
    marginBottom: 3,
  },
  fieldRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 0,
  },
  teamJerseyColumn: {
    width: 104,
    alignItems: 'center',
    paddingTop: 2,
  },
  fieldColumn: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 14,
  },
  jerseyRoleBlock: {
    width: 104,
    marginTop: -12,
    alignItems: 'center',
  },
  jerseyRoleLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.42)',
    letterSpacing: 1.4,
    fontWeight: '800',
    marginBottom: 2,
    textAlign: 'center',
  },
  jerseyPlayerName: {
    fontSize: 11,
    color: 'white',
    fontWeight: '700',
    lineHeight: 13,
    textAlign: 'center',
  },

  // ---- Dot row ----
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
    gap: 14,
  },
  dotGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dotLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    fontWeight: '700',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  dotOff: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  dotB: {
    backgroundColor: '#4A90E2',
    shadowColor: '#4A90E2',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 4,
    elevation: 3,
  },
  dotS: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 4,
    elevation: 3,
  },
  dotO: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 3,
  },
});
