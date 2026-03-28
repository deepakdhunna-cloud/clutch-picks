import React, { memo } from 'react';
import { Sport } from '@/types/sports';
import { NBAJersey } from './NBAJersey';
import { NFLJersey } from './NFLJersey';
import { MLBJersey } from './MLBJersey';
import { NHLJersey } from './NHLJersey';
import { CollegeBBJersey } from './CollegeBBJersey';
import { SoccerJersey as SoccerJerseyNew } from './SoccerJersey';
import { NFL_TEAM_COLORS, NBA_TEAM_COLORS, MLB_TEAM_COLORS, NHL_TEAM_COLORS, MLS_TEAM_COLORS, EPL_TEAM_COLORS, NCAAB_TEAM_COLORS, NCAAF_TEAM_COLORS, TeamColors } from '@/lib/team-colors';

const FALLBACK_PRIMARY = '#374151';
const FALLBACK_SECONDARY = '#6B7280';

interface TeamJerseyProps {
  teamAbbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  size?: number;
  isHighlighted?: boolean;
  sport?: Sport;
}

/**
 * Looks up team colors from the sport-specific TEAM_COLORS constants.
 * Returns the colors from the map if found, otherwise returns the fallback grays.
 */
function getJerseyColors(teamAbbreviation: string, sport: Sport): TeamColors {
  let colorMap: Record<string, TeamColors> | undefined;

  switch (sport) {
    case Sport.NFL:
      colorMap = NFL_TEAM_COLORS;
      break;
    case Sport.NBA:
      colorMap = NBA_TEAM_COLORS;
      break;
    case Sport.MLB:
      colorMap = MLB_TEAM_COLORS;
      break;
    case Sport.NHL:
      colorMap = NHL_TEAM_COLORS;
      break;
    case Sport.MLS:
      colorMap = MLS_TEAM_COLORS;
      break;
    case Sport.EPL:
      colorMap = EPL_TEAM_COLORS;
      break;
    case Sport.NCAAB:
      colorMap = NCAAB_TEAM_COLORS;
      break;
    case Sport.NCAAF:
      colorMap = NCAAF_TEAM_COLORS;
      break;
    default:
      colorMap = undefined;
  }

  const found = colorMap?.[teamAbbreviation];
  return found ?? { primary: FALLBACK_PRIMARY, secondary: FALLBACK_SECONDARY };
}

/**
 * Returns the appropriate jersey JSX element for the given sport.
 */
function getSportJersey(
  sport: Sport,
  props: { primary: string; secondary: string; accent: string; abbr: string; number: string; size: number },
) {
  switch (sport) {
    case Sport.NBA:
      return <NBAJersey {...props} />;
    case Sport.NFL:
      return <NFLJersey {...props} />;
    case Sport.MLB:
      return <MLBJersey {...props} />;
    case Sport.NHL:
      return <NHLJersey {...props} />;
    case Sport.NCAAB:
      return <CollegeBBJersey {...props} />;
    case Sport.NCAAF:
      return <NFLJersey {...props} />;
    case Sport.MLS:
      return <SoccerJerseyNew {...props} />;
    case Sport.EPL:
      return <SoccerJerseyNew {...props} />;
    default:
      return <NFLJersey {...props} />;
  }
}

export const TeamJersey = memo(function TeamJersey({
  teamAbbreviation,
  primaryColor,
  secondaryColor,
  size = 56,
  isHighlighted = false,
  sport,
}: TeamJerseyProps) {
  const sportType = sport || Sport.NFL;

  const primary = primaryColor || FALLBACK_PRIMARY;
  const secondary = secondaryColor || FALLBACK_SECONDARY;
  const accent = isHighlighted ? '#8B0A1F' : '#FFFFFF';

  return getSportJersey(sportType, {
    primary,
    secondary,
    accent,
    abbr: teamAbbreviation,
    number: teamAbbreviation,
    size,
  });
});

// Compact version for smaller spaces - memoized
export const TeamJerseyCompact = memo(function TeamJerseyCompact({
  teamAbbreviation,
  primaryColor,
  secondaryColor,
  size = 44,
  isHighlighted = false,
  sport,
}: TeamJerseyProps) {
  return (
    <TeamJersey
      teamAbbreviation={teamAbbreviation}
      primaryColor={primaryColor}
      secondaryColor={secondaryColor}
      size={size}
      isHighlighted={isHighlighted}
      sport={sport}
    />
  );
});
