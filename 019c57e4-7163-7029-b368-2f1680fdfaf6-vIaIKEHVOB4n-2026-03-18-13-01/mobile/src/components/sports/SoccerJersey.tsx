import React, { memo } from 'react';
import Svg, { Path, Line, Ellipse, Circle, Text as SvgText } from 'react-native-svg';

interface SoccerJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  number: string;
  size?: number;
}

export const SoccerJersey = memo(function SoccerJersey({
  primary,
  secondary,
  abbr,
  accent = '#FFFFFF',
  size = 52,
}: SoccerJerseyProps) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none">
      {/* Main body — tight-fitting soccer kit */}
      <Path
        d="M30 10 L23 13 L16 20 L10 28 L13 32 L18 26 L16 92 L64 92 L62 26 L67 32 L70 28 L64 20 L57 13 L50 10 L46 16 Q40 19 34 16 Z"
        fill={primary}
      />

      {/* Left contrast sleeve */}
      <Path
        d="M30 10 L23 13 L16 20 L10 28 L13 32 L18 26 L18 20 L30 14 Z"
        fill={secondary}
        fillOpacity={0.45}
      />

      {/* Right contrast sleeve */}
      <Path
        d="M50 10 L57 13 L64 20 L70 28 L67 32 L62 26 L62 20 L50 14 Z"
        fill={secondary}
        fillOpacity={0.45}
      />

      {/* Left side panel */}
      <Path
        d="M16 26 L20 26 L20 92 L16 92 Z"
        fill={secondary}
        fillOpacity={0.15}
      />

      {/* Right side panel */}
      <Path
        d="M60 26 L64 26 L64 92 L60 92 Z"
        fill={secondary}
        fillOpacity={0.15}
      />

      {/* Vertical pinstripes */}
      <Line x1={26} y1={20} x2={26} y2={92} stroke={accent} strokeWidth={0.5} strokeOpacity={0.12} />
      <Line x1={32} y1={18} x2={32} y2={92} stroke={accent} strokeWidth={0.5} strokeOpacity={0.12} />
      <Line x1={38} y1={17} x2={38} y2={92} stroke={accent} strokeWidth={0.5} strokeOpacity={0.12} />
      <Line x1={44} y1={17} x2={44} y2={92} stroke={accent} strokeWidth={0.5} strokeOpacity={0.12} />
      <Line x1={48} y1={18} x2={48} y2={92} stroke={accent} strokeWidth={0.5} strokeOpacity={0.12} />
      <Line x1={54} y1={20} x2={54} y2={92} stroke={accent} strokeWidth={0.5} strokeOpacity={0.12} />

      {/* Crew neck collar — outer ring */}
      <Ellipse cx={40} cy={12} rx={8} ry={4} fill={secondary} fillOpacity={0.6} />
      {/* Collar inner */}
      <Ellipse cx={40} cy={12} rx={5.5} ry={2.8} fill={primary} />
      {/* Collar accent ring */}
      <Ellipse cx={40} cy={12} rx={8} ry={4} stroke={accent} strokeWidth={1} strokeOpacity={0.5} fill="none" />

      {/* Crest badge — upper left chest */}
      <Circle cx={28} cy={30} r={4.5} fill={secondary} fillOpacity={0.35} />
      <Circle cx={28} cy={30} r={4.5} stroke={accent} strokeWidth={0.8} strokeOpacity={0.4} fill="none" />
      <Circle cx={28} cy={30} r={2} fill={accent} fillOpacity={0.3} />
      <SvgText
        x="40"
        y="50"
        textAnchor="middle"
        fontSize="9"
        fontWeight="800"
        letterSpacing={1}
        fill={secondary}
        opacity={0.7}
      >
        {abbr}
      </SvgText>
    </Svg>
  );
});
