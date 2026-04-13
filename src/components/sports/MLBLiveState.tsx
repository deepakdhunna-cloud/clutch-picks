import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { getTeamColors } from '@/lib/team-colors';
import { Sport } from '@/types/sports';

interface LiveState {
  balls: number;
  strikes: number;
  outs: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  inningHalf: 'top' | 'bottom' | null;
  pitcher: { name: string | null; teamAbbr: string } | null;
  batter: { name: string | null; teamAbbr: string } | null;
}

interface Props {
  liveState: LiveState;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
}

const DIAMOND_SIZE = 64;
const BASE_SIZE = 14;
const BASE_FILL_DEFAULT = '#0a0a0f';
const BASE_STROKE = '#FFFFFF';
const BASE_STROKE_WIDTH = 1.5;

function Base({ x, y, occupied, color }: { x: number; y: number; occupied: boolean; color: string }) {
  const half = BASE_SIZE / 2;
  return (
    <Rect
      x={x - half}
      y={y - half}
      width={BASE_SIZE}
      height={BASE_SIZE}
      fill={occupied ? color : BASE_FILL_DEFAULT}
      stroke={BASE_STROKE}
      strokeWidth={BASE_STROKE_WIDTH}
      transform={`rotate(45 ${x} ${y})`}
    />
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

  // Diamond geometry: 1st right, 2nd top, 3rd left
  const cx = DIAMOND_SIZE / 2;
  const cy = DIAMOND_SIZE / 2;
  const offset = DIAMOND_SIZE / 2 - BASE_SIZE / 2 - 2;

  const pitcherLabel = liveState.pitcher?.name
    ? `P: ${liveState.pitcher.name}`
    : liveState.pitcher
    ? `${liveState.pitcher.teamAbbr} pitching`
    : '';
  const batterLabel = liveState.batter?.name
    ? `AB: ${liveState.batter.name}`
    : liveState.batter
    ? `${liveState.batter.teamAbbr} batting`
    : '';

  const outsLabel = liveState.outs === 1 ? '1 out' : `${liveState.outs} outs`;
  const countLabel = `${liveState.balls}-${liveState.strikes}, ${outsLabel}`;

  return (
    <View style={styles.container}>
      <View style={styles.side}>
        {pitcherLabel ? (
          <Text style={styles.label} numberOfLines={1}>
            {pitcherLabel}
          </Text>
        ) : null}
      </View>

      <View style={styles.center}>
        <Svg width={DIAMOND_SIZE} height={DIAMOND_SIZE}>
          {/* 2nd base (top) */}
          <Base x={cx} y={cy - offset} occupied={liveState.onSecond} color={battingColor} />
          {/* 3rd base (left) */}
          <Base x={cx - offset} y={cy} occupied={liveState.onThird} color={battingColor} />
          {/* 1st base (right) */}
          <Base x={cx + offset} y={cy} occupied={liveState.onFirst} color={battingColor} />
        </Svg>
        <Text style={styles.count}>{countLabel}</Text>
      </View>

      <View style={[styles.side, { alignItems: 'flex-end' }]}>
        {batterLabel ? (
          <Text style={styles.label} numberOfLines={1}>
            {batterLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  side: {
    flex: 1,
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    opacity: 0.9,
  },
  count: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 4,
    opacity: 0.85,
  },
});
