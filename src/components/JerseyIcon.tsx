import React, { memo } from 'react';
import { getTeamColors } from '@/lib/team-colors';
import { Sport } from '@/types/sports';
import { NBAJersey } from './sports/NBAJersey';
import { NFLJersey } from './sports/NFLJersey';
import { MLBJersey } from './sports/MLBJersey';
import { NHLJersey } from './sports/NHLJersey';
import { SoccerJersey } from './sports/SoccerJersey';
import { UCLJersey } from './sports/UCLJersey';
import { CollegeBBJersey } from './sports/CollegeBBJersey';
import { CricketJersey } from './sports/CricketJersey';
import { TennisJersey } from './sports/TennisJersey';

export type JerseySport = 'basketball' | 'college-basketball' | 'football' | 'baseball' | 'hockey' | 'soccer' | 'ucl' | 'cricket' | 'tennis';

interface JerseyIconProps {
  teamCode: string;
  teamName?: string;
  sport?: JerseySport;
  size?: number;
  /** Override primary color (e.g. from ESPN API) */
  primaryColor?: string;
  /** Override secondary color */
  secondaryColor?: string;
}

function jerseyToSport(j?: JerseySport): Sport {
  switch (j) {
    case 'basketball': return Sport.NBA;
    case 'college-basketball': return Sport.NCAAB;
    case 'baseball': return Sport.MLB;
    case 'hockey': return Sport.NHL;
    case 'soccer': return Sport.MLS;
    case 'ucl': return Sport.UCL;
    case 'cricket': return Sport.IPL;
    case 'tennis': return Sport.TENNIS;
    default: return Sport.NFL;
  }
}

function sportFor(sport?: JerseySport): JerseySport {
  return sport ?? 'football';
}

export const JerseyIcon = memo(function JerseyIcon({
  teamCode,
  teamName,
  sport,
  size = 52,
  primaryColor,
  secondaryColor,
}: JerseyIconProps) {
  const needsLookup = !primaryColor || !secondaryColor;
  const colors = needsLookup ? getTeamColors(teamCode, jerseyToSport(sport)) : null;
  const primary = primaryColor ?? colors?.primary ?? '#5A7A8A';
  const secondary = secondaryColor ?? colors?.secondary ?? '#FFFFFF';
  const sportType = sportFor(sport);
  const props = {
    primary,
    secondary,
    accent: '#FFFFFF',
    abbr: teamCode,
    teamName,
    number: teamCode,
    size,
  };

  switch (sportType) {
    case 'basketball':
      return <NBAJersey {...props} />;
    case 'college-basketball':
      return <CollegeBBJersey {...props} />;
    case 'baseball':
      return <MLBJersey {...props} />;
    case 'hockey':
      return <NHLJersey {...props} />;
    case 'soccer':
      return <SoccerJersey {...props} />;
    case 'ucl':
      return <UCLJersey {...props} />;
    case 'cricket':
      return <CricketJersey {...props} />;
    case 'tennis':
      return <TennisJersey {...props} />;
    case 'football':
    default:
      return <NFLJersey {...props} />;
  }
});

export function sportEnumToJersey(sport: string | undefined): JerseySport {
  switch (sport) {
    case 'basketball':
    case 'NBA':
      return 'basketball';
    case 'NCAAB':
      return 'college-basketball';
    case 'football':
    case 'NFL':
    case 'NCAAF':
      return 'football';
    case 'baseball':
    case 'MLB':
      return 'baseball';
    case 'hockey':
    case 'NHL':
      return 'hockey';
    case 'soccer':
    case 'MLS':
    case 'EPL':
      return 'soccer';
    case 'UCL':
      return 'ucl';
    case 'IPL':
    case 'cricket':
      return 'cricket';
    case 'TENNIS':
    case 'tennis':
      return 'tennis';
    default:
      return 'football';
  }
}

export default JerseyIcon;
