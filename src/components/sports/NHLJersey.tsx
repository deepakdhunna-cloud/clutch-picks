import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface NHLJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const NHLJersey = memo(function NHLJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: NHLJerseyProps) {
  return <MiniJerseyModel variant="hockey" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
