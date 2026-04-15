import React, { memo, useRef } from 'react';

let _jerseyIdCounter = 0;
import Svg, {
  Path,
  Rect,
  Line,
  Circle,
  Ellipse,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { getTeamColors } from '@/lib/team-colors';
import { Sport } from '@/types/sports';

function jerseyToSport(j?: JerseySport): Sport {
  switch (j) {
    case 'basketball': return Sport.NBA;
    case 'baseball':   return Sport.MLB;
    case 'hockey':     return Sport.NHL;
    case 'soccer':     return Sport.MLS;
    default:           return Sport.NFL;
  }
}

function darken(hex: string, factor: number): string {
  // Guard against non-hex input (e.g. rgba strings, undefined)
  if (!hex || !hex.startsWith('#') || hex.replace('#', '').length < 6) return hex || '#000000';
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  if (isNaN(n)) return hex;
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * factor));
  const g = Math.max(0, Math.round(((n >> 8)  & 0xff) * factor));
  const b = Math.max(0, Math.round(( n         & 0xff) * factor));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export type JerseySport = 'basketball' | 'football' | 'baseball' | 'hockey' | 'soccer';

interface JerseyIconProps {
  teamCode: string;
  sport?: JerseySport;
  size?: number;
  /** Override primary color (e.g. from ESPN API) */
  primaryColor?: string;
  /** Override secondary color */
  secondaryColor?: string;
}

// Draw outlined text by rendering stroke layer then fill layer on top
function OutlinedLabel({
  x,
  y,
  label,
  fontSize,
  fill,
  stroke,
}: {
  x: string;
  y: string;
  label: string;
  fontSize: string;
  fill: string;
  stroke: string;
}) {
  return (
    <>
      {/* Stroke layer */}
      <SvgText
        x={x}
        y={y}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="900"
        letterSpacing={0.5}
        fill="none"
        stroke={stroke}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {label}
      </SvgText>
      {/* Fill layer */}
      <SvgText
        x={x}
        y={y}
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="900"
        letterSpacing={0.5}
        fill={fill}
      >
        {label}
      </SvgText>
    </>
  );
}

function sportFor(sport?: JerseySport): JerseySport {
  return sport ?? 'football';
}

// ─── Basketball (sleeveless tank) ─────────────────────────────────────────────
function BasketballSilhouette({
  gradId, secondary, text, stroke, label,
}: { gradId: string; secondary: string; text: string; stroke: string; label: string }) {
  const fs = label.length > 3 ? '9' : '11';
  return (
    <>
      {/* Shadow under jersey */}
      <Ellipse cx={40} cy={94} rx={18} ry={3} fill="black" fillOpacity={0.2} />

      {/* Main body — sleeveless tank */}
      <Path d="M28 8 L24 10 L19 18 L19 92 L61 92 L61 18 L56 10 L52 8 L48 14 Q40 18 32 14 Z" fill={`url(#${gradId})`} />

      {/* 3D fabric shading — left dark fold */}
      <Path d="M19 18 L19 92 L28 92 L28 24 Z" fill="black" fillOpacity={0.08} />
      {/* Right highlight */}
      <Path d="M52 24 L61 18 L61 92 L52 92 Z" fill="white" fillOpacity={0.04} />

      {/* Deep armhole cuts */}
      <Path d="M28 8 L24 10 L19 18 L19 42 L27 26 L32 14 Z" fill={secondary} fillOpacity={0.25} />
      <Path d="M52 8 L56 10 L61 18 L61 42 L53 26 L48 14 Z" fill={secondary} fillOpacity={0.25} />

      {/* Armhole edge seam stitch */}
      <Path d="M19 42 L27 26 L32 14" stroke={secondary} strokeWidth={0.8} strokeOpacity={0.3} fill="none" strokeDasharray="2,2" />
      <Path d="M61 42 L53 26 L48 14" stroke={secondary} strokeWidth={0.8} strokeOpacity={0.3} fill="none" strokeDasharray="2,2" />

      {/* V-neck collar — double stitched */}
      <Path d="M32 14 Q40 22 48 14" stroke={secondary} strokeWidth={2.5} fill="none" strokeOpacity={0.7} />
      <Path d="M33 15 Q40 21 47 15" stroke="white" strokeWidth={0.6} fill="none" strokeOpacity={0.15} />

      {/* Side panel stripes */}
      <Rect x={21} y={20} width={3.5} height={70} fill={secondary} fillOpacity={0.5} rx={1.5} />
      <Rect x={55.5} y={20} width={3.5} height={70} fill={secondary} fillOpacity={0.5} rx={1.5} />
      {/* Thin accent line inside stripe */}
      <Rect x={22.2} y={20} width={1} height={70} fill="white" fillOpacity={0.12} rx={0.5} />
      <Rect x={56.8} y={20} width={1} height={70} fill="white" fillOpacity={0.12} rx={0.5} />

      {/* Hem stitch at bottom */}
      <Line x1={19} y1={90} x2={61} y2={90} stroke={secondary} strokeWidth={0.8} strokeOpacity={0.2} strokeDasharray="3,2" />
      <Rect x={19} y={90} width={42} height={2} fill={secondary} fillOpacity={0.15} rx={0.5} />

      {/* Mesh texture — tiny dots across chest area */}
      {[0,1,2,3,4,5,6,7].map(r =>
        [0,1,2,3,4,5,6].map(c => (
          <Circle key={`m${r}${c}`} cx={26 + c * 4} cy={30 + r * 5} r={0.4} fill="white" fillOpacity={0.04} />
        ))
      )}

      {/* Center chest fold shadow */}
      <Line x1={40} y1={20} x2={40} y2={85} stroke="black" strokeWidth={0.5} strokeOpacity={0.06} />

      {/* Fabric highlight — top shoulder area */}
      <Path d="M30 14 Q40 10 50 14 L48 20 Q40 18 32 20 Z" fill="white" fillOpacity={0.06} />

      {/* Label */}
      <OutlinedLabel x="40" y="58" label={label} fontSize={fs} fill={text} stroke={stroke} />
    </>
  );
}

