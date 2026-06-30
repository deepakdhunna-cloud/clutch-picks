import React, { memo, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Stop, Ellipse } from 'react-native-svg';
import { GameWithPrediction, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { TeamJersey } from './TeamJersey';
import { ArenaScoreboard as SharedArenaScoreboard } from './ArenaScoreboard';
import { TennisScoreGrid } from './TennisScoreGrid';
import { displaySport, formatGameTime } from '@/lib/display-confidence';
import {
  isSuspendedGame,
  suspendedLabel,
  suspendedReasonText,
  suspendedResumeText,
} from '@/lib/game-status';
import {
  teamScoreText,
  cricketRoleText,
  cricketOversText,
  cricketRequiredText,
  cricketLedScoreText,
  cricketHasAnyScore,
} from '@/lib/cricket-score';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { deepEqual } from '@/lib/deep-equal';
import { TEAL, LIVE_RED } from '@/lib/theme';
import { PressableScale } from '@/components/shared/PressableScale';
import { PRESS_SCALE_CARD } from '@/lib/motion';

// Add an alpha channel to a #rrggbb / #rgb hex color.
function hexWithAlpha(hex: string | undefined, alpha: number): string {
  if (!hex) return 'rgba(31,41,55,0)';
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255).toString(16).padStart(2, '0');
  if (hex.length === 7 && hex[0] === '#') return `${hex}${aHex}`;
  if (hex.length === 4 && hex[0] === '#') {
    const expanded = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    return `${expanded}${aHex}`;
  }
  return hex;
}

