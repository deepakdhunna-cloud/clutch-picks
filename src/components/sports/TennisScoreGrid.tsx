import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sport } from '@/types/sports';

type TennisScoreTeam = {
  id?: string;
  abbreviation?: string;
};

type TennisScoreGame = {
  sport: Sport | string;
  status?: string;
  homeTeam: TennisScoreTeam;
  awayTeam: TennisScoreTeam;
  homeScore?: string | number | null;
  awayScore?: string | number | null;
  homeLinescores?: number[];
  awayLinescores?: number[];
  homeScoreDisplay?: string;
  awayScoreDisplay?: string;
  homePointScore?: string | number | null;
  awayPointScore?: string | number | null;
  quarter?: string;
  clock?: string;
  statusDetail?: string;
};

type TennisScoreColumn = {
  key: string;
  label: string;
  home: string;
  away: string;
  active: boolean;
  total?: boolean;
};

type Variant = 'rail' | 'compact' | 'detail';

function tennisPoint(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === 'A') return 'AD';
  if (normalized === 'AD' || normalized === '0' || normalized === '15' || normalized === '30' || normalized === '40') {
    return normalized;
  }
  return null;
}

function extractPointPair(game: TennisScoreGame): { home: string; away: string } | null {
  const directHome = tennisPoint(game.homePointScore);
  const directAway = tennisPoint(game.awayPointScore);
  if (directHome && directAway) return { home: directHome, away: directAway };

  const displayHome = tennisPoint(game.homeScoreDisplay);
  const displayAway = tennisPoint(game.awayScoreDisplay);
  if (displayHome && displayAway) return { home: displayHome, away: displayAway };

  const combined = [game.clock, game.statusDetail, game.quarter].filter(Boolean).join(' ');
  const match = combined.match(/\b(AD|A|40|30|15|0)\s*[-–]\s*(AD|A|40|30|15|0)\b/i);
  if (!match) return null;
  const home = tennisPoint(match[1]);
  const away = tennisPoint(match[2]);
  return home && away ? { home, away } : null;
}

function scoreValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function wonSetCount(line: number[], opponentLine: number[]): number {
  return line.reduce((count, score, index) => {
    const opponentScore = opponentLine[index];
    if (typeof score !== 'number' || typeof opponentScore !== 'number') return count;
    if (score <= opponentScore) return count;
    const completed = score >= 6 || opponentScore >= 6;
    return completed ? count + 1 : count;
  }, 0);
}

function buildTennisScoreColumns(game: TennisScoreGame, includeTotal = false): TennisScoreColumn[] {
  if (String(game.sport).toUpperCase() !== Sport.TENNIS) return [];

  const homeLine = game.homeLinescores ?? [];
  const awayLine = game.awayLinescores ?? [];
  const setCount = Math.max(homeLine.length, awayLine.length);
  if (setCount === 0) return [];

  const isLive = game.status === 'LIVE';
  const pointPair = isLive ? extractPointPair(game) : null;
  const activeSetIndex = isLive && !pointPair ? setCount - 1 : -1;
  const columns: TennisScoreColumn[] = [];

  for (let index = 0; index < setCount; index++) {
    columns.push({
      key: `set-${index}`,
      label: `S${index + 1}`,
      home: homeLine[index] !== undefined ? String(homeLine[index]) : '',
      away: awayLine[index] !== undefined ? String(awayLine[index]) : '',
      active: index === activeSetIndex,
    });
  }

  if (pointPair) {
    columns.push({
      key: 'points',
      label: 'P',
      home: pointPair.home,
      away: pointPair.away,
      active: true,
    });
  }

  if (includeTotal) {
    columns.push({
      key: 'total',
      label: 'T',
      home: scoreValue(game.homeScore) ?? String(wonSetCount(homeLine, awayLine)),
      away: scoreValue(game.awayScore) ?? String(wonSetCount(awayLine, homeLine)),
      active: false,
      total: true,
    });
  }

  return columns;
}

export function hasTennisScoreGrid(game: TennisScoreGame): boolean {
  return buildTennisScoreColumns(game).length > 0;
}

