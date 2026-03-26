import React, { memo } from 'react';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';

interface NFLJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  number: string;
  size?: number;
}

export const NFLJersey = memo(function NFLJersey({
  primary,
  secondary,
  abbr,
  accent = '#FFFFFF',
  size = 52,
}: NFLJerseyProps) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none">
      {/* Main jersey body with short sleeves */}
      <Path
        d="M30 10 L22 14 L13 22 L6 30 L10 34 L17 28 L17 92 L63 92 L63 28 L70 34 L74 30 L67 22 L58 14 L50 10 L46 16 Q40 20 34 16 Z"
        fill={primary}
      />

      {/* Shoulder yoke overlay */}
      <Path
        d="M30 10 L22 14 L13 22 L6 30 L10 34 L17 28 L17 38 L63 38 L63 28 L70 34 L74 30 L67 22 L58 14 L50 10 L46 16 Q40 20 34 16 Z"
        fill={secondary}
        fillOpacity={0.12}
      />

      {/* V-neck collar */}
      <Path
        d="M34 16 Q40 24 46 16"
        stroke={accent}
        strokeWidth={1.8}
        fill={secondary}
        fillOpacity={0.4}
      />

      {/* Left sleeve stripes — diagonal */}
      <Line x1={9} y1={27} x2={16} y2={23} stroke={secondary} strokeWidth={2.5} strokeLinecap="round" strokeOpacity={0.7} />
      <Line x1={10} y1={30} x2={17} y2={26} stroke={secondary} strokeWidth={2.5} strokeLinecap="round" strokeOpacity={0.5} />
      <Line x1={11} y1={33} x2={17} y2={29} stroke={secondary} strokeWidth={2.5} strokeLinecap="round" strokeOpacity={0.3} />

      {/* Right sleeve stripes — diagonal */}
      <Line x1={71} y1={27} x2={64} y2={23} stroke={secondary} strokeWidth={2.5} strokeLinecap="round" strokeOpacity={0.7} />
      <Line x1={70} y1={30} x2={63} y2={26} stroke={secondary} strokeWidth={2.5} strokeLinecap="round" strokeOpacity={0.5} />
      <Line x1={69} y1={33} x2={63} y2={29} stroke={secondary} strokeWidth={2.5} strokeLinecap="round" strokeOpacity={0.3} />

      {/* Side seam lines */}
      <Line x1={17} y1={38} x2={17} y2={92} stroke={secondary} strokeWidth={0.8} strokeOpacity={0.15} />
      <Line x1={63} y1={38} x2={63} y2={92} stroke={secondary} strokeWidth={0.8} strokeOpacity={0.15} />
      <SvgText
        x="40"
        y="52"
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
