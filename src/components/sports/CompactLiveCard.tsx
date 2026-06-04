import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { HapticPressable } from '@/components/HapticPressable';
import { LinearGradient } from 'expo-linear-gradient';
import { GameWithPrediction, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { TeamJerseyCompact } from './TeamJersey';
import { displaySport, formatGameTime } from '@/lib/display-confidence';
import { isSuspendedGame, suspendedLabel, suspendedReasonText, suspendedResumeText } from '@/lib/game-status';
import { cricketRequiredText, cricketRoleText, cricketStatusText, teamScoreText } from '@/lib/cricket-score';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { getFeaturedWatchOption } from '@/lib/watch-options';

const CARD_WIDTH = 300;
const CARD_HEIGHT = 165;

interface CompactLiveCardProps {
  game: GameWithPrediction;
  onPress: () => void;
  onPressIn?: () => void;
}

export const CompactLiveCard = React.memo(function CompactLiveCard({ game, onPress, onPressIn }: CompactLiveCardProps) {
  const {
    onTouchStart,
    onTouchMove,
    onTouchCancel,
    shouldHandlePress,
  } = useTapGestureGuard();
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

  const awayScore = game.awayScore ?? 0;
  const homeScore = game.homeScore ?? 0;
  const awayScoreLabel = teamScoreText(game, 'away');
  const homeScoreLabel = teamScoreText(game, 'home');
  const cricketStatus = cricketStatusText(game);
  const cricketRequired = cricketRequiredText(game);
  const isCricket = game.sport === Sport.IPL;
  const awayCricketRole = isCricket ? cricketRoleText(game, 'away') : null;
  const homeCricketRole = isCricket ? cricketRoleText(game, 'home') : null;
  const awayBatting = awayCricketRole === 'BATTING';
  const homeBatting = homeCricketRole === 'BATTING';
  const suspended = isSuspendedGame(game);
  const suspensionTime = suspendedResumeText(game);
  const suspensionReason = suspendedReasonText(game);
  const awayWinning = awayScore > homeScore;
  const homeWinning = homeScore > awayScore;
  const watchOption = useMemo(() => getFeaturedWatchOption(game.tvChannel, game.watchSources), [game.tvChannel, game.watchSources]);

  return (
    <View style={{
      width: CARD_WIDTH,
      marginRight: 10,
      borderRadius: 18,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.9,
      shadowRadius: 24,
      elevation: 20,
    }}>
    <HapticPressable hapticStyle="light"
      onPressIn={onPressIn}
      onPress={() => {
        if (!shouldHandlePress()) return;
        onPress();
      }}
      pressRetentionOffset={6}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      className="active:opacity-85"
    >
      {/* Glass border — dark reflective with team colors */}
      <View style={{ borderRadius: 18, padding: 2, overflow: 'hidden' }}>
        <LinearGradient
          colors={[
            `${awayAccent}90`,
            `${awayAccent}50`,
            '#0D1118',
            '#080C12',
            '#0D1118',
            `${homeAccent}50`,
            `${homeAccent}90`,
          ]}
          locations={[0, 0.15, 0.35, 0.5, 0.65, 0.85, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 18 }}
        />
        {/* Inner bevel — specular highlight top, deep shadow bottom */}
        <View style={{ borderRadius: 16, padding: 1, overflow: 'hidden' }}>
          <LinearGradient
            colors={[
              `${awayAccent}60`,
              'rgba(255,255,255,0.12)',
              '#080C12',
              'rgba(0,0,0,0.6)',
              `${homeAccent}50`,
            ]}
            locations={[0, 0.2, 0.5, 0.8, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16 }}
          />
        {/* Card body */}
        <View style={{ borderRadius: 15, overflow: 'hidden', height: CARD_HEIGHT }}>
      {/* Dark glass base */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,10,0.82)' }} />

      {/* Away team color — vivid corner bleed top-left */}
      <LinearGradient
        colors={[`${awayAccent}EE`, `${awayAccent}88`, `${awayAccent}33`, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.8 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {/* Home team color — vivid corner bleed bottom-right */}
      <LinearGradient
        colors={[`${homeAccent}EE`, `${homeAccent}88`, `${homeAccent}33`, 'transparent']}
        start={{ x: 1, y: 1 }}
        end={{ x: 0.3, y: 0.2 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {/* Deep black center crush — makes glass feel thick and premium */}
      <LinearGradient
        colors={['transparent', 'rgba(2,3,8,0.72)', 'transparent']}
        start={{ x: 0.5, y: 0.0 }}
        end={{ x: 0.5, y: 1.0 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {/* Card content */}
      <View style={{ flex: 1, flexDirection: 'column' }}>

        {/* Top section: LIVE badge + sport */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 9, paddingBottom: 6 }}>
          <View style={{ alignItems: 'flex-start', flexShrink: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#DC2626', marginRight: 4 }} />
              <Text style={{ color: '#DC2626', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>
                {suspended ? suspendedLabel(game).toUpperCase() : 'LIVE'}
              </Text>
            </View>
            {suspended ? (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '800', marginTop: 2, maxWidth: 170 }}
              >
                {suspensionReason}
              </Text>
            ) : null}
          </View>
          <View style={{
            backgroundColor: 'rgba(122,157,184,0.15)',
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: 'rgba(122,157,184,0.3)',
          }}>
            <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>{displaySport(game.sport)}</Text>
          </View>
        </View>

        {/* Main body: stacked teams with jerseys */}
        <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 0, justifyContent: 'space-evenly' }}>

          {/* Away team row */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TeamJerseyCompact
              teamAbbreviation={game.awayTeam.abbreviation}
              teamName={game.awayTeam.name}
              primaryColor={awayColors.primary}
              secondaryColor={awayColors.secondary}
              size={34}
              isHighlighted={false}
              sport={game.sport}
            />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={{
              color: suspended || awayWinning || awayBatting
                ? '#FFFFFF'
                : isCricket ? 'rgba(255,255,255,0.66)' : 'rgba(255,255,255,0.35)',
                fontSize: 13,
                fontWeight: awayWinning || awayBatting ? '800' : '500',
                letterSpacing: 0.4,
              }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                {game.awayTeam.city || game.awayTeam.abbreviation}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                {game.awayTeam.record ? (
                  <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 10, fontWeight: '600' }}>
                    {game.awayTeam.record}
                  </Text>
                ) : null}
                {awayCricketRole ? (
                  <>
                    {game.awayTeam.record ? (
                      <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 10, fontWeight: '600', marginHorizontal: 6 }}>·</Text>
                    ) : null}
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: awayBatting ? `${awayAccent}24` : 'rgba(255,255,255,0.06)',
                      borderRadius: 999,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      borderWidth: 1,
                      borderColor: awayBatting ? `${awayAccent}55` : 'rgba(255,255,255,0.12)',
                    }}>
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: awayBatting ? awayAccent : 'rgba(255,255,255,0.5)', marginRight: 5 }} />
                      <Text style={{ color: awayBatting ? '#FFFFFF' : 'rgba(255,255,255,0.6)', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.8 }}>
                        {awayCricketRole}
                      </Text>
                    </View>
                  </>
                ) : null}
              </View>
            </View>
            <Text style={{
              color: isCricket
                ? awayBatting ? '#FFFFFF' : 'rgba(255,255,255,0.74)'
                : '#FFFFFF',
              fontSize: 20,
              fontFamily: 'VT323_400Regular',
              letterSpacing: -0.5,
              marginLeft: 8,
              opacity: suspended ? 0.55 : isCricket ? awayBatting ? 1 : 0.72 : awayWinning ? 1 : 0.35,
            }}>
              {awayScoreLabel}
            </Text>
          </View>

          {/* Home team row */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TeamJerseyCompact
              teamAbbreviation={game.homeTeam.abbreviation}
              teamName={game.homeTeam.name}
              primaryColor={homeColors.primary}
              secondaryColor={homeColors.secondary}
              size={34}
              isHighlighted={false}
              sport={game.sport}
            />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={{
              color: suspended || homeWinning || homeBatting
                ? '#FFFFFF'
                : isCricket ? 'rgba(255,255,255,0.66)' : 'rgba(255,255,255,0.35)',
                fontSize: 13,
                fontWeight: homeWinning || homeBatting ? '800' : '500',
                letterSpacing: 0.4,
              }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                {game.homeTeam.city || game.homeTeam.abbreviation}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                {game.homeTeam.record ? (
                  <Text style={{ color: 'rgba(255,255,255,0.42)', fontSize: 10, fontWeight: '600' }}>
                    {game.homeTeam.record}
                  </Text>
                ) : null}
                {homeCricketRole ? (
                  <>
                    {game.homeTeam.record ? (
                      <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 10, fontWeight: '600', marginHorizontal: 6 }}>·</Text>
                    ) : null}
                    <View style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: homeBatting ? `${homeAccent}24` : 'rgba(255,255,255,0.06)',
                      borderRadius: 999,
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      borderWidth: 1,
                      borderColor: homeBatting ? `${homeAccent}55` : 'rgba(255,255,255,0.12)',
                    }}>
                      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: homeBatting ? homeAccent : 'rgba(255,255,255,0.5)', marginRight: 5 }} />
                      <Text style={{ color: homeBatting ? '#FFFFFF' : 'rgba(255,255,255,0.6)', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.8 }}>
                        {homeCricketRole}
                      </Text>
                    </View>
                  </>
                ) : null}
              </View>
            </View>
            <Text style={{
              color: isCricket
                ? homeBatting ? '#FFFFFF' : 'rgba(255,255,255,0.74)'
                : '#FFFFFF',
              fontSize: 20,
              fontFamily: 'VT323_400Regular',
              letterSpacing: -0.5,
              marginLeft: 8,
              opacity: suspended ? 0.55 : isCricket ? homeBatting ? 1 : 0.72 : homeWinning ? 1 : 0.35,
            }}>
              {homeScoreLabel}
            </Text>
          </View>
        </View>

        {/* Bottom bar: fading divider + time left + TV badge */}
        <View style={{ position: 'relative', paddingHorizontal: 12, paddingVertical: 9 }}>
          {/* Divider line */}
          <View style={{ position: 'absolute', top: 0, left: 16, right: 16, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.15)' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: game time */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {(() => {
                const timeStr = suspended ? suspensionTime : cricketRequired ?? cricketStatus ?? formatGameTime(game.sport, game.quarter, game.clock);
                if (timeStr) {
                  return (
                    <View style={{
                      backgroundColor: suspended ? 'rgba(220,38,38,0.13)' : 'rgba(255,255,255,0.12)',
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      borderRadius: 5,
                      borderWidth: 1,
                      borderColor: suspended ? 'rgba(220,38,38,0.28)' : 'rgba(255,255,255,0.22)',
                    }}>
                      <Text numberOfLines={1} style={{ color: suspended ? '#DC2626' : '#FFFFFF', fontSize: 10, fontWeight: '700' }}>{timeStr}</Text>
                    </View>
                  );
                }
                return <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600' }}>IN PROGRESS</Text>;
              })()}
            </View>
            {/* Right: TV channel badge */}
            {watchOption ? (
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.12)',
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 5,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.22)',
              }}>
                <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700', maxWidth: 104 }}>{watchOption.name}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
        </View>
        </View>
      </View>
    </HapticPressable>
    </View>
  );
});

export default CompactLiveCard;
