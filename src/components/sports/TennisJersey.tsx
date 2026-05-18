import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface TennisJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const TennisJersey = memo(function TennisJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: TennisJerseyProps) {
  return <MiniJerseyModel variant="tennis" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
