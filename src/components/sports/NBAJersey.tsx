import React, { memo } from 'react';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';

interface NBAJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  number: string;
  size?: number;
}

export const NBAJersey = memo(function NBAJersey({
  primary,
  secondary,
  abbr,
  accent = '#FFFFFF',
  size = 52,
}: NBAJerseyProps) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none">
      {/* Main jersey body — sleeveless tank with deep armholes */}
      <Path
        d="M28 8 L24 10 L19 18 L19 92 L61 92 L61 18 L56 10 L52 8 L48 14 Q40 18 32 14 Z"
        fill={primary}
      />

      {/* Left armhole V-cut */}
      <Path
        d="M28 8 L24 10 L19 18 L19 38 L26 22 L32 14 Z"
        fill={secondary}
        fillOpacity={0.35}
      />

      {/* Right armhole V-cut */}
      <Path
        d="M52 8 L56 10 L61 18 L61 38 L54 22 L48 14 Z"
        fill={secondary}
        fillOpacity={0.35}
      />

      {/* V-neck collar */}
      <Path
        d="M32 14 Q40 22 48 14 Q40 18 32 14 Z"
        fill={secondary}
        fillOpacity={0.5}
      />

      {/* Left side stripe */}
      <Rect
        x={22}
        y={20}
        width={3}
        height={70}
        fill={secondary}
        fillOpacity={0.6}
        rx={1.5}
      />

      {/* Right side stripe */}
      <Rect
        x={55}
        y={20}
        width={3}
        height={70}
        fill={secondary}
        fillOpacity={0.6}
        rx={1.5}
      />
      <SvgText
        x="40"
        y="48"
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
