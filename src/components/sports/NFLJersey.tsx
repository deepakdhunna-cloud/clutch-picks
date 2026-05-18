import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface NFLJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const NFLJersey = memo(function NFLJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: NFLJerseyProps) {
  return <MiniJerseyModel variant="football" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
