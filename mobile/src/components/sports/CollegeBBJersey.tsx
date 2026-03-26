import React, { memo } from 'react';
import Svg, { Path, Rect, Line, Text as SvgText } from 'react-native-svg';

interface CollegeBBJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  number: string;
  size?: number;
}

export const CollegeBBJersey = memo(function CollegeBBJersey({
  primary,
  secondary,
  abbr,
  accent = '#FFFFFF',
  size = 52,
}: CollegeBBJerseyProps) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none">
      {/* Main jersey body — wider straps than NBA */}
      <Path
        d="M26 8 L21 12 L17 20 L17 92 L63 92 L63 20 L59 12 L54 8 L48 15 Q40 20 32 15 Z"
        fill={primary}
      />

      {/* Left armhole — smaller cutout than NBA */}
      <Path
        d="M26 8 L21 12 L17 20 L17 36 L23 24 L29 16 Z"
        fill={secondary}
        fillOpacity={0.3}
      />

      {/* Right armhole */}
      <Path
        d="M54 8 L59 12 L63 20 L63 36 L57 24 L51 16 Z"
        fill={secondary}
        fillOpacity={0.3}
      />

      {/* Deep V-neck collar fill */}
      <Path
        d="M32 15 Q40 26 48 15"
        fill={secondary}
        fillOpacity={0.4}
      />

      {/* V-neck accent piping */}
      <Path
        d="M32 15 Q40 26 48 15"
        stroke={accent}
        strokeWidth={1.5}
        fill="none"
      />

      {/* Left side trim panel */}
      <Rect
        x={19.5}
        y={22}
        width={4.5}
        height={68}
        fill={secondary}
        fillOpacity={0.7}
        rx={1}
      />

      {/* Left inner accent stripe */}
      <Rect
        x={22.5}
        y={22}
        width={1.5}
        height={68}
        fill={accent}
        fillOpacity={0.2}
      />

      {/* Right side trim panel */}
      <Rect
        x={56}
        y={22}
        width={4.5}
        height={68}
        fill={secondary}
        fillOpacity={0.7}
        rx={1}
      />

      {/* Right inner accent stripe */}
      <Rect
        x={56}
        y={22}
        width={1.5}
        height={68}
        fill={accent}
        fillOpacity={0.2}
      />

      {/* Bottom hem trim */}
      <Line
        x1={17}
        y1={90}
        x2={63}
        y2={90}
        stroke={secondary}
        strokeWidth={2.5}
        strokeOpacity={0.8}
      />
      <SvgText
        x="40"
        y="46"
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
