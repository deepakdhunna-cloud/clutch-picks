import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface UCLJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const UCLJersey = memo(function UCLJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: UCLJerseyProps) {
  return <MiniJerseyModel variant="ucl" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