export const TennisHeroSetScores = memo(function TennisHeroSetScores({
  game,
  side,
}: {
  game: TennisScoreGame;
  side: 'home' | 'away';
}) {
  if (String(game.sport).toUpperCase() !== Sport.TENNIS) return null;

  const homeLine = game.homeLinescores ?? [];
  const awayLine = game.awayLinescores ?? [];
  const setCount = Math.max(homeLine.length, awayLine.length);
  if (setCount === 0) return null;

  const line = side === 'home' ? homeLine : awayLine;
  const activeIndex = game.status === 'LIVE' ? setCount - 1 : -1;

  return (
    <View style={styles.heroSetRow}>
      {Array.from({ length: setCount }).map((_, index) => {
        const active = index === activeIndex;
        const value = line[index] !== undefined ? String(line[index]) : '-';
        return (
          <View key={`${side}-set-${index}`} style={[styles.heroSetCell, active && styles.heroActiveSetCell]}>
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.heroSetText, active && styles.activeScoreText]}>
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

export const TennisScoreGrid = memo(function TennisScoreGrid({
  game,
  variant = 'compact',
  homeColor = '#7A9DB8',
  awayColor = '#8B0A1F',
  showTeams,
}: {
  game: TennisScoreGame;
  variant?: Variant;
  homeColor?: string;
  awayColor?: string;
  showTeams?: boolean;
}) {
  const detailed = variant === 'detail';
  const columns = useMemo(() => buildTennisScoreColumns(game, detailed), [game, detailed]);
  if (columns.length === 0) return null;

  const withTeams = showTeams ?? detailed;

  if (detailed) {
    const renderDetailRow = (
      side: 'home' | 'away',
      values: string[],
      accent: string,
      abbreviation?: string,
    ) => (
      <View style={styles.detailTableRow}>
        <View style={styles.detailTeamCell}>
          <View style={[styles.teamBadge, { backgroundColor: accent }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.teamBadgeText}>
              {abbreviation ?? (side === 'home' ? 'HOME' : 'AWAY')}
            </Text>
          </View>
        </View>
        {columns.map((column, index) => (
          <View
            key={`${side}-${column.key}`}
            style={[
              styles.detailColumn,
              index > 0 && styles.detailColumnGap,
              column.total && styles.detailTotalColumn,
            ]}
          >
            <View style={column.active ? styles.detailActiveValue : null}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit={false}
                minimumFontScale={1}
                allowFontScaling={false}
                style={[
                  styles.detailScoreText,
                  column.active && styles.activeScoreText,
                  column.total && styles.totalScoreText,
                  values[index] === '' && styles.emptyScoreText,
                ]}
              >
                {values[index] || '-'}
              </Text>
            </View>
          </View>
        ))}
      </View>
    );

    return (
      <View style={styles.detailShell}>
        <View style={styles.detailHeaderRow}>
          <View style={styles.detailTeamCell} />
          {columns.map((column, index) => (
            <View
              key={`header-${column.key}`}
              style={[
                styles.detailColumn,
                index > 0 && styles.detailColumnGap,
                column.total && styles.detailTotalColumn,
              ]}
            >
              <Text style={[styles.detailHeaderText, column.total && styles.detailTotalHeaderText]}>
                {column.label}
              </Text>
            </View>
          ))}
        </View>
        {renderDetailRow('home', columns.map((column) => column.home), homeColor, game.homeTeam.abbreviation)}
        <View style={styles.detailRowDivider} />
        {renderDetailRow('away', columns.map((column) => column.away), awayColor, game.awayTeam.abbreviation)}
      </View>
    );
  }

  const rail = variant === 'rail';
  const rowStyle = rail ? styles.railRow : detailed ? styles.detailRow : styles.compactRow;
  const teamCellStyle = rail ? styles.compactTeamCell : detailed ? styles.detailTeamCell : styles.compactTeamCell;
  const baseCellStyle = rail ? styles.railScoreCell : detailed ? styles.detailScoreCell : styles.compactScoreCell;
  const activeCellStyle = rail ? styles.railActiveCell : detailed ? styles.detailActiveCell : styles.compactActiveCell;
  const textStyle = rail ? styles.railScoreText : detailed ? styles.detailScoreText : styles.compactScoreText;
  const totalStyle = detailed ? styles.detailTotalCell : null;

  const renderRow = (
    side: 'home' | 'away',
    values: string[],
    accent: string,
    abbreviation?: string,
  ) => (
    <View style={[rowStyle, side === 'home' ? (rail ? styles.railTopRow : styles.compactTopRow) : null]}>
      {withTeams ? (
        <View style={teamCellStyle}>
          <View style={[styles.teamBadge, { backgroundColor: accent }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.teamBadgeText}>
              {abbreviation ?? (side === 'home' ? 'HOME' : 'AWAY')}
            </Text>
          </View>
        </View>
      ) : null}
      {columns.map((column, index) => (
        <View
          key={`${side}-${column.key}`}
          style={[
            baseCellStyle,
            column.active && activeCellStyle,
            index > 0 && (rail ? styles.railCellGap : detailed ? styles.detailCellGap : styles.compactCellGap),
            column.total && totalStyle,
          ]}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit={detailed}
            minimumFontScale={detailed ? 0.74 : 1}
            allowFontScaling={false}
            style={[
            textStyle,
            column.active && styles.activeScoreText,
            rail && column.active && styles.railActiveScoreText,
            column.total && styles.totalScoreText,
            values[index] === '' && styles.emptyScoreText,
          ]}
          >
            {values[index] || '-'}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={rail ? styles.railShell : styles.compactShell}>
      {renderRow('home', columns.map((column) => column.home), homeColor, game.homeTeam.abbreviation)}
      {renderRow('away', columns.map((column) => column.away), awayColor, game.awayTeam.abbreviation)}
    </View>
  );
});

const styles = StyleSheet.create({
  compactShell: {
    marginTop: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railShell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    minHeight: 28,
  },
  heroSetCell: {
    width: 20,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroActiveSetCell: {
    width: 31,
    height: 28,
    borderRadius: 11,
    backgroundColor: 'rgba(31,37,49,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.16)',
  },
  heroSetText: {
    color: 'rgba(248,250,252,0.9)',
    fontSize: 24,
    lineHeight: 28,
    fontFamily: 'VT323_400Regular',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  detailShell: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(2,5,12,0.72)',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  compactTopRow: {
    marginBottom: 1,
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 26,
  },
  railTopRow: {
    marginBottom: 3,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 43,
  },
  detailTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
  },
  detailRowDivider: {
    height: 1,
    marginLeft: 12,
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  compactTeamCell: {
    width: 0,
  },
  detailTeamCell: {
    width: 58,
    paddingRight: 10,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  teamBadge: {
    minWidth: 42,
    height: 24,
    borderRadius: 7,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  compactScoreCell: {
    width: 32,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactActiveCell: {
    width: 50,
    height: 34,
    borderRadius: 14,
    backgroundColor: 'rgba(31,37,49,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.16)',
  },
  railScoreCell: {
    width: 21,
    height: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railActiveCell: {
    width: 32,
    height: 25,
    borderRadius: 10,
    backgroundColor: 'rgba(45,54,68,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.30)',
    shadowColor: '#7A9DB8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
  },
  compactCellGap: {
    marginLeft: 11,
  },
  railCellGap: {
    marginLeft: 6,
  },
  detailScoreCell: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailColumn: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailColumnGap: {
    marginLeft: 0,
  },
  detailActiveCell: {
    width: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(31,37,49,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.12)',
  },
  detailCellGap: {
    marginLeft: 6,
  },
  detailTotalCell: {
    width: 44,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
    marginLeft: 9,
  },
  detailTotalColumn: {
    flex: 0.9,
    marginLeft: 0,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.08)',
  },
  detailActiveValue: {
    width: 44,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(31,37,49,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(180,211,235,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactScoreText: {
    color: 'rgba(248,250,252,0.9)',
    fontSize: 28,
    lineHeight: 34,
    fontFamily: 'VT323_400Regular',
    letterSpacing: 0.4,
  },
  railScoreText: {
    color: 'rgba(248,250,252,0.9)',
    fontSize: 22,
    lineHeight: 27,
    fontFamily: 'VT323_400Regular',
    letterSpacing: 0.35,
    textAlign: 'center',
  },
  railActiveScoreText: {
    lineHeight: 23,
    transform: [{ translateY: -1 }],
  },
  detailScoreText: {
    color: 'rgba(248,250,252,0.9)',
    fontSize: 32,
    lineHeight: 34,
    fontFamily: 'VT323_400Regular',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  activeScoreText: {
    color: '#F8FAFC',
  },
  totalScoreText: {
    color: '#FFFFFF',
  },
  detailHeaderText: {
    color: 'rgba(255,255,255,0.34)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  detailTotalHeaderText: {
    color: 'rgba(255,255,255,0.56)',
  },
  emptyScoreText: {
    opacity: 0.35,
  },
});

export default TennisScoreGrid;
