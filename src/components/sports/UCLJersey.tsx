import React, { memo, useRef } from 'react';
import Svg, {
  Path,
  Line,
  Ellipse,
  Circle,
  Rect,
  Polygon,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

interface UCLJerseyProps {
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  number: string;
  size?: number;
}

function darken(hex: string, factor: number): string {
  if (!hex || !hex.startsWith('#') || hex.replace('#', '').length < 6) return hex || '#000000';
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (isNaN(n)) return hex;
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * factor));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * factor));
  const b = Math.max(0, Math.round((n & 0xff) * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

let _uclIdCounter = 0;

export const UCLJersey = memo(function UCLJersey({
  primary,
  secondary,
  abbr,
  accent = '#FFFFFF',
  size = 52,
}: UCLJerseyProps) {
  const gradId = useRef(`uclGrad${++_uclIdCounter}`).current;
  const primaryDark = darken(primary, 0.65);

  // Starball 6-point star geometry around (28, 30)
  const cx = 28;
  const cy = 30;
  const rInner = 4.2;
  const rOuter = 6.2;
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 3) * i - Math.PI / 2;
    points.push(`${cx + Math.cos(ang) * rOuter},${cy + Math.sin(ang) * rOuter}`);
  }

  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 80 100" fill="none">
      <Defs>
        <SvgLinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={primary} stopOpacity={1} />
          <Stop offset="1" stopColor={primaryDark} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>

      {/* Shadow */}
      <Ellipse cx={40} cy={94} rx={22} ry={2.5} fill="black" fillOpacity={0.25} />

      {/* Main body with gradient */}
      <Path
        d="M30 10 L23 13 L16 20 L10 28 L13 32 L18 26 L16 92 L64 92 L62 26 L67 32 L70 28 L64 20 L57 13 L50 10 L46 16 Q40 19 34 16 Z"
        fill={`url(#${gradId})`}
      />

      {/* Left-side 3D fabric shading */}
      <Path d="M18 26 L16 92 L26 92 L26 28 Z" fill="black" fillOpacity={0.08} />
      {/* Right-side highlight */}
      <Path d="M54 28 L62 26 L64 92 L54 92 Z" fill="white" fillOpacity={0.04} />

      {/* Contrast sleeves */}
      <Path
        d="M30 10 L23 13 L16 20 L10 28 L13 32 L18 26 L18 20 L30 14 Z"
        fill={secondary}
        fillOpacity={0.45}
      />
      <Path
        d="M50 10 L57 13 L64 20 L70 28 L67 32 L62 26 L62 20 L50 14 Z"
        fill={secondary}
        fillOpacity={0.45}
      />

      {/* Sleeve cuff bands */}
      <Rect x={10.5} y={28} width={7} height={2.2} rx={0.8} fill={secondary} fillOpacity={0.7} />
      <Rect x={62.5} y={28} width={7} height={2.2} rx={0.8} fill={secondary} fillOpacity={0.7} />

      {/* Side panels */}
      <Path d="M16 26 L20 26 L20 92 L16 92 Z" fill={secondary} fillOpacity={0.15} />
      <Path d="M60 26 L64 26 L64 92 L60 92 Z" fill={secondary} fillOpacity={0.15} />

      {/* Mesh fabric texture */}
      {Array.from({ length: 10 }).map((_, r) =>
        Array.from({ length: 9 }).map((_, c) => (
          <Circle
            key={`m${r}${c}`}
            cx={24 + c * 4}
            cy={22 + r * 6}
            r={0.45}
            fill="white"
            fillOpacity={0.035}
          />
        ))
      )}

      {/* Sponsor bar across chest */}
      <Rect x={22} y={42} width={36} height={8} fill={secondary} fillOpacity={0.08} />

      {/* Center fold line */}
      <Line x1={40} y1={18} x2={40} y2={88} stroke="black" strokeWidth={0.5} strokeOpacity={0.05} />

      {/* Shoulder highlight */}
      <Path d="M30 12 Q40 9 50 12 L48 18 Q40 16 32 18 Z" fill="white" fillOpacity={0.06} />

      {/* V-neck collar */}
      <Path d="M33 13 L40 22 L47 13" stroke={secondary} strokeWidth={2.2} fill="none" strokeOpacity={0.8} />
      <Path d="M33 13 L40 22 L47 13 Q40 15 33 13 Z" fill={secondary} fillOpacity={0.35} />
      <Path d="M34 14 L40 21 L46 14" stroke="white" strokeWidth={0.5} fill="none" strokeOpacity={0.2} />

      {/* UCL starball badge — 6-point star with inner circle */}
      <Polygon points={points.join(' ')} fill={secondary} fillOpacity={0.4} />
      <Circle cx={cx} cy={cy} r={rInner} fill={secondary} fillOpacity={0.55} />
      <Circle cx={cx} cy={cy} r={rInner} stroke={accent} strokeWidth={0.7} strokeOpacity={0.5} fill="none" />
      <Circle cx={cx} cy={cy} r={1.6} fill={accent} fillOpacity={0.35} />

      {/* Hem stitch */}
      <Line
        x1={17}
        y1={89}
        x2={63}
        y2={89}
        stroke={secondary}
        strokeWidth={0.7}
        strokeOpacity={0.35}
        strokeDasharray="2,2"
      />

      {/* Team abbreviation */}
      <SvgText
        x="48"
        y="58"
        textAnchor="middle"
        fontSize="9"
        fontWeight="800"
        letterSpacing={1}
        fill={secondary}
        opacity={0.75}
      >
        {abbr}
      </SvgText>
    </Svg>
  );
});
