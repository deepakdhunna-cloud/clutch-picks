import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polygon, Polyline, Defs, LinearGradient, Stop } from 'react-native-svg';
import { getTeamColors } from '../../lib/team-colors';
import { Sport } from '@/types/sports';

interface LiveState {
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  inningHalf: 'top' | 'bottom' | null;
  inningNumber: number | null;
  pitcher: { name: string | null; teamAbbr: string } | null;
  batter: { name: string | null; teamAbbr: string } | null;
}

interface Props {
  liveState: LiveState;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
}

function shiftColor(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  const nr = clamp(r + amount).toString(16).padStart(2, '0');
  const ng = clamp(g + amount).toString(16).padStart(2, '0');
  const nb = clamp(b + amount).toString(16).padStart(2, '0');
  return `#${nr}${ng}${nb}`;
}

function ordinal(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n === 1) return '1ST';
  if (n === 2) return '2ND';
  if (n === 3) return '3RD';
  return `${n}TH`;
}

function Dot({ lit }: { lit: boolean }) {
  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: lit ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.16)',
      }}
    />
  );
}

function CountGroup({ label, lit, total }: { label: string; lit: number; total: number }) {
  const dots: boolean[] = [];
  for (let i = 0; i < total; i++) dots.push(i < lit);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={styles.countLabel}>{label}</Text>
      {dots.map((isLit, i) => (
        <Dot key={i} lit={isLit} />
      ))}
    </View>
  );
}

export const MLBLiveState = React.memo(function MLBLiveState({
  liveState,
  homeTeamAbbr,
  awayTeamAbbr,
}: Props) {
  const battingAbbr =
    liveState.inningHalf === 'bottom' ? homeTeamAbbr : awayTeamAbbr;
  const battingColor = getTeamColors(battingAbbr, Sport.MLB).primary;
  const battingBright = shiftColor(battingColor, 60);
  const battingDark = shiftColor(battingColor, -90);
  const occupiedStroke = shiftColor(battingColor, 30);

  const balls = Math.max(0, Math.min(3, liveState.balls));
  const strikes = Math.max(0, Math.min(2, liveState.strikes));
  const outs = Math.max(0, Math.min(2, liveState.outs));

  const inningOrd = liveState.inningNumber ? ordinal(liveState.inningNumber) : '';
  const halfPrefix =
    liveState.inningHalf === 'top' ? 'TOP' : liveState.inningHalf === 'bottom' ? 'BOT' : '';
  const inningLabel = halfPrefix && inningOrd ? `${halfPrefix} ${inningOrd}` : halfPrefix || inningOrd;

  const pitcherTeamColor = liveState.pitcher
    ? getTeamColors(liveState.pitcher.teamAbbr, Sport.MLB).primary
    : 'rgba(255,255,255,0.5)';
  const batterTeamColor = liveState.batter
    ? getTeamColors(liveState.batter.teamAbbr, Sport.MLB).primary
    : 'rgba(255,255,255,0.5)';

  const pitcherDisplay = liveState.pitcher
    ? liveState.pitcher.name ?? liveState.pitcher.teamAbbr
    : '—';
  const batterDisplay = liveState.batter
    ? liveState.batter.name ?? liveState.batter.teamAbbr
    : '—';

  return (
    <View style={styles.container}>
      {/* Diamond */}
      <View style={{ alignItems: 'center' }}>
        <Svg width={180} height={56} viewBox="0 0 180 56">
          <Defs>
            <LinearGradient id="emptyBase" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.28} />
              <Stop offset="55%" stopColor="#FFFFFF" stopOpacity={0.10} />
              <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.02} />
            </LinearGradient>
            <LinearGradient id="battingTeamBase" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={battingBright} stopOpacity={1} />
              <Stop offset="55%" stopColor={battingColor} stopOpacity={1} />
              <Stop offset="100%" stopColor={battingDark} stopOpacity={1} />
            </LinearGradient>
          </Defs>

          {/* 3rd base (left) */}
          <Polygon
            points="28,28 50,40 28,52 6,40"
            fill={liveState.onThird ? 'url(#battingTeamBase)' : 'url(#emptyBase)'}
            stroke={liveState.onThird ? occupiedStroke : 'rgba(255,255,255,0.55)'}
            strokeWidth={1.2}
          />
          <Polyline
            points="6,40 28,28 50,40"
            fill="none"
            stroke={liveState.onThird ? 'rgba(255,200,210,0.75)' : 'rgba(255,255,255,0.5)'}
            strokeWidth={liveState.onThird ? 1.4 : 1.2}
            strokeLinejoin="round"
          />

          {/* 2nd base (top center) */}
          <Polygon
            points="90,4 112,16 90,28 68,16"
            fill={liveState.onSecond ? 'url(#battingTeamBase)' : 'url(#emptyBase)'}
            stroke={liveState.onSecond ? occupiedStroke : 'rgba(255,255,255,0.55)'}
            strokeWidth={1.2}
          />
          <Polyline
            points="68,16 90,4 112,16"
            fill="none"
            stroke={liveState.onSecond ? 'rgba(255,200,210,0.75)' : 'rgba(255,255,255,0.5)'}
            strokeWidth={liveState.onSecond ? 1.4 : 1.2}
            strokeLinejoin="round"
          />

          {/* 1st base (right) */}
          <Polygon
            points="152,28 174,40 152,52 130,40"
            fill={liveState.onFirst ? 'url(#battingTeamBase)' : 'url(#emptyBase)'}
            stroke={liveState.onFirst ? occupiedStroke : 'rgba(255,255,255,0.55)'}
            strokeWidth={1.2}
          />
          <Polyline
            points="130,40 152,28 174,40"
            fill="none"
            stroke={liveState.onFirst ? 'rgba(255,200,210,0.75)' : 'rgba(255,255,255,0.5)'}
            strokeWidth={liveState.onFirst ? 1.4 : 1.2}
            strokeLinejoin="round"
          />
        </Svg>
      </View>

      {/* Count row */}
      <View style={styles.countRow}>
        <CountGroup label="B" lit={balls} total={3} />
        <CountGroup label="S" lit={strikes} total={2} />
        <CountGroup label="O" lit={outs} total={2} />
      </View>

      {/* Inning indicator */}
      {inningLabel ? (
        <Text style={styles.inning}>{inningLabel}</Text>
      ) : null}

      {/* Pitcher / Batter row */}
      <View style={styles.matchupRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.matchupLabel}>PITCHING</Text>
          <Text style={styles.matchupName} numberOfLines={1}>
            {pitcherDisplay}
          </Text>
          {liveState.pitcher ? (
            <Text style={[styles.matchupTeam, { color: pitcherTeamColor }]}>
              {liveState.pitcher.teamAbbr}
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={[styles.matchupLabel, { textAlign: 'right' }]}>AT BAT</Text>
          <Text style={[styles.matchupName, { textAlign: 'right' }]} numberOfLines={1}>
            {batterDisplay}
          </Text>
          {liveState.batter ? (
            <Text style={[styles.matchupTeam, { color: batterTeamColor, textAlign: 'right' }]}>
              {liveState.batter.teamAbbr}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 28,
    paddingBottom: 10,
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 22,
    marginTop: 16,
  },
  countLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 1,
    fontWeight: '700',
  },
  inning: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 2,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 22,
  },
  matchupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  matchupLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.42)',
    letterSpacing: 1.5,
    fontWeight: '700',
    marginBottom: 4,
  },
  matchupName: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
    lineHeight: 15,
  },
  matchupTeam: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: 0.5,
  },
});

