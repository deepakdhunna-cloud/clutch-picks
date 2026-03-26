import React, { memo } from 'react';
import Svg, { Path, Line, Circle, Text as SvgText } from 'react-native-svg';

interface MLBJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  number: string;
  size?: number;
}

export const MLBJersey = memo(function MLBJersey({
  primary,
  secondary,
  abbr,
  accent = '#FFFFFF',
  size = 52,
}: MLBJerseyProps) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none">
      {/* Main body with raglan sleeves */}
      <Path
        d="M32 10 L24 12 L15 20 L8 30 L5 38 L12 40 L15 32 L15 92 L65 92 L65 32 L68 40 L75 38 L72 30 L65 20 L56 12 L48 10 L44 15 Q40 18 36 15 Z"
        fill={primary}
      />

      {/* Collar */}
      <Path
        d="M36 15 Q40 18 44 15 L48 10 Q40 7 32 10 L36 15 Z"
        fill={secondary}
        fillOpacity={0.6}
      />

      {/* Left raglan seam — dashed */}
      <Line
        x1={33}
        y1={13}
        x2={15}
        y2={32}
        stroke={secondary}
        strokeWidth={1.2}
        strokeDasharray="3,2.5"
        strokeOpacity={0.5}
      />

      {/* Right raglan seam — dashed */}
      <Line
        x1={47}
        y1={13}
        x2={65}
        y2={32}
        stroke={secondary}
        strokeWidth={1.2}
        strokeDasharray="3,2.5"
        strokeOpacity={0.5}
      />

      {/* Left sleeve piping */}
      <Line x1={9} y1={32} x2={15} y2={26} stroke={secondary} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.6} />
      <Line x1={10} y1={35} x2={15} y2={29} stroke={secondary} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.4} />

      {/* Right sleeve piping */}
      <Line x1={71} y1={32} x2={65} y2={26} stroke={secondary} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.6} />
      <Line x1={70} y1={35} x2={65} y2={29} stroke={secondary} strokeWidth={2} strokeLinecap="round" strokeOpacity={0.4} />

      {/* Center button placket line */}
      <Line
        x1={40}
        y1={18}
        x2={40}
        y2={92}
        stroke={accent}
        strokeWidth={0.8}
        strokeOpacity={0.15}
      />

      {/* Buttons */}
      <Circle cx={40} cy={24} r={1.3} fill={accent} fillOpacity={0.5} />
      <Circle cx={40} cy={34} r={1.3} fill={accent} fillOpacity={0.45} />
      <Circle cx={40} cy={44} r={1.3} fill={accent} fillOpacity={0.4} />
      <Circle cx={40} cy={54} r={1.3} fill={accent} fillOpacity={0.35} />
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
