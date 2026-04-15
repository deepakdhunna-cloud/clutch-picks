import React, { memo } from 'react';
import { Sport } from '@/types/sports';
import { NBAJersey } from './NBAJersey';
import { NFLJersey } from './NFLJersey';
import { MLBJersey } from './MLBJersey';
import { NHLJersey } from './NHLJersey';
import { CollegeBBJersey } from './CollegeBBJersey';
import { SoccerJersey as SoccerJerseyNew } from './SoccerJersey';
import { UCLJersey } from './UCLJersey';
import { getTeamColors } from '@/lib/team-colors';

interface TeamJerseyProps {
  teamAbbreviation: string;
  primaryColor?: string;
  secondaryColor?: string;
  size?: number;
  isHighlighted?: boolean;
  sport?: Sport;
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
    case Sport.UCL:
      return <UCLJersey {...props} />;
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

  // Always run through the canonical color helper so jerseys are guaranteed
  // to use the same enforced/enhanced palette regardless of the call site.
  // If a caller explicitly passes colors we honor them, otherwise we look
  // them up here.
  const resolved = (!primaryColor || !secondaryColor)
    ? getTeamColors(teamAbbreviation, sportType)
    : null;
  const primary = primaryColor ?? resolved!.primary;
  const secondary = secondaryColor ?? resolved!.secondary;
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