// ─── Football (padded shoulders + sleeves) ────────────────────────────────────
function FootballSilhouette({
  gradId, secondary, text, stroke, label,
}: { gradId: string; secondary: string; text: string; stroke: string; label: string }) {
  const fs = label.length > 3 ? '9' : '11';
  return (
    <>
      <Ellipse cx={40} cy={94} rx={22} ry={3} fill="black" fillOpacity={0.2} />

      {/* Main body with sleeves */}
      <Path d="M30 10 L22 14 L13 22 L6 30 L10 34 L17 28 L17 92 L63 92 L63 28 L70 34 L74 30 L67 22 L58 14 L50 10 L46 16 Q40 20 34 16 Z" fill={`url(#${gradId})`} />

      {/* 3D left side shading */}
      <Path d="M17 28 L17 92 L26 92 L26 34 Z" fill="black" fillOpacity={0.06} />
      {/* Right highlight */}
      <Path d="M54 34 L63 28 L63 92 L54 92 Z" fill="white" fillOpacity={0.03} />

      {/* Shoulder yoke — padded look */}
      <Path d="M30 10 L22 14 L13 22 L6 30 L10 34 L17 28 L17 38 L63 38 L63 28 L70 34 L74 30 L67 22 L58 14 L50 10 L46 16 Q40 20 34 16 Z" fill={secondary} fillOpacity={0.12} />

      {/* Yoke seam stitch */}
      <Path d="M17 38 L63 38" stroke={secondary} strokeWidth={0.8} strokeOpacity={0.25} strokeDasharray="3,2" />

      {/* V-neck collar — thick */}
      <Path d="M34 16 Q40 24 46 16" stroke={secondary} strokeWidth={2.5} fill="none" strokeOpacity={0.7} />
      <Path d="M35 17 Q40 23 45 17" stroke="white" strokeWidth={0.6} fill="none" strokeOpacity={0.12} />
      {/* Collar inner fill */}
      <Path d="M34 16 Q40 24 46 16 Q40 18 34 16 Z" fill="black" fillOpacity={0.15} />

      {/* Sleeve stripes — 3 lines each side */}
      <Line x1={8}  y1={26} x2={16} y2={22} stroke={secondary} strokeWidth={3.5} strokeLinecap="round" strokeOpacity={0.85} />
      <Line x1={9}  y1={30} x2={17} y2={26} stroke={secondary} strokeWidth={3.5} strokeLinecap="round" strokeOpacity={0.55} />
      <Line x1={10} y1={34} x2={17} y2={30} stroke="white"     strokeWidth={1}   strokeLinecap="round" strokeOpacity={0.1} />

      <Line x1={72} y1={26} x2={64} y2={22} stroke={secondary} strokeWidth={3.5} strokeLinecap="round" strokeOpacity={0.85} />
      <Line x1={71} y1={30} x2={63} y2={26} stroke={secondary} strokeWidth={3.5} strokeLinecap="round" strokeOpacity={0.55} />
      <Line x1={70} y1={34} x2={63} y2={30} stroke="white"     strokeWidth={1}   strokeLinecap="round" strokeOpacity={0.1} />

      {/* Sleeve seam */}
      <Path d="M17 28 L13 22" stroke="black" strokeWidth={0.5} strokeOpacity={0.1} strokeDasharray="2,2" />
      <Path d="M63 28 L67 22" stroke="black" strokeWidth={0.5} strokeOpacity={0.1} strokeDasharray="2,2" />

      {/* Mesh texture */}
      {[0,1,2,3,4,5].map(r =>
        [0,1,2,3,4,5,6].map(c => (
          <Circle key={`m${r}${c}`} cx={24 + c * 5} cy={42 + r * 6} r={0.4} fill="white" fillOpacity={0.035} />
        ))
      )}

      {/* Center fold */}
      <Line x1={40} y1={24} x2={40} y2={88} stroke="black" strokeWidth={0.5} strokeOpacity={0.05} />

      {/* Hem */}
      <Rect x={17} y={90} width={46} height={2} fill={secondary} fillOpacity={0.12} rx={0.5} />
      <Line x1={17} y1={90} x2={63} y2={90} stroke={secondary} strokeWidth={0.6} strokeOpacity={0.2} strokeDasharray="3,2" />

      {/* Shoulder pad volume highlight */}
      <Path d="M22 14 Q30 8 40 10 Q50 8 58 14 L46 16 Q40 20 34 16 Z" fill="white" fillOpacity={0.06} />

      <OutlinedLabel x="40" y="62" label={label} fontSize={fs} fill={text} stroke={stroke} />
    </>
  );
}

