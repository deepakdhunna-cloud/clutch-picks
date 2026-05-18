import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface SoccerJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const SoccerJersey = memo(function SoccerJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: SoccerJerseyProps) {
  return <MiniJerseyModel variant="soccer" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
