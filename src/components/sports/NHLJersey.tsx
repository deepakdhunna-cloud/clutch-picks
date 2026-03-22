import React, { memo } from 'react';
import Svg, { Path, Line, Rect, Text as SvgText } from 'react-native-svg';

interface NHLJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  number: string;
  size?: number;
}

export const NHLJersey = memo(function NHLJersey({
  primary,
  secondary,
  abbr,
  accent = '#FFFFFF',
  size = 52,
}: NHLJerseyProps) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none">
      {/* Main body — baggy hockey sweater with long sleeves */}
      <Path
        d="M30 10 L22 13 L12 22 L3 34 L3 44 L10 44 L12 36 L12 94 L68 94 L68 36 L70 44 L77 44 L77 34 L68 22 L58 13 L50 10 L46 16 Q40 20 34 16 Z"
        fill={primary}
      />

      {/* Shoulder yoke overlay */}
      <Path
        d="M30 10 L22 13 L12 22 L3 34 L3 44 L10 44 L12 36 L12 40 L68 40 L68 36 L70 44 L77 44 L77 34 L68 22 L58 13 L50 10 L46 16 Q40 20 34 16 Z"
        fill={secondary}
        fillOpacity={0.15}
      />

      {/* Left sleeve — thick stripe */}
      <Line x1={5} y1={36} x2={12} y2={28} stroke={secondary} strokeWidth={4} strokeLinecap="round" strokeOpacity={0.85} />
      {/* Left sleeve — thin accent stripe */}
      <Line x1={6} y1={40} x2={12} y2={32} stroke={accent} strokeWidth={1.8} strokeLinecap="round" strokeOpacity={0.5} />

      {/* Right sleeve — thick stripe */}
      <Line x1={75} y1={36} x2={68} y2={28} stroke={secondary} strokeWidth={4} strokeLinecap="round" strokeOpacity={0.85} />
      {/* Right sleeve — thin accent stripe */}
      <Line x1={74} y1={40} x2={68} y2={32} stroke={accent} strokeWidth={1.8} strokeLinecap="round" strokeOpacity={0.5} />

      {/* Bottom hem stripe band */}
      <Rect
        x={12}
        y={87}
        width={56}
        height={3.5}
        fill={secondary}
        fillOpacity={0.85}
        rx={1}
      />
      {/* Bottom hem accent line */}
      <Line x1={12} y1={84} x2={68} y2={84} stroke={accent} strokeWidth={1} strokeOpacity={0.25} />

      {/* Lace-up collar — V-shape */}
      <Line x1={40} y1={22} x2={35} y2={13} stroke={accent} strokeWidth={1.5} strokeOpacity={0.7} />
      <Line x1={40} y1={22} x2={45} y2={13} stroke={accent} strokeWidth={1.5} strokeOpacity={0.7} />
      {/* Cross-lace lines */}
      <Line x1={37} y1={16} x2={43} y2={16} stroke={accent} strokeWidth={1.2} strokeOpacity={0.55} />
      <Line x1={38} y1={19} x2={42} y2={19} stroke={accent} strokeWidth={1.2} strokeOpacity={0.45} />
      <SvgText
        x="40"
        y="54"
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