// ─── Baseball (button-up, raglan) ─────────────────────────────────────────────
function BaseballSilhouette({
  gradId, secondary, text, stroke, label,
}: { gradId: string; secondary: string; text: string; stroke: string; label: string }) {
  const fs = label.length > 3 ? '9' : '11';
  return (
    <>
      <Ellipse cx={40} cy={94} rx={20} ry={3} fill="black" fillOpacity={0.2} />

      {/* Main body — button-up with raglan sleeves */}
      <Path d="M32 10 L24 12 L15 20 L8 30 L5 38 L12 40 L15 32 L15 92 L65 92 L65 32 L68 40 L75 38 L72 30 L65 20 L56 12 L48 10 L44 15 Q40 18 36 15 Z" fill={`url(#${gradId})`} />

      {/* Left fold shading */}
      <Path d="M15 32 L15 92 L24 92 L24 36 Z" fill="black" fillOpacity={0.06} />
      <Path d="M56 36 L65 32 L65 92 L56 92 Z" fill="white" fillOpacity={0.03} />

      {/* Raglan seam — diagonal stitch lines */}
      <Line x1={33} y1={13} x2={15} y2={32} stroke={secondary} strokeWidth={1.2} strokeDasharray="3,3" strokeOpacity={0.35} />
      <Line x1={47} y1={13} x2={65} y2={32} stroke={secondary} strokeWidth={1.2} strokeDasharray="3,3" strokeOpacity={0.35} />

      {/* Raglan sleeve color panels */}
      <Path d="M32 10 L24 12 L15 20 L8 30 L5 38 L12 40 L15 32 L33 13 Z" fill={secondary} fillOpacity={0.3} />
      <Path d="M48 10 L56 12 L65 20 L72 30 L75 38 L68 40 L65 32 L47 13 Z" fill={secondary} fillOpacity={0.3} />

      {/* Collar — V-neck placket */}
      <Path d="M36 15 Q40 18 44 15 L48 10 Q40 7 32 10 L36 15 Z" fill={secondary} fillOpacity={0.5} />
      <Path d="M37 16 Q40 17.5 43 16" stroke="white" strokeWidth={0.5} fillOpacity={0.15} fill="none" />

      {/* Button placket line */}
      <Line x1={40} y1={18} x2={40} y2={88} stroke={secondary} strokeWidth={1} strokeOpacity={0.15} />
      {/* Buttons */}
      <Circle cx={40} cy={24} r={1.8} fill={secondary} fillOpacity={0.5} stroke={secondary} strokeWidth={0.4} strokeOpacity={0.3} />
      <Circle cx={40} cy={34} r={1.8} fill={secondary} fillOpacity={0.4} stroke={secondary} strokeWidth={0.4} strokeOpacity={0.25} />
      <Circle cx={40} cy={44} r={1.8} fill={secondary} fillOpacity={0.3} stroke={secondary} strokeWidth={0.4} strokeOpacity={0.2} />
      <Circle cx={40} cy={54} r={1.5} fill={secondary} fillOpacity={0.2} stroke={secondary} strokeWidth={0.3} strokeOpacity={0.15} />

      {/* Piping along placket */}
      <Line x1={38.5} y1={18} x2={38.5} y2={88} stroke={secondary} strokeWidth={0.4} strokeOpacity={0.12} />
      <Line x1={41.5} y1={18} x2={41.5} y2={88} stroke={secondary} strokeWidth={0.4} strokeOpacity={0.12} />

      {/* Hem */}
      <Rect x={15} y={90} width={50} height={2} fill={secondary} fillOpacity={0.1} rx={0.5} />
      <Line x1={15} y1={90} x2={65} y2={90} stroke={secondary} strokeWidth={0.6} strokeOpacity={0.18} strokeDasharray="3,2" />

      {/* Shoulder highlight */}
      <Path d="M32 10 Q40 6 48 10 L44 15 Q40 18 36 15 Z" fill="white" fillOpacity={0.06} />

      {/* Fabric weave texture */}
      {[0,1,2,3,4,5].map(r =>
        [0,1,2,3,4,5].map(c => (
          <Circle key={`m${r}${c}`} cx={22 + c * 6} cy={40 + r * 7} r={0.35} fill="white" fillOpacity={0.03} />
        ))
      )}

      <OutlinedLabel x="40" y="70" label={label} fontSize={fs} fill={text} stroke={stroke} />
    </>
  );
}

