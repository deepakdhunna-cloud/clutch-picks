import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface NBAJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const NBAJersey = memo(function NBAJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: NBAJerseyProps) {
  return <MiniJerseyModel variant="basketball" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