function compactRailTeamName(name: string, sport: Sport): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (sport !== Sport.TENNIS) return trimmed;

  const parts = trimmed.split(' ').filter(Boolean);
  if (parts.length < 2) return trimmed;

  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first.charAt(0)}. ${last}`;
}

// Pulsing red dot — mirrors the LIVE badge dot used on the My Arena game-day cards.
const LiveDot = memo(function LiveDot({ size = 7 }: { size?: number }) {
  const op = useSharedValue(1);
  const sc = useSharedValue(1);
  useEffect(() => {
    op.value = withRepeat(withTiming(0.55, { duration: 750, easing: Easing.inOut(Easing.ease) }), -1, true);
    sc.value = withRepeat(withTiming(0.85, { duration: 750, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => { cancelAnimation(op); cancelAnimation(sc); };
  }, [op, sc]);
  const ds = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ scale: sc.value }] }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#ef4444' }, ds]} />;
});

// Soft black radial shadow that grounds the jerseys and scoreboard against the
// team-color wash. An SVG radial gradient fades fully to transparent at the edge,
// so it spreads smoothly with no hard line. Rendered as an ellipse so it can sit
// behind the wide LED panel as well as the (square) jerseys.
const SoftGlow = memo(function SoftGlow({ width, height, intensity }: { width: number; height: number; intensity: number }) {
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Defs>
        {/* Many stops on a gentle ease-out curve with a long low tail → a perfectly
            smooth falloff with no banding and no visible edge. */}
        <RadialGradient id="liveSoftGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#000000" stopOpacity={intensity} />
          <Stop offset="12%" stopColor="#000000" stopOpacity={intensity * 0.92} />
          <Stop offset="24%" stopColor="#000000" stopOpacity={intensity * 0.8} />
          <Stop offset="36%" stopColor="#000000" stopOpacity={intensity * 0.65} />
          <Stop offset="48%" stopColor="#000000" stopOpacity={intensity * 0.5} />
          <Stop offset="60%" stopColor="#000000" stopOpacity={intensity * 0.35} />
          <Stop offset="72%" stopColor="#000000" stopOpacity={intensity * 0.21} />
          <Stop offset="82%" stopColor="#000000" stopOpacity={intensity * 0.11} />
          <Stop offset="90%" stopColor="#000000" stopOpacity={intensity * 0.05} />
          <Stop offset="96%" stopColor="#000000" stopOpacity={intensity * 0.018} />
          <Stop offset="100%" stopColor="#000000" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill="url(#liveSoftGlow)" />
    </Svg>
  );
});

type Variant = 'rail' | 'full';

interface SizeCfg {
  radius: number;
  innerRadius: number;
  border: number;
  padX: number;
  innerHeight?: number; // fixed inner height for the rail (locks card size)
  padTop: number;
  padBottom: number;
  jersey: number;
  jerseyBox: number;
  scoreScale: number;
  nameSize: number;
  nameLines: number;
  nameLineHeight: number;
  nameMinHeight?: number;
  recordSize: number;
  headerH: number;
  headerMb: number;
  livePadX: number;
  livePadY: number;
  liveFont: number;
  liveDot: number;
  sportPadX: number;
  sportPadY: number;
  sportFont: number;
  timeFont: number;
  bodyGap: number;
  scoreColMin: number;
  scoreColMax: number;
  teamColMin: number;
  showCaptions: boolean;
}

const RAIL: SizeCfg = {
  radius: 22,
  innerRadius: 19.5,
  border: 2.5,
  padX: 12,
  innerHeight: 160,
  padTop: 10,
  padBottom: 11,
  jersey: 46,
  jerseyBox: 50,
  // Bigger LED scoreboard on the compact "Live Now" rail cards — it's the focal
  // point, so let it own more of the card now that the badges are smaller.
  scoreScale: 1.0,
  nameSize: 11.5,
  nameLines: 2,
  nameLineHeight: 14,
  nameMinHeight: 28,
  recordSize: 10,
  // Tighter header + smaller LIVE / sport badges so the layout breathes and the
  // bigger scoreboard has the vertical room it needs.
  headerH: 18,
  headerMb: 5,
  livePadX: 6,
  livePadY: 2.5,
  liveFont: 8,
  liveDot: 5,
  sportPadX: 6,
  sportPadY: 2.5,
  sportFont: 8,
  timeFont: 8.5,
  bodyGap: 6,
  // Widen the score column to fit the larger LED panel without crowding names.
  scoreColMin: 136,
  scoreColMax: 146,
  teamColMin: 58,
  showCaptions: false,
};

const FULL: SizeCfg = {
  radius: 28,
  innerRadius: 25,
  border: 3,
  padX: 14,
  padTop: 14,
  padBottom: 15,
  jersey: 62,
  jerseyBox: 78,
  scoreScale: 1.1,
  nameSize: 13,
  nameLines: 2,
  nameLineHeight: 15.5,
  nameMinHeight: 32,
  recordSize: 11,
  headerH: 36,
  headerMb: 10,
  livePadX: 11,
  livePadY: 6,
  liveFont: 10,
  liveDot: 7,
  sportPadX: 13,
  sportPadY: 6,
  sportFont: 10,
  timeFont: 9,
  bodyGap: 9,
  scoreColMin: 150,
  scoreColMax: 164,
  teamColMin: 70,
  showCaptions: true,
};

export interface LiveArenaCardProps {
  game: GameWithPrediction;
  cardWidth: number;
  variant?: Variant;
  // The parent passes the game so it can supply one stable handler across renders
  // (keeps the deep-equal content memo below from being defeated by fresh closures).
  onPress: (game: GameWithPrediction) => void;
  onPressIn?: (game: GameWithPrediction) => void;
  canOpen?: () => boolean;
}

function propsEqual(prev: LiveArenaCardProps, next: LiveArenaCardProps): boolean {
  return (
    prev.cardWidth === next.cardWidth &&
    prev.variant === next.variant &&
    prev.onPress === next.onPress &&
    prev.onPressIn === next.onPressIn &&
    prev.canOpen === next.canOpen &&
    deepEqual(prev.game, next.game)
  );
}

export const LiveArenaCard = memo(function LiveArenaCard({
  game,
  cardWidth,
  variant = 'rail',
  onPress,
  onPressIn,
  canOpen,
}: LiveArenaCardProps) {
  const cfg = variant === 'rail' ? RAIL : FULL;
  const { onTouchStart, onTouchMove, onTouchCancel, shouldHandlePress } = useTapGestureGuard(6, 500);

  const awayColors = useMemo(
    () => getTeamColors(game.awayTeam.abbreviation, game.sport as Sport, game.awayTeam.color),
    [game.awayTeam.abbreviation, game.awayTeam.color, game.sport]
  );
  const homeColors = useMemo(
    () => getTeamColors(game.homeTeam.abbreviation, game.sport as Sport, game.homeTeam.color),
    [game.homeTeam.abbreviation, game.homeTeam.color, game.sport]
  );
  const awayAccent = awayColors.accent;
  const homeAccent = homeColors.accent;

  const hs = game.homeScore ?? 0;
  const as2 = game.awayScore ?? 0;
  const homeLeading = hs > as2;
  const awayLeading = as2 > hs;

  const suspended = isSuspendedGame(game);
  const suspensionTime = suspendedResumeText(game);
  const suspensionReason = suspendedReasonText(game);
  const isTennis = game.sport === Sport.TENNIS;
  const isCricket = game.sport === Sport.IPL;
  const cricketCaption = !suspended ? cricketOversText(game) : null;
  const cricketChaseLine = !suspended ? cricketRequiredText(game) : null;
  const matchTime = cricketCaption || cricketChaseLine ? null : formatGameTime(game.sport, game.quarter, game.clock);
  const homeCricketRole = isCricket ? cricketRoleText(game, 'home') : null;
  const awayCricketRole = isCricket ? cricketRoleText(game, 'away') : null;
  const homeScoreLabel = isCricket ? teamScoreText(game, 'home') : null;
  const awayScoreLabel = isCricket ? teamScoreText(game, 'away') : null;
  const cricketLedScore = isCricket && !suspended ? cricketLedScoreText(game) : null;
  // When a cricket match has no genuine score from the feed yet (common for
  // domestic/tour matches that ESPN lists as live before publishing a score),
  // we must not render a fabricated "0 - 0" on the LED. Show a neutral dash on
  // the board; the live status/time and captions below convey match state.
  const cricketNoScore = isCricket && !suspended && !cricketHasAnyScore(game);
  const cricketLedDisplay = cricketLedScore ?? (cricketNoScore ? '-' : undefined);

  const innerPadX = cfg.padX;
  const bodyGap = cfg.bodyGap;
  const scoreColumnWidth = Math.min(cfg.scoreColMax, Math.max(cfg.scoreColMin, cardWidth * 0.4));
  const teamColumnWidth = Math.max(
    cfg.teamColMin,
    (cardWidth - cfg.border * 2 - innerPadX * 2 - scoreColumnWidth - bodyGap * 2) / 2
  );

  const renderCricketTeamMeta = (
    scoreLabel: string | null,
    role: 'BATTING' | 'BOWLING' | null,
    colors: { primary: string; secondary: string; accent?: string },
  ) => {
    if (!scoreLabel) return null;
    const batting = role === 'BATTING';
    const accent = colors.accent ?? colors.primary;
    return (
      <View style={{ alignItems: 'center', marginTop: 4 }}>
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.74}
          style={{
            color: batting ? accent : 'rgba(248,250,252,0.74)',
            fontSize: cfg.scoreScale >= 0.9 ? 18 : 14,
            lineHeight: cfg.scoreScale >= 0.9 ? 21 : 17,
            fontFamily: 'VT323_400Regular',
            letterSpacing: 0.5,
          }}
        >
          {scoreLabel}
        </Text>
        {role ? (
          <View style={{ marginTop: 2, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: batting ? accent : 'rgba(255,255,255,0.38)', marginRight: 4 }} />
            <Text style={{ color: batting ? '#f8fafc' : 'rgba(255,255,255,0.46)', fontSize: 7, fontWeight: '900', letterSpacing: 1 }}>
              {role}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const renderTeam = (side: 'home' | 'away') => {
    const team = side === 'home' ? game.homeTeam : game.awayTeam;
    const teamName = variant === 'rail'
      ? compactRailTeamName(team.name, game.sport as Sport)
      : team.name;
    const colors = side === 'home' ? homeColors : awayColors;
    const leading = side === 'home' ? homeLeading : awayLeading;
    const otherLeading = side === 'home' ? awayLeading : homeLeading;
    const role = side === 'home' ? homeCricketRole : awayCricketRole;
    const scoreLabel = side === 'home' ? homeScoreLabel : awayScoreLabel;
    return (
      <View style={{ width: teamColumnWidth, alignItems: 'center', minWidth: 0 }}>
        <View
          style={{
            height: cfg.jerseyBox,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: leading || !otherLeading ? 1 : 0.66,
            transform: [{ scale: leading ? 1.04 : 1 }],
          }}
        >
          {/* Soft black shadow grounds the jersey so it stands out from the team color. */}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <SoftGlow width={cfg.jersey * 1.72} height={cfg.jersey * 1.72} intensity={0.72} />
          </View>
          <TeamJersey
            teamAbbreviation={team.abbreviation}
            teamName={team.name}
            primaryColor={colors.primary}
            secondaryColor={colors.secondary}
            size={cfg.jersey}
            sport={game.sport as Sport}
          />
        </View>
        <Text
          numberOfLines={variant === 'rail' ? 1 : cfg.nameLines}
          adjustsFontSizeToFit={variant === 'rail'}
          minimumFontScale={0.8}
          style={{
            color: '#f8fafc',
            fontSize: cfg.nameSize,
            fontWeight: '900',
            lineHeight: cfg.nameLineHeight,
            textAlign: 'center',
            marginTop: 8,
            minHeight: cfg.nameMinHeight,
          }}
        >
          {teamName}
        </Text>
        {isCricket ? (
          renderCricketTeamMeta(scoreLabel, role, colors)
        ) : (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{
              color: leading ? '#d1d5db' : '#8b95a5',
              fontSize: cfg.recordSize,
              fontWeight: '700',
              marginTop: 4,
              textAlign: 'center',
              alignSelf: 'stretch',
            }}
          >
            {team.record}
          </Text>
        )}
      </View>
    );
  };

  const tennisScoreScale = variant === 'rail' ? 0.76 : 0.9;
  const tennisScoreWidth = Math.min(scoreColumnWidth, variant === 'rail' ? 108 : 130);

  const renderTennisTeam = (side: 'home' | 'away') => {
    const team = side === 'home' ? game.homeTeam : game.awayTeam;
    const colors = side === 'home' ? homeColors : awayColors;
    const leading = side === 'home' ? homeLeading : awayLeading;
    const otherLeading = side === 'home' ? awayLeading : homeLeading;
    const teamName = variant === 'rail'
      ? compactRailTeamName(team.name, game.sport as Sport)
      : team.name;
    const record = team.record?.trim();

    return (
      <View
        style={{
          width: teamColumnWidth,
          minWidth: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            height: cfg.jerseyBox,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: leading || !otherLeading ? 1 : 0.66,
            transform: [{ scale: leading ? 1.04 : 1 }],
          }}
        >
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <SoftGlow width={cfg.jersey * 1.72} height={cfg.jersey * 1.72} intensity={0.72} />
          </View>
          <TeamJersey
            teamAbbreviation={team.abbreviation}
            teamName={team.name}
            primaryColor={colors.primary}
            secondaryColor={colors.secondary}
            size={cfg.jersey}
            sport={game.sport as Sport}
          />
        </View>
        {record ? (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            style={{
              alignSelf: 'stretch',
              color: leading ? '#d1d5db' : '#8b95a5',
              fontSize: variant === 'rail' ? 8.6 : cfg.recordSize,
              fontWeight: '800',
              lineHeight: variant === 'rail' ? 11 : 13,
              marginTop: variant === 'rail' ? 4 : 5,
              textAlign: 'center',
            }}
          >
            {record}
          </Text>
        ) : null}
        <Text
          numberOfLines={variant === 'rail' ? 1 : 2}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
          style={{
            alignSelf: 'stretch',
            color: '#f8fafc',
            fontSize: variant === 'rail' ? 10.8 : cfg.nameSize,
            fontWeight: '900',
            lineHeight: variant === 'rail' ? 13 : cfg.nameLineHeight,
            marginTop: record ? 2 : (variant === 'rail' ? 5 : 6),
            minHeight: variant === 'rail' ? 13 : cfg.nameMinHeight,
            textAlign: 'center',
          }}
        >
          {teamName}
        </Text>
      </View>
    );
  };

  const renderTennisBody = () => (
    <View style={{ flex: cfg.innerHeight ? 1 : undefined, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {renderTennisTeam('home')}

      <View style={{ width: tennisScoreWidth, flexShrink: 0, alignItems: 'center', justifyContent: 'center', marginHorizontal: bodyGap / 2 }}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <SoftGlow width={tennisScoreWidth * 1.08} height={(59.16 * tennisScoreScale + 2) * 1.62} intensity={0.6} />
          </View>
          <SharedArenaScoreboard
            awayScore={as2}
            homeScore={hs}
            awayColor={awayAccent}
            homeColor={homeAccent}
            scale={tennisScoreScale}
            label={suspended ? 'SUSPENDED' : undefined}
            subLabel={suspended ? suspensionReason : undefined}
            detailLabel={suspended ? suspensionTime : undefined}
          />
        </View>
        {!suspended ? (
          <View style={{ marginTop: variant === 'rail' ? 5 : 8, alignItems: 'center', justifyContent: 'center' }}>
            <TennisScoreGrid
              game={game}
              variant="rail"
              homeColor={homeAccent}
              awayColor={awayAccent}
              showTeams={false}
            />
          </View>
        ) : null}
      </View>

      {renderTennisTeam('away')}
    </View>
  );

  return (
    <View
      style={
        variant === 'rail'
          ? {
              width: cardWidth,
              borderRadius: cfg.radius,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 13 },
              shadowOpacity: 0.9,
              shadowRadius: 26,
              elevation: 22,
            }
          : { width: cardWidth, marginBottom: 14 }
      }
    >
      <PressableScale
        pressedScale={PRESS_SCALE_CARD}
        accessibilityRole="button"
        accessibilityLabel={`Open ${game.awayTeam.name} at ${game.homeTeam.name}`}
        accessibilityHint="Opens game details"
        onPressIn={onPressIn ? () => onPressIn(game) : undefined}
        onPress={() => {
          if (!shouldHandlePress()) return;
          if (canOpen && !canOpen()) return;
          onPress(game);
        }}
        pressRetentionOffset={6}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchCancel={onTouchCancel}
        style={{ width: cardWidth }}
      >
        {/* Polished glass frame — metallic specular highlights at the corners,
            tinted with each team's accent (home upper, away lower). */}
        <LinearGradient
          colors={[
            'rgba(224,234,240,0.92)',
            hexWithAlpha(homeAccent, 0.6),
            'rgba(49,63,78,0.34)',
            hexWithAlpha(awayAccent, 0.6),
            'rgba(224,234,240,0.74)',
          ]}
          locations={[0, 0.24, 0.52, 0.78, 1]}
          start={{ x: 0.08, y: 0 }}
          end={{ x: 0.92, y: 1 }}
          style={{ borderRadius: cfg.radius, padding: cfg.border }}
        >
          <View
            style={{
              borderRadius: cfg.innerRadius,
              overflow: 'hidden',
              paddingTop: cfg.padTop,
              paddingBottom: cfg.padBottom,
              paddingHorizontal: innerPadX,
              backgroundColor: 'rgba(5,8,13,0.96)',
              height: cfg.innerHeight,
            }}
          >
            {/* Dark glass base. */}
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(4,6,11,0.9)' }]} />

            {/* Home team color — vivid corner bleed from the top-left (home side). */}
            <LinearGradient
              colors={[hexWithAlpha(homeAccent, 0.93), hexWithAlpha(homeAccent, 0.5), hexWithAlpha(homeAccent, 0.18), 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.74, y: 0.85 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            {/* Away team color — vivid corner bleed from the bottom-right (away side). */}
            <LinearGradient
              colors={[hexWithAlpha(awayAccent, 0.93), hexWithAlpha(awayAccent, 0.5), hexWithAlpha(awayAccent, 0.18), 'transparent']}
              start={{ x: 1, y: 1 }}
              end={{ x: 0.26, y: 0.15 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            {/* Center crush — keeps the LED scoreboard column crisp against the colors. */}
            <LinearGradient
              colors={['transparent', 'rgba(2,3,8,0.62)', 'transparent']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            {/* Lower darken — keeps team names + records readable over the color. */}
            <LinearGradient
              colors={['transparent', 'rgba(3,5,10,0.5)']}
              start={{ x: 0.5, y: 0.42 }}
              end={{ x: 0.5, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            {/* Subtle glass gloss. */}
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.05)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            {/* Side rails tinted to each team (home left, away right). */}
            <LinearGradient
              colors={['transparent', hexWithAlpha(homeAccent, 0.6), 'transparent']}
              style={{ position: 'absolute', left: 1, top: 26, bottom: 22, width: 1.6 }}
            />
            <LinearGradient
              colors={['transparent', hexWithAlpha(awayAccent, 0.6), 'transparent']}
              style={{ position: 'absolute', right: 1, top: 26, bottom: 22, width: 1.6 }}
            />

            {/* Polished top rail — home → white → away. */}
            <LinearGradient
              colors={['transparent', hexWithAlpha(homeAccent, 0.78), 'rgba(255,255,255,0.72)', hexWithAlpha(awayAccent, 0.78), 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ position: 'absolute', top: 0, left: '10%' as any, right: '10%' as any, height: 1.6 }}
            />

            {/* Header — LIVE badge left, sport badge right. */}
            <View style={{ height: cfg.headerH, marginBottom: cfg.headerMb, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.11)', borderRadius: 999, paddingHorizontal: cfg.livePadX, paddingVertical: cfg.livePadY, borderWidth: 1, borderColor: 'rgba(239,68,68,0.24)' }}>
                <View style={{ marginRight: 6 }}>
                  <LiveDot size={cfg.liveDot} />
                </View>
                <Text style={{ color: '#ff5a52', fontSize: cfg.liveFont, fontWeight: '900', letterSpacing: 1.6 }}>
                  {suspended ? suspendedLabel(game).toUpperCase() : 'LIVE'}
                </Text>
              </View>
              <View style={{ backgroundColor: 'rgba(122,157,184,0.12)', borderWidth: 1, borderColor: 'rgba(122,157,184,0.28)', borderRadius: 999, paddingHorizontal: cfg.sportPadX, paddingVertical: cfg.sportPadY }}>
                <Text style={{ color: TEAL, fontSize: cfg.sportFont, letterSpacing: 1.5, fontWeight: '900' }}>
                  {displaySport(game.sport)}
                </Text>
              </View>
            </View>

            {/* Match body — tennis gets player metadata + set scores; other sports keep the team-versus-team layout. */}
            {isTennis ? renderTennisBody() : (
              <View style={{ flex: cfg.innerHeight ? 1 : undefined, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                {renderTeam('home')}

                <View style={{ width: scoreColumnWidth, flexShrink: 0, alignItems: 'center', justifyContent: 'center', marginHorizontal: bodyGap / 2 }}>
                  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                    {/* Soft black shadow grounds the LED panel against the team color. */}
                    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                      <SoftGlow width={scoreColumnWidth * 1.14} height={(59.16 * cfg.scoreScale + 2) * 1.72} intensity={0.62} />
                    </View>
                    <SharedArenaScoreboard
                      awayScore={as2}
                      homeScore={hs}
                      awayColor={awayAccent}
                      homeColor={homeAccent}
                      scale={cfg.scoreScale}
                      label={suspended ? 'SUSPENDED' : undefined}
                      displayText={cricketLedDisplay}
                      subLabel={suspended ? suspensionReason : undefined}
                      detailLabel={suspended ? suspensionTime : undefined}
                    />
                  </View>
                  {!suspended && matchTime ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginTop: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: LIVE_RED, marginRight: 5 }} />
                      <Text style={{ color: '#b8c3d1', fontSize: cfg.timeFont, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' }}>
                        {matchTime}
                      </Text>
                    </View>
                  ) : null}
                  {cfg.showCaptions && !suspended && cricketCaption ? (
                    <Text style={{ color: 'rgba(248,250,252,0.66)', fontSize: 10, fontWeight: '900', letterSpacing: 1.4, marginTop: 6, textTransform: 'uppercase' }}>
                      {cricketCaption}
                    </Text>
                  ) : null}
                  {cfg.showCaptions && !suspended && cricketChaseLine ? (
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={{ maxWidth: scoreColumnWidth + 18, color: 'rgba(248,250,252,0.76)', fontSize: 8.8, fontWeight: '900', lineHeight: 11, marginTop: 2, textAlign: 'center', textTransform: 'uppercase' }}>
                      {cricketChaseLine}
                    </Text>
                  ) : null}
                </View>

                {renderTeam('away')}
              </View>
            )}
          </View>
          </LinearGradient>
        </PressableScale>
      </View>
    );
}, propsEqual);

export default LiveArenaCard;
