import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface MLBJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const MLBJersey = memo(function MLBJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: MLBJerseyProps) {
  return <MiniJerseyModel variant="baseball" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
