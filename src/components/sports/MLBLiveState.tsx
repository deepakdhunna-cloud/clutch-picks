/**
 * MLBLiveState.tsx
 *
 * Components for rendering live MLB game state in the jersey hero area.
 *
 * Exports two pieces because the live state spans two different parts of
 * the existing layout:
 *
 *   1. <MLBTeamRoleBlock />  — nests UNDER each team name in the team info
 *      columns. Shows "PITCHING" or "AT BAT" + the player name. The team
 *      name itself stays locked in position; only this block's contents
 *      swap based on which team is currently batting.
 *
 *   2. <MLBLiveCenterStack /> — replaces the existing score row for live
 *      MLB games. Shows the B/S/O dot count, then the jersey + score +
 *      diamond row, then the inning ordinal caption under the diamond.
 *
 * INTEGRATION (in src/app/game/[id].tsx, inside TappableJerseyHero):
 *
 *   // In each team info column, beneath the team name + record:
 *   {isLiveMLB && game.liveState && (
 *     <MLBTeamRoleBlock
 *       liveState={game.liveState}
 *       teamAbbr={game.homeTeam.abbreviation}
 *       isHome={true}
 *       align="left"
 *     />
 *   )}
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
  Polyline,
  G,
  Filter,
  FeGaussianBlur,
  FeMerge,
  FeMergeNode,
} from 'react-native-svg';
import { getTeamColors } from '../../lib/team-colors';
import { ScorePop } from './ScorePop';

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
//   1. B/S/O dot count row (above)
//   2. Jersey + score + diamond + score + jersey row
//   3. Inning ordinal caption directly under the diamond
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
  const battingBright = shiftColor(battingColor, 60);
  const battingDark = shiftColor(battingColor, -90);
  const battingStroke = shiftColor(battingColor, 30);

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
      ? `END OF ${ordinal(inningNum)}`
      : 'BETWEEN INNINGS'
    : halfLabel
    ? inningNum
      ? `${halfLabel} ${ordinal(inningNum)}`
      : halfLabel
    : '';

  return (
    <View>
      {/* B/S/O dot count row */}
      <View style={styles.dotRow}>
        <DotGroup label="B" total={4} lit={balls} type="b" />
        <DotGroup label="S" total={3} lit={strikes} type="s" />
        <DotGroup label="O" total={3} lit={outs} type="o" />
      </View>

      {/* Jersey + score + diamond + score + jersey */}
      <View style={styles.jerseyRow}>
        {homeJersey}

        <ScorePop value={homeScore} textStyle={styles.score} badgeAlign="right" />

        <View style={styles.diamondColumn}>
          <Diamond
            onFirst={liveState.onFirst}
            onSecond={liveState.onSecond}
            onThird={liveState.onThird}
            battingBright={battingBright}
            battingMid={battingColor}
            battingDark={battingDark}
            battingStroke={battingStroke}
          />
          {inningText !== '' && (
            <Text style={styles.inningCaption}>{inningText}</Text>
          )}
        </View>

        <ScorePop value={awayScore} textStyle={styles.score} badgeAlign="left" />

        {awayJersey}
      </View>
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
// Three bases in a flat perspective layout (3rd left, 2nd top center,
// 1st right). Each base has a vertical gradient + bevel highlight on the
// upper edges. Occupied bases fill with the batting team's primary color.
// All three bases share a soft Gaussian blur filter for the glow.
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
  battingDark,
  battingStroke,
}: DiamondProps) {
  return (
    <Svg width={110} height={42} viewBox="0 0 84 32">
      <Defs>
        <LinearGradient id="emptyBaseGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="white" stopOpacity={0.3} />
          <Stop offset="55%" stopColor="white" stopOpacity={0.12} />
          <Stop offset="100%" stopColor="white" stopOpacity={0.02} />
        </LinearGradient>
        <LinearGradient id="battingBaseGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor={battingBright} />
          <Stop offset="55%" stopColor={battingMid} />
          <Stop offset="100%" stopColor={battingDark} />
        </LinearGradient>
        <Filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <FeGaussianBlur stdDeviation="1.4" result="blur" />
          <FeMerge>
            <FeMergeNode in="blur" />
            <FeMergeNode in="SourceGraphic" />
          </FeMerge>
        </Filter>
      </Defs>

      <G filter="url(#softGlow)">
        <Base
          points="16,16 28,22 16,28 4,22"
          highlightPoints="4,22 16,16 28,22"
          occupied={onThird}
          battingStroke={battingStroke}
        />
        <Base
          points="42,2 54,8 42,14 30,8"
          highlightPoints="30,8 42,2 54,8"
          occupied={onSecond}
          battingStroke={battingStroke}
        />
        <Base
          points="68,16 80,22 68,28 56,22"
          highlightPoints="56,22 68,16 80,22"
          occupied={onFirst}
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
  points: string;
  highlightPoints: string;
  occupied: boolean;
  battingStroke: string;
};

function Base({ points, highlightPoints, occupied, battingStroke }: BaseProps) {
  return (
    <>
      <Polygon
        points={points}
        fill={occupied ? 'url(#battingBaseGrad)' : 'url(#emptyBaseGrad)'}
        stroke={occupied ? battingStroke : 'rgba(255,255,255,0.6)'}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <Polyline
        points={highlightPoints}
        fill="none"
        stroke={occupied ? 'rgba(255,200,210,0.8)' : 'rgba(255,255,255,0.55)'}
        strokeWidth={occupied ? 1.2 : 1}
        strokeLinejoin="round"
      />
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

  // ---- Dot row ----
  dotRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
    gap: 18,
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
    width: 8,
    height: 8,
    borderRadius: 4,
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

  // ---- Jersey + score + diamond row ----
  jerseyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  score: {
    fontFamily: 'VT323_400Regular',
    fontSize: 44,
    color: 'white',
    lineHeight: 44,
    textShadowColor: 'rgba(255,255,255,0.2)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  diamondColumn: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  inningCaption: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 2,
    fontWeight: '700',
    marginTop: 6,
  },
});
