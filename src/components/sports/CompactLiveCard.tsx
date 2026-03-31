import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GameWithPrediction, Sport } from '@/types/sports';
import { getTeamColors } from '@/lib/team-colors';
import { TeamJerseyCompact } from './TeamJersey';

const CARD_WIDTH = 300;
const CARD_HEIGHT = 165;

interface CompactLiveCardProps {
  game: GameWithPrediction;
  onPress: () => void;
}

export const CompactLiveCard = React.memo(function CompactLiveCard({ game, onPress }: CompactLiveCardProps) {
  const awayColors = useMemo(
    () => getTeamColors(game.awayTeam.abbreviation, game.sport as Sport),
    [game.awayTeam.abbreviation, game.sport]
  );
  const homeColors = useMemo(
    () => getTeamColors(game.homeTeam.abbreviation, game.sport as Sport),
    [game.homeTeam.abbreviation, game.sport]
  );

  const awayScore = game.awayScore ?? 0;
  const homeScore = game.homeScore ?? 0;
  const awayWinning = awayScore > homeScore;
  const homeWinning = homeScore > awayScore;

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
    <Pressable
      onPress={onPress}
      className="active:opacity-85"
    >
      {/* Glass border — dark reflective with team colors */}
      <View style={{ borderRadius: 18, padding: 2, overflow: 'hidden' }}>
        <LinearGradient
          colors={[
            `${awayColors.primary}90`,
            `${awayColors.primary}50`,
            '#0D1118',
            '#080C12',
            '#0D1118',
            `${homeColors.primary}50`,
            `${homeColors.primary}90`,
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
              `${awayColors.primary}60`,
              'rgba(255,255,255,0.12)',
              '#080C12',
              'rgba(0,0,0,0.6)',
              `${homeColors.primary}50`,
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
        colors={[`${awayColors.primary}EE`, `${awayColors.primary}88`, `${awayColors.primary}33`, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.8 }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      {/* Home team color — vivid corner bleed bottom-right */}
      <LinearGradient
        colors={[`${homeColors.primary}EE`, `${homeColors.primary}88`, `${homeColors.primary}33`, 'transparent']}
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
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#DC2626', marginRight: 4 }} />
            <Text style={{ color: '#DC2626', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>LIVE</Text>
          </View>
          <View style={{
            backgroundColor: 'rgba(122,157,184,0.15)',
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 5,
            borderWidth: 1,
            borderColor: 'rgba(122,157,184,0.3)',
          }}>
            <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 }}>{game.sport === 'NCAAF' ? 'CFB' : game.sport === 'NCAAB' ? 'CBB' : game.sport}</Text>
          </View>
        </View>

        {/* Main body: stacked teams with jerseys */}
        <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 0, justifyContent: 'space-evenly' }}>

          {/* Away team row */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TeamJerseyCompact
              teamAbbreviation={game.awayTeam.abbreviation}
              primaryColor={awayColors.primary}
              secondaryColor={awayColors.secondary}
              size={34}
              isHighlighted={false}
              sport={game.sport}
            />
            <View style={{ marginLeft: 8, flex: 1 }}>
              <Text style={{
                color: awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                fontSize: 13,
                fontWeight: awayWinning ? '800' : '500',
                letterSpacing: 0.4,
              }}>
                {game.awayTeam.city || game.awayTeam.abbreviation}
              </Text>
              {game.awayTeam.record ? (
                <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, fontWeight: '500', marginTop: 1 }}>
                  {game.awayTeam.record}
                </Text>
              ) : null}
            </View>
            <Text style={{
              color: awayWinning ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
              fontSize: 20,
              fontWeight: awayWinning ? '900' : '500',
              letterSpacing: -0.5,
            }}>
              {awayScore}
            </Text>
          </View>

          {/* Home team row */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TeamJerseyCompact
              teamAbbreviation={game.homeTeam.abbreviation}
              primaryColor={homeColors.primary}
              secondaryColor={homeColors.secondary}
              size={34}
              isHighlighted={false}
              sport={game.sport}
            />
            <View style={{ marginLeft: 8, flex: 1 }}>
              <Text style={{
                color: homeWinning ? '#FFFFFF' : 'rgba(255,255,255,0.35)',
                fontSize: 13,
                fontWeight: homeWinning ? '800' : '500',
                letterSpacing: 0.4,
              }}>
                {game.homeTeam.city || game.homeTeam.abbreviation}
              </Text>
              {game.homeTeam.record ? (
                <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, fontWeight: '500', marginTop: 1 }}>
                  {game.homeTeam.record}
                </Text>
              ) : null}
            </View>
            <Text style={{
              color: homeWinning ? '#FFFFFF' : 'rgba(255,255,255,0.25)',
              fontSize: 20,
              fontWeight: homeWinning ? '900' : '500',
              letterSpacing: -0.5,
            }}>
              {homeScore}
            </Text>
          </View>
        </View>

        {/* Bottom bar: fading divider + time left + TV badge */}
        <View style={{ position: 'relative', paddingHorizontal: 12, paddingVertical: 9 }}>
          {/* Divider line */}
          <View style={{ position: 'absolute', top: 0, left: 16, right: 16, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.15)' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: quarter + clock */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {game.quarter ? (
                <View style={{
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  paddingHorizontal: 7,
                  paddingVertical: 2,
                  borderRadius: 5,
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.22)',
                }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>{game.quarter}</Text>
                </View>
              ) : null}
              {game.clock ? (
                <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700', letterSpacing: 0.3 }}>
                  {game.clock}
                </Text>
              ) : null}
              {!game.quarter && !game.clock ? (
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '600' }}>IN PROGRESS</Text>
              ) : null}
            </View>
            {/* Right: TV channel badge */}
            {game.tvChannel ? (
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.12)',
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 5,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.22)',
              }}>
                <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '700' }}>{game.tvChannel}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
        </View>
        </View>
      </View>
    </Pressable>
    </View>
  );
});

export default CompactLiveCard;
