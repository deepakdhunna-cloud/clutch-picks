import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface CricketJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const CricketJersey = memo(function CricketJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: CricketJerseyProps) {
  return <MiniJerseyModel variant="cricket" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