// ─── Hockey (baggy sweater, lace collar) ──────────────────────────────────────
function HockeySilhouette({
  gradId, secondary, text, stroke, label, accent,
}: { gradId: string; secondary: string; text: string; stroke: string; label: string; accent: string }) {
  const fs = label.length > 3 ? '9' : '11';
  return (
    <>
      <Ellipse cx={40} cy={96} rx={22} ry={3} fill="black" fillOpacity={0.2} />

      {/* Main body — baggy sweater with deep sleeves */}
      <Path d="M30 10 L22 13 L12 22 L3 34 L3 44 L10 44 L12 36 L12 94 L68 94 L68 36 L70 44 L77 44 L77 34 L68 22 L58 13 L50 10 L46 16 Q40 20 34 16 Z" fill={`url(#${gradId})`} />

      {/* Left fold shading */}
      <Path d="M12 36 L12 94 L22 94 L22 40 Z" fill="black" fillOpacity={0.07} />
      <Path d="M58 40 L68 36 L68 94 L58 94 Z" fill="white" fillOpacity={0.03} />

      {/* Shoulder/yoke panel */}
      <Path d="M30 10 L22 13 L12 22 L3 34 L3 44 L10 44 L12 36 L12 42 L68 42 L68 36 L70 44 L77 44 L77 34 L68 22 L58 13 L50 10 L46 16 Q40 20 34 16 Z" fill={secondary} fillOpacity={0.15} />
      {/* Yoke seam */}
      <Path d="M12 42 L68 42" stroke={secondary} strokeWidth={0.8} strokeOpacity={0.2} strokeDasharray="3,2" />

      {/* Sleeve stripes — thick band + accent + thick band */}
      <Line x1={4}  y1={35} x2={12} y2={27} stroke={secondary} strokeWidth={5.5} strokeLinecap="round" strokeOpacity={0.9} />
      <Line x1={5}  y1={39} x2={12} y2={32} stroke={accent}    strokeWidth={2}   strokeLinecap="round" strokeOpacity={0.45} />
      <Line x1={6}  y1={43} x2={12} y2={36} stroke={secondary} strokeWidth={3}   strokeLinecap="round" strokeOpacity={0.4} />

      <Line x1={76} y1={35} x2={68} y2={27} stroke={secondary} strokeWidth={5.5} strokeLinecap="round" strokeOpacity={0.9} />
      <Line x1={75} y1={39} x2={68} y2={32} stroke={accent}    strokeWidth={2}   strokeLinecap="round" strokeOpacity={0.45} />
      <Line x1={74} y1={43} x2={68} y2={36} stroke={secondary} strokeWidth={3}   strokeLinecap="round" strokeOpacity={0.4} />

      {/* Lace-up collar V */}
      <Path d="M34 16 Q40 22 46 16" fill="black" fillOpacity={0.12} />
      <Line x1={40} y1={22} x2={35} y2={13} stroke={accent} strokeWidth={1.5} strokeOpacity={0.65} />
      <Line x1={40} y1={22} x2={45} y2={13} stroke={accent} strokeWidth={1.5} strokeOpacity={0.65} />
      {/* Cross laces */}
      <Line x1={37} y1={15.5} x2={43} y2={15.5} stroke={accent} strokeWidth={1} strokeOpacity={0.5} />
      <Line x1={37.5} y1={18} x2={42.5} y2={18} stroke={accent} strokeWidth={0.8} strokeOpacity={0.4} />
      <Line x1={38.5} y1={20} x2={41.5} y2={20} stroke={accent} strokeWidth={0.6} strokeOpacity={0.3} />

      {/* Bottom stripe band */}
      <Rect x={12} y={86} width={56} height={5} fill={secondary} fillOpacity={0.8} rx={1} />
      <Rect x={12} y={88} width={56} height={1.5} fill={accent} fillOpacity={0.25} rx={0.5} />

      {/* Hem stitch */}
      <Line x1={12} y1={92} x2={68} y2={92} stroke={secondary} strokeWidth={0.6} strokeOpacity={0.15} strokeDasharray="3,2" />

      {/* Center fold */}
      <Line x1={40} y1={22} x2={40} y2={86} stroke="black" strokeWidth={0.5} strokeOpacity={0.05} />

      {/* Shoulder highlight */}
      <Path d="M22 13 Q40 6 58 13 L46 16 Q40 20 34 16 Z" fill="white" fillOpacity={0.05} />

      {/* Fabric texture */}
      {[0,1,2,3,4,5].map(r =>
        [0,1,2,3,4,5,6].map(c => (
          <Circle key={`m${r}${c}`} cx={18 + c * 6} cy={46 + r * 6} r={0.4} fill="white" fillOpacity={0.03} />
        ))
      )}

      <OutlinedLabel x="40" y="64" label={label} fontSize={fs} fill={text} stroke={stroke} />
    </>
  );
}

