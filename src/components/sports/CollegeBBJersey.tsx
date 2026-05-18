import React, { memo } from 'react';
import { MiniJerseyModel } from './jerseyVisuals';

interface CollegeBBJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  number: string;
  size?: number;
}

export const CollegeBBJersey = memo(function CollegeBBJersey({
  primary,
  secondary,
  abbr,
  teamName,
  accent = '#FFFFFF',
  size = 52,
}: CollegeBBJerseyProps) {
  return <MiniJerseyModel variant="college-basketball" primary={primary} secondary={secondary} accent={accent} abbr={abbr} teamName={teamName} size={size} />;
});