// ─── Soccer (tight kit, crew collar) ──────────────────────────────────────────
function SoccerSilhouette({
  gradId, secondary, text, stroke, label,
}: { gradId: string; secondary: string; text: string; stroke: string; label: string }) {
  const fs = label.length > 3 ? '9' : '11';
  return (
    <>
      <Ellipse cx={40} cy={94} rx={18} ry={3} fill="black" fillOpacity={0.2} />

      {/* Main body — fitted kit with short sleeves */}
      <Path d="M30 10 L23 13 L16 20 L10 28 L13 32 L18 26 L16 92 L64 92 L62 26 L67 32 L70 28 L64 20 L57 13 L50 10 L46 16 Q40 19 34 16 Z" fill={`url(#${gradId})`} />

      {/* Left shading */}
      <Path d="M16 26 L16 92 L24 92 L24 30 Z" fill="black" fillOpacity={0.06} />
      <Path d="M56 30 L64 26 L64 92 L56 92 Z" fill="white" fillOpacity={0.03} />

      {/* Sleeve panels — contrast color */}
      <Path d="M30 10 L23 13 L16 20 L10 28 L13 32 L18 26 L18 20 L30 14 Z" fill={secondary} fillOpacity={0.35} />
      <Path d="M50 10 L57 13 L64 20 L70 28 L67 32 L62 26 L62 20 L50 14 Z" fill={secondary} fillOpacity={0.35} />

      {/* Sleeve seam stitching */}
      <Path d="M18 20 L30 14" stroke={secondary} strokeWidth={0.6} strokeOpacity={0.25} strokeDasharray="2,2" fill="none" />
      <Path d="M62 20 L50 14" stroke={secondary} strokeWidth={0.6} strokeOpacity={0.25} strokeDasharray="2,2" fill="none" />

      {/* Crew collar — oval ribbed */}
      <Ellipse cx={40} cy={12} rx={8.5} ry={4.5} fill={secondary} fillOpacity={0.5} />
      <Ellipse cx={40} cy={12} rx={6} ry={3} fill={`url(#${gradId})`} />
      {/* Collar rib stitch lines */}
      <Ellipse cx={40} cy={12} rx={7.5} ry={3.8} stroke={secondary} strokeWidth={0.5} strokeOpacity={0.2} fill="none" />
      <Ellipse cx={40} cy={12} rx={5} ry={2.5} stroke="white" strokeWidth={0.3} strokeOpacity={0.08} fill="none" />

      {/* Side panel stripes */}
      <Rect x={17} y={26} width={3.5} height={64} fill={secondary} fillOpacity={0.18} rx={1} />
      <Rect x={59.5} y={26} width={3.5} height={64} fill={secondary} fillOpacity={0.18} rx={1} />
      {/* Accent line inside stripe */}
      <Rect x={18.2} y={26} width={1} height={64} fill="white" fillOpacity={0.06} rx={0.5} />
      <Rect x={60.8} y={26} width={1} height={64} fill="white" fillOpacity={0.06} rx={0.5} />

      {/* Hem */}
      <Rect x={16} y={90} width={48} height={2} fill={secondary} fillOpacity={0.12} rx={0.5} />
      <Line x1={16} y1={90} x2={64} y2={90} stroke={secondary} strokeWidth={0.6} strokeOpacity={0.18} strokeDasharray="3,2" />

      {/* Crest/badge placeholder — small shield shape */}
      <Path d="M28 28 L28 36 Q30 40 32 36 L32 28 Z" fill={secondary} fillOpacity={0.15} stroke={secondary} strokeWidth={0.5} strokeOpacity={0.2} />

      {/* Center fold */}
      <Line x1={40} y1={16} x2={40} y2={88} stroke="black" strokeWidth={0.4} strokeOpacity={0.05} />

      {/* Shoulder highlight */}
      <Path d="M30 10 Q40 6 50 10 L46 16 Q40 19 34 16 Z" fill="white" fillOpacity={0.06} />

      {/* Mesh fabric dots */}
      {[0,1,2,3,4,5].map(r =>
        [0,1,2,3,4,5,6].map(c => (
          <Circle key={`m${r}${c}`} cx={22 + c * 5} cy={34 + r * 7} r={0.35} fill="white" fillOpacity={0.035} />
        ))
      )}

      <OutlinedLabel x="40" y="60" label={label} fontSize={fs} fill={text} stroke={stroke} />
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export const JerseyIcon = memo(function JerseyIcon({
  teamCode,
  sport,
  size = 52,
  primaryColor,
  secondaryColor,
}: JerseyIconProps) {
  const instanceId = useRef(++_jerseyIdCounter).current;
  const needsLookup = !primaryColor || !secondaryColor;
  const colors = needsLookup ? getTeamColors(teamCode, jerseyToSport(sport)) : null;

  const primary     = primaryColor   ?? colors?.primary ?? '#5A7A8A';
  const primaryDark = darken(primary, 0.6);
  const secondary   = secondaryColor ?? colors?.secondary ?? '#FFFFFF';
  const text        = '#FFFFFF';
  const stroke      = darken(primary, 0.25);
  const label       = teamCode.slice(0, 4).toUpperCase();

  const gradId    = `grad_${teamCode}_${instanceId}`;
  const sportType = sportFor(sport);
  const height    = size * 1.25;

  const props = { gradId, secondary, text, stroke, label, accent: '#FFFFFF' };

  return (
    <Svg width={size} height={height} viewBox="0 0 80 100" fill="none">
      <Defs>
        <SvgLinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={primary}     stopOpacity={1} />
          <Stop offset="1" stopColor={primaryDark} stopOpacity={1} />
        </SvgLinearGradient>
      </Defs>

      {sportType === 'basketball' && <BasketballSilhouette {...props} />}
      {sportType === 'football'   && <FootballSilhouette   {...props} />}
      {sportType === 'baseball'   && <BaseballSilhouette   {...props} />}
      {sportType === 'hockey'     && <HockeySilhouette     {...props} />}
      {sportType === 'soccer'     && <SoccerSilhouette     {...props} />}
    </Svg>
  );
});

// ─── Sport enum → JerseySport helper ─────────────────────────────────────────
export function sportEnumToJersey(sport: string | undefined): JerseySport {
  switch (sport) {
    case 'basketball': case 'NBA': case 'NCAAB': return 'basketball';
    case 'football':   case 'NFL': case 'NCAAF': return 'football';
    case 'baseball':   case 'MLB':               return 'baseball';
    case 'hockey':     case 'NHL':               return 'hockey';
    case 'soccer':     case 'MLS': case 'EPL': case 'UCL':   return 'soccer';
    default:                                      return 'football';
  }
}

export default JerseyIcon;
