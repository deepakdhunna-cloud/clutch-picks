import React, { useRef } from 'react';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgLinearGradient,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';

export type JerseyModelVariant = 'basketball' | 'college-basketball' | 'football' | 'baseball' | 'hockey' | 'soccer' | 'ucl' | 'cricket' | 'tennis';

interface MiniJerseyModelProps {
  variant: JerseyModelVariant;
  primary: string;
  secondary: string;
  accent?: string;
  abbr: string;
  teamName?: string;
  size?: number;
}

interface ModelShape {
  body: string;
  weave: 'mesh' | 'heavy-mesh' | 'knit' | 'pinstripe' | 'sheen' | 'speckle';
  labelX: number;
  labelY: number;
}

let jerseyModelId = 0;

function parseHex(hex: string | undefined): { r: number; g: number; b: number } | null {
  if (!hex || !hex.startsWith('#')) return null;
  const raw = hex.replace('#', '');
  const expanded = raw.length === 3 ? raw.split('').map((c) => `${c}${c}`).join('') : raw.slice(0, 6);
  if (expanded.length < 6) return null;
  const n = parseInt(expanded, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return `#${((Math.max(0, Math.min(255, Math.round(r))) << 16)
    | (Math.max(0, Math.min(255, Math.round(g))) << 8)
    | Math.max(0, Math.min(255, Math.round(b))))
    .toString(16)
    .padStart(6, '0')}`;
}

export function mixColor(hex: string, target: string, amount: number): string {
  const a = parseHex(hex);
  const b = parseHex(target);
  if (!a || !b) return hex || target;
  const t = Math.max(0, Math.min(1, amount));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function darken(hex: string, amount = 0.28): string {
  return mixColor(hex, '#000000', amount);
}

export function lighten(hex: string, amount = 0.22): string {
  return mixColor(hex, '#ffffff', amount);
}

function luminance(hex: string): number {
  const c = parseHex(hex);
  if (!c) return 0;
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableDetail(primary: string, secondary: string, accent: string): string {
  const candidates = [
    secondary,
    accent,
    lighten(secondary, 0.26),
    darken(secondary, 0.22),
    '#FFFFFF',
    '#101820',
  ];
  const unique = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
  const best = unique.reduce((current, candidate) => (
    contrastRatio(candidate, primary) > contrastRatio(current, primary) ? candidate : current
  ), unique[0]);

  if (contrastRatio(best, primary) < 2.65) {
    return luminance(primary) > 0.56 ? '#101820' : '#FFFFFF';
  }

  return best;
}

function readableOutline(fill: string): string {
  return luminance(fill) > 0.55 ? '#05070A' : '#FFFFFF';
}

function safeLabel(abbr: string, max = 4): string {
  return (abbr || '').replace(/[^a-z0-9]/gi, '').slice(0, max).toUpperCase() || 'CP';
}

function compactMark(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function sameMark(a: string, b: string): boolean {
  return compactMark(a) === compactMark(b);
}

function wordmarkFitConfig(variant: JerseyModelVariant): { maxWidth: number; minFontSize: number } {
  switch (variant) {
    case 'basketball':
    case 'college-basketball':
      return { maxWidth: 48, minFontSize: 7.6 };
    case 'football':
      return { maxWidth: 48, minFontSize: 7.2 };
    case 'baseball':
      return { maxWidth: 54, minFontSize: 7.2 };
    case 'hockey':
      return { maxWidth: 50, minFontSize: 7 };
    case 'soccer':
    case 'ucl':
      return { maxWidth: 44, minFontSize: 6.6 };
    case 'tennis':
      return { maxWidth: 50, minFontSize: 7.2 };
    case 'cricket':
      return { maxWidth: 44, minFontSize: 6.8 };
    default:
      return { maxWidth: 46, minFontSize: 6.8 };
  }
}

function jerseyWordmarkFontSize(label: string, variant: JerseyModelVariant): number {
  const length = label.replace(/\s/g, '').length;
  if (variant === 'basketball' || variant === 'college-basketball') {
    return length >= 12 ? 8.8 : length >= 10 ? 9.4 : length >= 8 ? 10.2 : 11.2;
  }

  return wordmarkFontSize(label, variant);
}

function wordmarkStrokeReserve(fontSize: number): number {
  return Math.max(1.4, fontSize * 0.16);
}

function wordmarkInnerWidth(maxWidth: number, fontSize: number): number {
  return Math.max(12, maxWidth - wordmarkStrokeReserve(fontSize));
}

function fitsReadableWordmark(label: string, variant: JerseyModelVariant): boolean {
  const config = wordmarkFitConfig(variant);
  const fontSize = jerseyWordmarkFontSize(label, variant);
  const innerWidth = wordmarkInnerWidth(config.maxWidth, fontSize);
  const layout = fittedLabelLayout(label, fontSize, innerWidth, config.minFontSize);

  return layout.visualWidth <= innerWidth + 0.5 && layout.fontSize >= config.minFontSize;
}

function wordmarkAlias(label: string): string | null {
  const compact = compactMark(label);
  const aliases: Record<string, string> = {
    ATHLETICS: "A'S",
    BUCCANEERS: 'BUCS',
    COMMANDERS: 'WASH',
    DIAMONDBACKS: 'D-BACKS',
    GUARDIANS: 'GUARDS',
    TRAILBLAZERS: 'BLAZERS',
    TIMBERWOLVES: 'WOLVES',
  };

  return aliases[compact] ?? null;
}

function firstReadableWordmark(candidates: string[], fallback: string, variant: JerseyModelVariant): string {
  const normalized = candidates
    .map((candidate) => candidate.trim().replace(/\s+/g, ' ').toUpperCase())
    .filter(Boolean);
  const withAliases = normalized.flatMap((candidate) => {
    const alias = wordmarkAlias(candidate);
    return alias ? [candidate, alias] : [candidate];
  });
  const unique = withAliases.filter((candidate, index) => withAliases.indexOf(candidate) === index);

  return unique.find((candidate) => fitsReadableWordmark(candidate, variant)) ?? fallback;
}

function cleanTeamWords(teamName: string | undefined): string[] {
  if (!teamName) return [];
  return teamName
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function teamWordmark(teamName: string | undefined, abbr: string, variant: JerseyModelVariant): string {
  const fallback = safeLabel(abbr);
  const words = cleanTeamWords(teamName);
  if (words.length === 0) return fallback;

  const full = words.join(' ').toUpperCase();
  const last = words[words.length - 1].toUpperCase();
  const lastTwo = words.slice(-2).join(' ').toUpperCase();

  if (variant === 'cricket') {
    return firstReadableWordmark([
      words.length >= 2 ? lastTwo : '',
      last,
      full,
    ], fallback, variant);
  }

  if (variant === 'tennis') {
    return firstReadableWordmark([
      last.length >= 3 ? last : '',
      full,
    ], fallback, variant);
  }

  if (variant === 'soccer' || variant === 'ucl') {
    return firstReadableWordmark([
      full,
      words.length >= 2 ? lastTwo : '',
      last.length >= 3 ? last : '',
    ], fallback, variant);
  }

  return firstReadableWordmark([
    words.length >= 2 && last.length <= 4 ? lastTwo : '',
    words.length >= 2 && ['JAYS', 'SOX'].includes(last) ? lastTwo : '',
    last.length >= 3 ? last : '',
    full,
  ], fallback, variant);
}

function estimatedTextWidth(label: string, fontSize: number): number {
  const widthUnits = label.split('').reduce((sum, char) => {
    if (/\s/.test(char)) return sum + 0.34;
    if (/[MW]/.test(char)) return sum + 0.86;
    if (/[I1JL]/.test(char)) return sum + 0.38;
    if (/[0-9]/.test(char)) return sum + 0.58;
    if (/[-.]/.test(char)) return sum + 0.3;
    return sum + 0.66;
  }, 0);

  return Math.max(1, widthUnits) * fontSize;
}

interface FittedLabelLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  visualWidth: number;
}

function splitLabelCandidates(label: string): string[][] {
  const normalized = label.trim().replace(/\s+/g, ' ').toUpperCase();
  if (!normalized) return [['CP']];
  const words = normalized.split(' ');
  if (words.length === 1) return [[normalized]];

  const candidates: string[][] = [[normalized]];
  for (let split = 1; split < words.length; split += 1) {
    candidates.push([
      words.slice(0, split).join(' '),
      words.slice(split).join(' '),
    ]);
  }

  return candidates;
}

function fittedLabelLayout(label: string, fontSize: number, maxWidth?: number, minFontSize = 6.8): FittedLabelLayout {
  const targetWidth = maxWidth ?? Number.POSITIVE_INFINITY;
  const candidates = splitLabelCandidates(label);

  return candidates.reduce<FittedLabelLayout>((best, lines) => {
    const widestAtBase = Math.max(...lines.map((line) => estimatedTextWidth(line, fontSize)));
    const fitSize = Number.isFinite(targetWidth)
      ? Math.max(minFontSize, Math.min(fontSize, fontSize * (targetWidth / Math.max(1, widestAtBase))))
      : fontSize;
    const visualWidth = Math.max(...lines.map((line) => estimatedTextWidth(line, fitSize)));
    const layout = {
      lines,
      fontSize: fitSize,
      lineHeight: fitSize * (lines.length > 1 ? 0.94 : 1),
      visualWidth,
    };

    if (best.lines.length === 0) return layout;
    if (layout.visualWidth > targetWidth + 0.5 && best.visualWidth <= targetWidth + 0.5) return best;
    if (layout.fontSize > best.fontSize + 0.15) return layout;
    if (Math.abs(layout.fontSize - best.fontSize) <= 0.15 && layout.lines.length < best.lines.length) return layout;
    return best;
  }, { lines: [], fontSize: minFontSize, lineHeight: minFontSize, visualWidth: Number.POSITIVE_INFINITY });
}

function jerseyNumber(abbr: string): string {
  const source = compactMark(abbr) || 'CP';
  const total = source.split('').reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 3), 0);
  return String((total % 98) + 1).padStart(2, '0');
}

function modelShape(variant: JerseyModelVariant): ModelShape {
  switch (variant) {
    case 'basketball':
      return {
        body: 'M15 18 L33 8 L43 8 L50 29 L57 8 L67 8 L85 18 L77 110 C64 116 36 116 23 110 Z',
        weave: 'mesh',
        labelX: 50,
        labelY: 57,
      };
    case 'college-basketball':
      return {
        body: 'M15 18 L33 8 L43 8 L50 29 L57 8 L67 8 L85 18 L77 110 C64 116 36 116 23 110 Z',
        weave: 'mesh',
        labelX: 50,
        labelY: 57,
      };
    case 'football':
      return {
        body: 'M32 12 L18 17 L7 30 L2 45 L4 56 L17 58 L23 41 L23 109 C35 116 65 116 77 109 L77 41 L83 58 L96 56 L98 45 L93 30 L82 17 L68 12 L62 24 C55 30 45 30 38 24 Z',
        weave: 'heavy-mesh',
        labelX: 50,
        labelY: 68,
      };
    case 'baseball':
      return {
        body: 'M36 11 L26 14 L15 28 L7 45 L5 53 L16 56 L21 42 L21 107 C30 116 70 116 79 107 L79 42 L84 56 L95 53 L93 45 L85 28 L74 14 L64 11 L58 20 C53 25 47 25 42 20 Z',
        weave: 'pinstripe',
        labelX: 50,
        labelY: 51,
      };
    case 'hockey':
      return {
        body: 'M31 12 L17 16 L6 31 L0 48 L2 72 L15 73 L18 49 L18 111 C31 118 69 118 82 111 L82 49 L85 73 L98 72 L100 48 L94 31 L83 16 L69 12 L62 23 C55 29 45 29 38 23 Z',
        weave: 'knit',
        labelX: 50,
        labelY: 70,
      };
    case 'ucl':
      return {
        body: 'M36 10 L27 14 L16 27 L8 39 L15 46 L25 37 L23 108 C35 115 65 115 77 108 L75 37 L85 46 L92 39 L84 27 L73 14 L64 10 L59 20 C54 25 46 25 41 20 Z',
        weave: 'sheen',
        labelX: 62,
        labelY: 47,
      };
    case 'cricket':
      return {
        body: 'M35 10 L27 14 L15 26 L7 42 L14 49 L24 39 L23 109 C35 116 65 116 77 109 L76 39 L86 49 L93 42 L85 26 L73 14 L65 10 L58 21 C53 27 47 27 42 21 Z',
        weave: 'sheen',
        labelX: 58,
        labelY: 54,
      };
    case 'tennis':
      return {
        body: 'M35 10 L27 14 L16 25 L8 41 L15 48 L24 39 L24 108 C36 115 64 115 76 108 L76 39 L85 48 L92 41 L84 25 L73 14 L65 10 L58 22 C53 28 47 28 42 22 Z',
        weave: 'sheen',
        labelX: 55,
        labelY: 54,
      };
    case 'soccer':
    default:
      return {
        body: 'M36 10 L27 14 L16 27 L8 39 L15 46 L25 37 L23 108 C35 115 65 115 77 108 L75 37 L85 46 L92 39 L84 27 L73 14 L64 10 L59 20 C54 25 46 25 41 20 Z',
        weave: 'speckle',
        labelX: 62,
        labelY: 47,
      };
  }
}

function jerseyFontSize(label: string, variant: JerseyModelVariant): number {
  if (variant === 'baseball') return label.length >= 4 ? 9.6 : label.length === 3 ? 11.2 : 12.2;
  if (variant === 'football') return label.length >= 4 ? 10.4 : label.length === 3 ? 12.6 : 14.5;
  if (variant === 'hockey') return label.length >= 4 ? 9.8 : label.length === 3 ? 11.4 : 13;
  if (variant === 'cricket' || variant === 'tennis') return label.length >= 4 ? 8.8 : label.length === 3 ? 10.2 : 11.6;
  if (variant === 'soccer' || variant === 'ucl') return label.length >= 4 ? 7.4 : label.length === 3 ? 8.4 : 9.6;
  return label.length >= 4 ? 9.2 : label.length === 3 ? 10.8 : 12.8;
}

function wordmarkFontSize(label: string, variant: JerseyModelVariant): number {
  const length = label.replace(/\s/g, '').length;
  if (variant === 'baseball') return length >= 11 ? 8.8 : length >= 9 ? 9.4 : length >= 7 ? 10.2 : 11.2;
  if (variant === 'football') return length >= 11 ? 8.6 : length >= 9 ? 9.2 : length >= 7 ? 10 : 11.3;
  if (variant === 'hockey') return length >= 11 ? 8.4 : length >= 9 ? 9.1 : length >= 7 ? 9.8 : 10.8;
  if (variant === 'tennis') return length >= 10 ? 8.6 : length >= 8 ? 9.2 : length >= 5 ? 10.2 : 11.2;
  if (variant === 'cricket') return length >= 8 ? 8.8 : length >= 5 ? 9.8 : 11;
  if (variant === 'soccer' || variant === 'ucl') return length >= 8 ? 7.8 : length >= 5 ? 8.6 : 9.6;
  return length >= 11 ? 8.4 : length >= 9 ? 9.1 : length >= 7 ? 9.8 : 10.8;
}

function TextureLayer({
  weave,
  id,
  primary,
  accent,
}: {
  weave: ModelShape['weave'];
  id: number;
  primary: string;
  accent: string;
}) {
  if (weave === 'pinstripe') {
    return (
      <>
        {[25, 31, 37, 43, 57, 63, 69, 75].map((x, index) => (
          <Line key={`pin_${id}_${index}`} x1={x} y1={18} x2={x} y2={110} stroke={accent} strokeWidth={0.62} strokeOpacity={0.18} />
        ))}
        {[28, 46, 54, 72].map((x, index) => (
          <Line key={`pin_shadow_${id}_${index}`} x1={x} y1={18} x2={x} y2={111} stroke="#000000" strokeWidth={0.38} strokeOpacity={0.09} />
        ))}
      </>
    );
  }

  if (weave === 'knit') {
    return (
      <>
        {Array.from({ length: 10 }).map((_, row) => (
          <Path
            key={`knit_wave_${id}_${row}`}
            d={`M14 ${35 + row * 7.4} C27 ${31 + row * 7.4} 37 ${40 + row * 7.4} 50 ${35 + row * 7.4} C63 ${31 + row * 7.4} 73 ${40 + row * 7.4} 86 ${35 + row * 7.4}`}
            stroke={accent}
            strokeWidth={0.5}
            strokeOpacity={0.07}
            fill="none"
          />
        ))}
        {Array.from({ length: 9 }).map((_, row) =>
          Array.from({ length: 10 }).map((__, col) => (
            <Circle
              key={`knit_dot_${id}_${row}_${col}`}
              cx={18 + col * 7 + (row % 2 ? 2.4 : 0)}
              cy={33 + row * 7.8}
              r={0.44}
              fill={lighten(primary, 0.6)}
              fillOpacity={0.07}
            />
          )),
        )}
      </>
    );
  }

  if (weave === 'mesh' || weave === 'heavy-mesh') {
    const heavy = weave === 'heavy-mesh';
    return (
      <>
        {Array.from({ length: heavy ? 9 : 11 }).map((_, row) =>
          Array.from({ length: heavy ? 9 : 10 }).map((__, col) => (
            <G key={`mesh_${id}_${row}_${col}`}>
              <Circle
                cx={(heavy ? 20 : 22) + col * (heavy ? 7 : 6) + (row % 2 ? 2 : 0)}
                cy={(heavy ? 34 : 30) + row * (heavy ? 7.2 : 6.5)}
                r={heavy ? 0.62 : 0.45}
                fill="#000000"
                fillOpacity={heavy ? 0.11 : 0.08}
              />
              <Circle
                cx={(heavy ? 19.8 : 21.8) + col * (heavy ? 7 : 6) + (row % 2 ? 2 : 0)}
                cy={(heavy ? 33.8 : 29.8) + row * (heavy ? 7.2 : 6.5)}
                r={heavy ? 0.22 : 0.16}
                fill={accent}
                fillOpacity={0.13}
              />
            </G>
          )),
        )}
      </>
    );
  }

  if (weave === 'speckle') {
    return (
      <>
        {Array.from({ length: 42 }).map((_, index) => {
          const x = 16 + ((index * 19) % 68);
          const y = 27 + ((index * 29) % 76);
          const len = 2 + (index % 5) * 0.9;
          const tilt = index % 2 === 0 ? 2.1 : -1.8;
          return (
            <Path
              key={`speckle_${id}_${index}`}
              d={`M${x} ${y} L${x + tilt} ${y + len}`}
              stroke={lighten(primary, 0.72)}
              strokeWidth={0.45 + (index % 3) * 0.08}
              strokeOpacity={0.16}
              strokeLinecap="round"
            />
          );
        })}
      </>
    );
  }

  return (
    <>
      {[28, 36, 44, 52, 60, 68].map((x, index) => (
        <Path
          key={`sheen_${id}_${index}`}
          d={`M${x} 18 C${x - 4} 43 ${x + 4} 75 ${x - 1} 108`}
          stroke={index % 2 ? '#000000' : accent}
          strokeWidth={0.42}
          strokeOpacity={index % 2 ? 0.08 : 0.1}
          fill="none"
        />
      ))}
    </>
  );
}

function ModelDefs({
  ids,
  body,
  primary,
  secondary,
  accent,
}: {
  ids: Record<string, string>;
  body: string;
  primary: string;
  secondary: string;
  accent: string;
}) {
  return (
    <Defs>
      <ClipPath id={ids.clip}>
        <Path d={body} />
      </ClipPath>
      <SvgLinearGradient id={ids.body} x1="0.08" y1="0" x2="0.92" y2="1">
        <Stop offset="0" stopColor={lighten(primary, 0.32)} stopOpacity={1} />
        <Stop offset="0.2" stopColor={lighten(primary, 0.12)} stopOpacity={1} />
        <Stop offset="0.43" stopColor={primary} stopOpacity={1} />
        <Stop offset="0.76" stopColor={darken(primary, 0.18)} stopOpacity={1} />
        <Stop offset="1" stopColor={darken(primary, 0.38)} stopOpacity={1} />
      </SvgLinearGradient>
      <SvgLinearGradient id={ids.trim} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={lighten(secondary, 0.32)} stopOpacity={1} />
        <Stop offset="0.5" stopColor={secondary} stopOpacity={1} />
        <Stop offset="1" stopColor={darken(secondary, 0.24)} stopOpacity={1} />
      </SvgLinearGradient>
      <SvgLinearGradient id={ids.edge} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor="#000000" stopOpacity={0.18} />
        <Stop offset="0.2" stopColor="#000000" stopOpacity={0.035} />
        <Stop offset="0.44" stopColor="#ffffff" stopOpacity={0.11} />
        <Stop offset="0.64" stopColor="#ffffff" stopOpacity={0.035} />
        <Stop offset="0.84" stopColor="#000000" stopOpacity={0.04} />
        <Stop offset="1" stopColor="#000000" stopOpacity={0.2} />
      </SvgLinearGradient>
      <RadialGradient id={ids.volume} cx="48%" cy="25%" r="78%">
        <Stop offset="0" stopColor="#ffffff" stopOpacity={0.18} />
        <Stop offset="0.34" stopColor="#ffffff" stopOpacity={0.06} />
        <Stop offset="0.72" stopColor="#000000" stopOpacity={0.035} />
        <Stop offset="1" stopColor="#000000" stopOpacity={0.16} />
      </RadialGradient>
      <SvgLinearGradient id={ids.rim} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#ffffff" stopOpacity={0.22} />
        <Stop offset="0.38" stopColor="#ffffff" stopOpacity={0.06} />
        <Stop offset="1" stopColor="#000000" stopOpacity={0.14} />
      </SvgLinearGradient>
      <SvgLinearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor={accent} stopOpacity={0} />
        <Stop offset="0.33" stopColor={accent} stopOpacity={0.1} />
        <Stop offset="0.5" stopColor={accent} stopOpacity={0.025} />
        <Stop offset="0.68" stopColor={accent} stopOpacity={0.08} />
        <Stop offset="1" stopColor={accent} stopOpacity={0} />
      </SvgLinearGradient>
    </Defs>
  );
}

function ClothFoldLayer({ variant, id }: { variant: JerseyModelVariant; id: number }) {
  const isSleeveless = variant === 'basketball' || variant === 'college-basketball';
  const top = isSleeveless ? 36 : 28;
  const bottom = isSleeveless ? 105 : 110;
  const foldXs = isSleeveless ? [34, 42, 58, 66] : [28, 37, 50, 63, 72];

  return (
    <>
      {foldXs.map((x, index) => (
        <Path
          key={`cloth_fold_${id}_${index}`}
          d={`M${x} ${top} C${x - 2.4} ${top + 18} ${x + 2.2} ${bottom - 24} ${x - 0.8} ${bottom}`}
          stroke={index % 2 ? '#000000' : '#ffffff'}
          strokeWidth={0.55}
          strokeOpacity={index % 2 ? 0.08 : 0.09}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {[0, 1, 2].map((row) => (
        <Path
          key={`cloth_sag_${id}_${row}`}
          d={`M25 ${88 + row * 7} C38 ${92 + row * 4} 62 ${92 + row * 4} 75 ${88 + row * 7}`}
          stroke={row % 2 ? '#ffffff' : '#000000'}
          strokeWidth={0.42}
          strokeOpacity={row % 2 ? 0.08 : 0.07}
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

function PanelVolume({ variant }: { variant: JerseyModelVariant }) {
  if (variant === 'basketball' || variant === 'college-basketball') {
    return (
      <>
        <Path d="M24 23 C29 49 29 82 25 110" stroke="#000000" strokeWidth={0.72} strokeOpacity={0.08} fill="none" strokeLinecap="round" />
        <Path d="M76 23 C71 49 71 82 75 110" stroke="#ffffff" strokeWidth={0.62} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
        <Path d="M39 14 C45 43 45 82 41 112" stroke="#ffffff" strokeWidth={0.48} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
        <Path d="M61 14 C55 43 55 82 59 112" stroke="#000000" strokeWidth={0.48} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
        <Path d="M28 101 C40 106 60 106 72 101 L75 111 C61 116 39 116 25 111 Z" fill="#000000" fillOpacity={0.045} />
      </>
    );
  }

  const centerFold = variant === 'baseball'
    ? 'M50 23 C48 48 48 80 50 110'
    : 'M50 22 C47 50 47 80 50 111';

  return (
    <>
      <Path d="M21 15 C34 42 33 83 25 113 L7 116 L7 2 Z" fill="#000000" fillOpacity={0.075} />
      <Path d="M79 15 C66 42 67 83 75 113 L93 116 L93 2 Z" fill="#000000" fillOpacity={0.07} />
      <Path d="M39 13 C47 36 46 82 39 113 L53 116 C61 81 60 36 55 13 Z" fill="#ffffff" fillOpacity={0.055} />
      <Path d="M31 18 C38 42 36 78 30 110" stroke="#000000" strokeWidth={0.64} strokeOpacity={0.075} fill="none" strokeLinecap="round" />
      <Path d="M69 18 C62 42 64 78 70 110" stroke="#ffffff" strokeWidth={0.56} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
      <Path d={centerFold} stroke="#000000" strokeWidth={0.45} strokeOpacity={0.085} fill="none" strokeLinecap="round" />
      <Path d="M53 23 C57 51 56 80 52 111" stroke="#ffffff" strokeWidth={0.42} strokeOpacity={0.075} fill="none" strokeLinecap="round" />
      <Path d="M23 98 C38 106 62 106 77 98 L79 113 C63 119 37 119 21 113 Z" fill="#000000" fillOpacity={0.055} />
    </>
  );
}

function SportConstruction({
  variant,
  ids,
  secondary,
  accent,
}: {
  variant: JerseyModelVariant;
  ids: Record<string, string>;
  secondary: string;
  accent: string;
}) {
  if (variant === 'basketball' || variant === 'college-basketball') {
    const college = variant === 'college-basketball';
    return (
      <>
        <Path d="M35 9 L50 29 L65 9" stroke={`url(#${ids.trim})`} strokeWidth={5.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M40 11 L50 24 L60 11" stroke="#05070a" strokeWidth={2.15} strokeOpacity={0.34} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M16 19 C25 33 29 45 28 62 L20 64 C20 47 18 33 10 23 Z" fill="#02050A" fillOpacity={0.28} />
        <Path d="M84 19 C75 33 71 45 72 62 L80 64 C80 47 82 33 90 23 Z" fill="#02050A" fillOpacity={0.28} />
        <Path d="M16 19 C25 33 29 45 28 62" stroke={`url(#${ids.trim})`} strokeWidth={4.9} fill="none" strokeLinecap="round" />
        <Path d="M84 19 C75 33 71 45 72 62" stroke={`url(#${ids.trim})`} strokeWidth={4.9} fill="none" strokeLinecap="round" />
        <Path d="M20 23 C27 35 31 47 31 63" stroke="#030407" strokeWidth={1.15} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
        <Path d="M80 23 C73 35 69 47 69 63" stroke="#030407" strokeWidth={1.15} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
        <Path d="M24 103 C39 108 61 108 76 103" stroke={`url(#${ids.trim})`} strokeWidth={1.65} strokeOpacity={0.44} fill="none" strokeLinecap="round" />
        <Path d="M25 109 C39 114 61 114 75 109" stroke={secondary} strokeWidth={0.95} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
      </>
    );
  }

  if (variant === 'football') {
    return (
      <>
        <Path d="M10 35 C24 25 37 27 50 30 C63 27 76 25 90 35 L83 48 C62 53 38 53 17 48 Z" fill={`url(#${ids.trim})`} fillOpacity={0.2} />
        <Path d="M17 48 C37 52 63 52 83 48" stroke={secondary} strokeWidth={1.05} strokeDasharray="4,2" strokeOpacity={0.3} fill="none" />
        <Path d="M39 22 C45 31 55 31 61 22" stroke={`url(#${ids.trim})`} strokeWidth={5.5} fill="none" strokeLinecap="round" />
        <Path d="M42 24 C47 28 53 28 58 24" stroke="#05070a" strokeWidth={1.45} strokeOpacity={0.28} fill="none" strokeLinecap="round" />
        <Line x1={8} y1={39} x2={20} y2={30} stroke={`url(#${ids.trim})`} strokeWidth={4.2} strokeLinecap="round" />
        <Line x1={7} y1={47} x2={18} y2={38} stroke={accent} strokeWidth={1.1} strokeOpacity={0.2} strokeLinecap="round" />
        <Line x1={92} y1={39} x2={80} y2={30} stroke={`url(#${ids.trim})`} strokeWidth={4.2} strokeLinecap="round" />
        <Line x1={93} y1={47} x2={82} y2={38} stroke={accent} strokeWidth={1.1} strokeOpacity={0.2} strokeLinecap="round" />
        <Rect x={24} y={100} width={52} height={4.2} rx={1.6} fill={`url(#${ids.trim})`} fillOpacity={0.36} />
      </>
    );
  }

  if (variant === 'baseball') {
    return (
      <>
        <Path d="M36 11 C42 22 58 22 64 11 L58 20 C53 25 47 25 42 20 Z" fill={`url(#${ids.trim})`} fillOpacity={0.72} />
        <Path d="M39 14 C44 20 56 20 61 14" stroke="#05070a" strokeWidth={1.55} strokeOpacity={0.24} fill="none" strokeLinecap="round" />
        <Line x1={47.2} y1={21} x2={47.2} y2={109} stroke={`url(#${ids.trim})`} strokeWidth={1.25} strokeOpacity={0.92} />
        <Line x1={52.8} y1={21} x2={52.8} y2={109} stroke={`url(#${ids.trim})`} strokeWidth={1.25} strokeOpacity={0.92} />
        <Line x1={50} y1={24} x2={50} y2={109} stroke="#000000" strokeWidth={0.42} strokeOpacity={0.11} />
        {[30, 41, 52, 63, 74, 85].map((y, index) => (
          <Circle key={`button_${index}`} cx={50} cy={y} r={1.55} fill={`url(#${ids.trim})`} stroke="#000000" strokeWidth={0.3} strokeOpacity={0.35} />
        ))}
        <Path d="M36 14 L21 42" stroke={`url(#${ids.trim})`} strokeWidth={1.05} strokeOpacity={0.58} fill="none" strokeLinecap="round" />
        <Path d="M64 14 L79 42" stroke={`url(#${ids.trim})`} strokeWidth={1.05} strokeOpacity={0.58} fill="none" strokeLinecap="round" />
        <Line x1={8} y1={50} x2={18} y2={39} stroke={`url(#${ids.trim})`} strokeWidth={2.9} strokeLinecap="round" />
        <Line x1={92} y1={50} x2={82} y2={39} stroke={`url(#${ids.trim})`} strokeWidth={2.9} strokeLinecap="round" />
        <Path d="M23 107 C36 113 64 113 77 107" stroke={`url(#${ids.trim})`} strokeWidth={1.05} strokeOpacity={0.5} fill="none" strokeLinecap="round" />
      </>
    );
  }

  if (variant === 'hockey') {
    return (
      <>
        <Path d="M9 38 C27 29 38 32 50 34 C62 32 73 29 91 38 L84 50 C63 56 37 56 16 50 Z" fill={`url(#${ids.trim})`} fillOpacity={0.24} />
        <Line x1={16} y1={51} x2={84} y2={51} stroke={secondary} strokeWidth={1.05} strokeDasharray="4,2" strokeOpacity={0.32} />
        <Path d="M40 22 C46 30 54 30 60 22 L50 36 Z" fill="#05070a" fillOpacity={0.24} />
        <Line x1={50} y1={35} x2={43} y2={19} stroke={accent} strokeWidth={1.18} strokeOpacity={0.46} />
        <Line x1={50} y1={35} x2={57} y2={19} stroke={accent} strokeWidth={1.18} strokeOpacity={0.46} />
        {[23, 27, 31].map((y, index) => (
          <Line key={`lace_${index}`} x1={45 + index * 0.8} y1={y} x2={55 - index * 0.8} y2={y} stroke={secondary} strokeWidth={1} strokeOpacity={0.64} />
        ))}
        <Rect x={17} y={92} width={66} height={6.2} rx={1.2} fill={`url(#${ids.trim})`} fillOpacity={0.76} />
        <Rect x={17} y={101} width={66} height={5} rx={1.1} fill={`url(#${ids.trim})`} fillOpacity={0.66} />
        <Rect x={2} y={58} width={13} height={5.2} rx={1} fill={`url(#${ids.trim})`} fillOpacity={0.58} />
        <Rect x={85} y={58} width={13} height={5.2} rx={1} fill={`url(#${ids.trim})`} fillOpacity={0.58} />
        <Line x1={2} y1={67} x2={15} y2={68} stroke={accent} strokeWidth={1.2} strokeOpacity={0.24} />
        <Line x1={85} y1={68} x2={98} y2={67} stroke={accent} strokeWidth={1.2} strokeOpacity={0.24} />
      </>
    );
  }

  if (variant === 'cricket') {
    return (
      <>
        <Path d="M36 11 C42 21 58 21 64 11 L58 23 C53 28 47 28 42 23 Z" fill={`url(#${ids.trim})`} fillOpacity={0.72} />
        <Path d="M41 16 L50 29 L59 16" stroke="#05070a" strokeWidth={1.55} strokeOpacity={0.24} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M39 15 L50 31 L61 15" stroke={accent} strokeWidth={0.72} strokeOpacity={0.38} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M17 27 L7 42 L14 49 L24 39 L25 32 Z" fill={`url(#${ids.trim})`} fillOpacity={0.42} />
        <Path d="M83 27 L93 42 L86 49 L76 39 L75 32 Z" fill={`url(#${ids.trim})`} fillOpacity={0.42} />
        <Path d="M24 92 C37 98 63 98 76 92" stroke={`url(#${ids.trim})`} strokeWidth={2.2} strokeOpacity={0.62} fill="none" strokeLinecap="round" />
        <Path d="M24 100 C38 106 62 106 76 100" stroke={accent} strokeWidth={0.82} strokeOpacity={0.22} fill="none" strokeLinecap="round" />
        <Line x1={25} y1={40} x2={75} y2={100} stroke={`url(#${ids.trim})`} strokeWidth={1.45} strokeOpacity={0.28} strokeLinecap="round" />
        <Line x1={27} y1={40} x2={77} y2={100} stroke={accent} strokeWidth={0.5} strokeOpacity={0.14} strokeLinecap="round" />
      </>
    );
  }

  if (variant === 'tennis') {
    return (
      <>
        <Path d="M36 11 C42 21 58 21 64 11 L58 24 C53 29 47 29 42 24 Z" fill={`url(#${ids.trim})`} fillOpacity={0.68} />
        <Path d="M41 16 L50 30 L59 16" stroke="#05070a" strokeWidth={1.45} strokeOpacity={0.22} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M40 15 L50 32 L60 15" stroke={accent} strokeWidth={0.72} strokeOpacity={0.34} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M18 27 L8 41 L15 48 L24 39 L25 33 Z" fill={`url(#${ids.trim})`} fillOpacity={0.34} />
        <Path d="M82 27 L92 41 L85 48 L76 39 L75 33 Z" fill={`url(#${ids.trim})`} fillOpacity={0.34} />
        <Path d="M24 89 C37 95 63 95 76 89" stroke={`url(#${ids.trim})`} strokeWidth={1.8} strokeOpacity={0.52} fill="none" strokeLinecap="round" />
        <Path d="M24 100 C38 106 62 106 76 100" stroke={accent} strokeWidth={0.82} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
        <Line x1={28} y1={40} x2={74} y2={96} stroke={`url(#${ids.trim})`} strokeWidth={1.2} strokeOpacity={0.22} strokeLinecap="round" />
        <Line x1={30} y1={40} x2={76} y2={96} stroke={accent} strokeWidth={0.46} strokeOpacity={0.12} strokeLinecap="round" />
      </>
    );
  }

  const ucl = variant === 'ucl';
  return (
    <>
      <Path d="M36 11 C42 20 58 20 64 11" stroke={`url(#${ids.trim})`} strokeWidth={3.7} fill="none" strokeLinecap="round" />
      <Ellipse cx={50} cy={16} rx={9.5} ry={4.5} fill="#05070a" fillOpacity={0.18} />
      <Path d="M17 27 L8 39 L15 46 L25 37 L26 31 Z" fill={`url(#${ids.trim})`} fillOpacity={0.34} />
      <Path d="M83 27 L92 39 L85 46 L75 37 L74 31 Z" fill={`url(#${ids.trim})`} fillOpacity={0.34} />
      <Line x1={22} y1={105} x2={78} y2={105} stroke={`url(#${ids.trim})`} strokeWidth={1.65} strokeOpacity={0.54} strokeLinecap="round" />
      {ucl ? (
        <>
          <Circle cx={35} cy={43} r={6.2} fill={`url(#${ids.trim})`} fillOpacity={0.52} stroke={accent} strokeWidth={0.8} strokeOpacity={0.5} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Line
              key={`ucl_star_${i}`}
              x1={35}
              y1={43}
              x2={35 + Math.cos((i * 72 * Math.PI) / 180) * 4.2}
              y2={43 + Math.sin((i * 72 * Math.PI) / 180) * 4.2}
              stroke={accent}
              strokeWidth={0.6}
              strokeOpacity={0.5}
            />
          ))}
        </>
      ) : (
        <Path d="M33 36 L39 38 L38 47 Q36 51 33 47 Q30 51 28 47 L27 38 Z" fill={`url(#${ids.trim})`} fillOpacity={0.6} stroke={accent} strokeWidth={0.75} strokeOpacity={0.42} />
      )}
    </>
  );
}

function EmbroideredLabel({
  x,
  y,
  label,
  fill,
  stroke,
  fontSize,
  maxWidth,
  minFontSize,
  rotation = 0,
  stitch = true,
}: {
  x: number;
  y: number;
  label: string;
  fill: string;
  stroke: string;
  fontSize: number;
  maxWidth?: number;
  minFontSize?: number;
  rotation?: number;
  stitch?: boolean;
}) {
  const targetMaxWidth = maxWidth ? wordmarkInnerWidth(maxWidth, fontSize) : undefined;
  const layout = fittedLabelLayout(label, fontSize, targetMaxWidth, minFontSize ?? 6.8);
  const transform = rotation ? `rotate(${rotation} ${x} ${y})` : undefined;
  const baselineStart = y - ((layout.lines.length - 1) * layout.lineHeight) / 2;
  const lineYs = layout.lines.map((_, index) => baselineStart + index * layout.lineHeight);
  const lineWidths = layout.lines.map((line) => estimatedTextWidth(line, layout.fontSize));
  const outerStroke = Math.max(1.1, Math.min(3.1, layout.fontSize * 0.24));
  const shadowStroke = outerStroke + Math.max(0.36, layout.fontSize * 0.06);
  const insetStroke = Math.max(0.22, Math.min(0.54, layout.fontSize * 0.04));
  const stitchStroke = Math.max(0.18, Math.min(0.42, layout.fontSize * 0.035));
  const stitchDash = `${Math.max(0.52, layout.fontSize * 0.09)},${Math.max(1.08, layout.fontSize * 0.18)}`;
  const lightThread = lighten(fill, luminance(fill) > 0.58 ? 0.16 : 0.38);
  const darkThread = darken(fill, luminance(fill) > 0.58 ? 0.32 : 0.18);

  return (
    <G transform={transform}>
      {layout.lines.map((line, index) => (
        <Path
          key={`applique_shadow_${line}_${index}`}
          d={`M${x - lineWidths[index] / 2} ${lineYs[index] + layout.fontSize * 0.35} C${x - lineWidths[index] * 0.22} ${lineYs[index] + layout.fontSize * 0.47} ${x + lineWidths[index] * 0.22} ${lineYs[index] + layout.fontSize * 0.47} ${x + lineWidths[index] / 2} ${lineYs[index] + layout.fontSize * 0.35}`}
          stroke="#000000"
          strokeWidth={Math.max(0.4, layout.fontSize * 0.045)}
          strokeOpacity={0.16}
          strokeLinecap="round"
          fill="none"
        />
      ))}
      {layout.lines.map((line, index) => (
        <SvgText
          key={`applique_depth_${line}_${index}`}
          x={x + Math.max(0.22, layout.fontSize * 0.025)}
          y={lineYs[index] + Math.max(0.34, layout.fontSize * 0.045)}
          textAnchor="middle"
          fontSize={layout.fontSize}
          fontWeight="900"
          fontFamily="System"
          fill="none"
          stroke="#000000"
          strokeWidth={shadowStroke}
          strokeOpacity={0.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {line}
        </SvgText>
      ))}
      {layout.lines.map((line, index) => (
        <SvgText
          key={`applique_outline_${line}_${index}`}
          x={x}
          y={lineYs[index]}
          textAnchor="middle"
          fontSize={layout.fontSize}
          fontWeight="900"
          fontFamily="System"
          fill="none"
          stroke={stroke}
          strokeWidth={outerStroke}
          strokeOpacity={0.98}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {line}
        </SvgText>
      ))}
      {layout.lines.map((line, index) => (
        <SvgText
          key={`applique_fill_${line}_${index}`}
          x={x}
          y={lineYs[index]}
          textAnchor="middle"
          fontSize={layout.fontSize}
          fontWeight="900"
          fontFamily="System"
          fill={fill}
          fillOpacity={0.97}
        >
          {line}
        </SvgText>
      ))}
      {layout.lines.map((line, index) => (
        <SvgText
          key={`applique_inset_${line}_${index}`}
          x={x}
          y={lineYs[index]}
          textAnchor="middle"
          fontSize={layout.fontSize}
          fontWeight="900"
          fontFamily="System"
          fill="none"
          stroke={darkThread}
          strokeWidth={insetStroke}
          strokeOpacity={0.45}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          {line}
        </SvgText>
      ))}
      {layout.lines.map((line, index) => (
        <SvgText
          key={`applique_highlight_${line}_${index}`}
          x={x}
          y={lineYs[index] - Math.max(0.14, layout.fontSize * 0.025)}
          textAnchor="middle"
          fontSize={layout.fontSize}
          fontWeight="900"
          fontFamily="System"
          fill={lightThread}
          fillOpacity={0.18}
        >
          {line}
        </SvgText>
      ))}
      {stitch ? (
        layout.lines.map((line, index) => (
          <SvgText
            key={`applique_stitch_${line}_${index}`}
            x={x}
            y={lineYs[index]}
            textAnchor="middle"
            fontSize={layout.fontSize}
            fontWeight="900"
            fontFamily="System"
            fill="none"
            stroke={lightThread}
            strokeWidth={stitchStroke}
            strokeDasharray={stitchDash}
            strokeOpacity={0.24}
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            {line}
          </SvgText>
        ))
      ) : null}
    </G>
  );
}

function LegalSafeCrest({
  x,
  y,
  label,
  ids,
  fill,
  stroke,
  accent,
  showMark = true,
  shape = 'shield',
}: {
  x: number;
  y: number;
  label: string;
  ids: Record<string, string>;
  fill: string;
  stroke: string;
  accent: string;
  showMark?: boolean;
  shape?: 'shield' | 'circle' | 'diamond';
}) {
  const mark = safeLabel(label, 2);
  if (shape === 'circle') {
    return (
      <>
        <Circle cx={x} cy={y + 0.6} r={6.4} fill="#000000" fillOpacity={0.22} />
        <Circle cx={x} cy={y} r={5.8} fill={`url(#${ids.trim})`} fillOpacity={0.76} stroke={accent} strokeWidth={0.78} strokeOpacity={0.48} />
        <Path d={`M${x - 3.7} ${y + 3.2} L${x + 3.8} ${y - 3.2}`} stroke={stroke} strokeWidth={0.78} strokeOpacity={0.44} strokeLinecap="round" />
        {showMark ? (
          <SvgText x={x} y={y + 2.1} textAnchor="middle" fontSize={4.5} fontWeight="900" fill={fill} stroke={stroke} strokeWidth={0.42}>
            {mark}
          </SvgText>
        ) : null}
      </>
    );
  }

  if (shape === 'diamond') {
    return (
      <>
        <Path d={`M${x} ${y - 6.7} L${x + 6.2} ${y} L${x} ${y + 6.7} L${x - 6.2} ${y} Z`} fill="#000000" fillOpacity={0.22} />
        <Path d={`M${x} ${y - 5.6} L${x + 5.2} ${y} L${x} ${y + 5.6} L${x - 5.2} ${y} Z`} fill={`url(#${ids.trim})`} fillOpacity={0.78} stroke={accent} strokeWidth={0.7} strokeOpacity={0.46} />
        {showMark ? (
          <SvgText x={x} y={y + 1.9} textAnchor="middle" fontSize={4.3} fontWeight="900" fill={fill} stroke={stroke} strokeWidth={0.38}>
            {mark}
          </SvgText>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Path d={`M${x - 5.8} ${y - 6} L${x + 5.8} ${y - 6} L${x + 4.9} ${y + 3.6} Q${x} ${y + 7.8} ${x - 4.9} ${y + 3.6} Z`} fill="#000000" fillOpacity={0.22} />
      <Path d={`M${x - 4.9} ${y - 5.1} L${x + 4.9} ${y - 5.1} L${x + 4.1} ${y + 2.9} Q${x} ${y + 6.5} ${x - 4.1} ${y + 2.9} Z`} fill={`url(#${ids.trim})`} fillOpacity={0.78} stroke={accent} strokeWidth={0.72} strokeOpacity={0.48} />
      <Path d={`M${x - 2.9} ${y - 2.4} L${x + 2.9} ${y - 2.4}`} stroke="#ffffff" strokeWidth={0.62} strokeOpacity={0.22} strokeLinecap="round" />
      {showMark ? (
        <SvgText x={x} y={y + 1.9} textAnchor="middle" fontSize={4.2} fontWeight="900" fill={fill} stroke={stroke} strokeWidth={0.38}>
          {mark}
        </SvgText>
      ) : null}
    </>
  );
}

function GarmentMarkings({
  variant,
  label,
  wordmark,
  shape,
  ids,
  fill,
  stroke,
  accent,
}: {
  variant: JerseyModelVariant;
  label: string;
  wordmark: string;
  shape: ModelShape;
  ids: Record<string, string>;
  fill: string;
  stroke: string;
  accent: string;
}) {
  const fontSize = jerseyFontSize(label, variant);
  const wordSize = wordmarkFontSize(wordmark, variant);
  const wordIsLabel = sameMark(wordmark, label);

  if (variant === 'hockey') {
    return (
      <>
        <Ellipse cx={50} cy={64} rx={17.5} ry={13.4} fill="#000000" fillOpacity={0.24} />
        <Ellipse cx={50} cy={63.2} rx={16} ry={12} fill={`url(#${ids.trim})`} fillOpacity={0.66} stroke={accent} strokeWidth={0.8} strokeOpacity={0.42} />
        <Ellipse cx={47.5} cy={59} rx={10.5} ry={2.8} fill="#ffffff" fillOpacity={0.17} />
        <EmbroideredLabel x={50} y={shape.labelY} label={label} fill={fill} stroke={stroke} fontSize={fontSize} maxWidth={26} />
        {!wordIsLabel ? (
          <EmbroideredLabel x={50} y={84} label={wordmark} fill={fill} stroke={stroke} fontSize={wordSize} maxWidth={50} minFontSize={7} />
        ) : null}
      </>
    );
  }

  if (variant === 'soccer' || variant === 'ucl') {
    return (
      <>
        <LegalSafeCrest x={34} y={42.5} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="circle" />
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} fontSize={wordSize} maxWidth={44} minFontSize={6.6} />
      </>
    );
  }

  if (variant === 'cricket') {
    return (
      <>
        <LegalSafeCrest x={35} y={45} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="circle" />
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} fontSize={wordSize} maxWidth={44} minFontSize={6.8} rotation={-10} />
        <Path d="M31 72 C42 76 58 77 70 72" stroke={stroke} strokeWidth={0.9} strokeOpacity={0.16} strokeLinecap="round" fill="none" />
      </>
    );
  }

  if (variant === 'tennis') {
    return (
      <>
        <LegalSafeCrest x={35} y={45} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="circle" />
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} fontSize={wordSize} maxWidth={50} minFontSize={7.2} rotation={-6} />
        <Path d="M32 72 C43 75 57 75 68 72" stroke={stroke} strokeWidth={0.82} strokeOpacity={0.14} strokeLinecap="round" fill="none" />
      </>
    );
  }

  if (variant === 'baseball') {
    return (
      <>
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} fontSize={wordSize} maxWidth={54} minFontSize={7.2} rotation={-5} />
        <LegalSafeCrest x={85} y={42} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="shield" />
        <Rect x={31} y={98} width={12} height={3.4} rx={0.9} fill={accent} fillOpacity={0.36} />
        <Rect x={57} y={98} width={12} height={3.4} rx={0.9} fill={`url(#${ids.trim})`} fillOpacity={0.48} />
      </>
    );
  }

  if (variant === 'football') {
    return (
      <>
        <LegalSafeCrest x={50} y={45} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="shield" />
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} fontSize={wordSize} maxWidth={48} minFontSize={7.2} />
        <Path d="M15 43 L25 40 L23 47 L14 50 Z" fill={stroke} fillOpacity={0.18} stroke={accent} strokeWidth={0.55} strokeOpacity={0.22} />
        <Path d="M85 43 L75 40 L77 47 L86 50 Z" fill={stroke} fillOpacity={0.18} stroke={accent} strokeWidth={0.55} strokeOpacity={0.22} />
      </>
    );
  }

  if (variant === 'basketball' || variant === 'college-basketball') {
    const basketballWordSize = jerseyWordmarkFontSize(wordmark, variant);
    const y = shape.labelY;

    return (
      <>
        <EmbroideredLabel x={shape.labelX} y={y} label={wordmark} fill={fill} stroke={stroke} fontSize={basketballWordSize} maxWidth={48} minFontSize={7.6} />
      </>
    );
  }

  return (
    <>
      <LegalSafeCrest x={38} y={43} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="diamond" />
      <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} fontSize={wordSize} maxWidth={46} minFontSize={6.8} />
      {!wordIsLabel ? (
        <EmbroideredLabel x={50} y={77} label={safeLabel(label, 2)} fill={fill} stroke={stroke} fontSize={fontSize} maxWidth={22} />
      ) : null}
    </>
  );
}

function BasketballSleevelessModel({
  ids,
  variant,
  primary,
  secondary,
  accent,
  abbr,
  teamName,
  size,
}: {
  ids: Record<string, string>;
  variant: JerseyModelVariant;
  primary: string;
  secondary: string;
  accent: string;
  abbr: string;
  teamName?: string;
  size: number;
}) {
  const body =
    'M23 18 C29 12 34 9 36 9 C39 21 45 30 50 30 C55 30 61 21 64 9 C66 9 71 12 77 18 C73 28 72 38 72 47 L76 47 L76 107 C62 112 38 112 24 107 L24 47 L28 47 C28 38 27 28 23 18 Z';
  const wordmark = teamWordmark(teamName, abbr, variant);
  const detail = readableDetail(primary, secondary, accent);
  const outline = readableOutline(detail);
  const wordSize = jerseyWordmarkFontSize(wordmark, variant);
  const number = jerseyNumber(abbr);
  const renderId = Number(ids.clip.replace(/\D/g, '').slice(-4)) || 1;

  return (
    <Svg width={size} height={size * 1.16} viewBox="0 0 100 116" fill="none">
      <Defs>
        <ClipPath id={ids.clip}>
          <Path d={body} />
        </ClipPath>
        <SvgLinearGradient id={ids.body} x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor={lighten(primary, 0.3)} stopOpacity={1} />
          <Stop offset="0.2" stopColor={lighten(primary, 0.12)} stopOpacity={1} />
          <Stop offset="0.52" stopColor={primary} stopOpacity={1} />
          <Stop offset="0.82" stopColor={darken(primary, 0.16)} stopOpacity={1} />
          <Stop offset="1" stopColor={darken(primary, 0.34)} stopOpacity={1} />
        </SvgLinearGradient>
        <SvgLinearGradient id={ids.trim} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={lighten(secondary, 0.3)} stopOpacity={1} />
          <Stop offset="0.52" stopColor={secondary} stopOpacity={1} />
          <Stop offset="1" stopColor={darken(secondary, 0.22)} stopOpacity={1} />
        </SvgLinearGradient>
        <SvgLinearGradient id={ids.edge} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#000000" stopOpacity={0.12} />
          <Stop offset="0.22" stopColor="#000000" stopOpacity={0.035} />
          <Stop offset="0.43" stopColor="#ffffff" stopOpacity={0.1} />
          <Stop offset="0.58" stopColor="#ffffff" stopOpacity={0.035} />
          <Stop offset="0.8" stopColor="#000000" stopOpacity={0.035} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.14} />
        </SvgLinearGradient>
        <RadialGradient id={ids.volume} cx="46%" cy="24%" r="76%">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.16} />
          <Stop offset="0.34" stopColor="#ffffff" stopOpacity={0.055} />
          <Stop offset="0.72" stopColor="#000000" stopOpacity={0.035} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.14} />
        </RadialGradient>
        <SvgLinearGradient id={ids.rim} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.2} />
          <Stop offset="0.38" stopColor="#ffffff" stopOpacity={0.055} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.12} />
        </SvgLinearGradient>
        <SvgLinearGradient id={ids.glass} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={accent} stopOpacity={0} />
          <Stop offset="0.34" stopColor={accent} stopOpacity={0.1} />
          <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.025} />
          <Stop offset="0.68" stopColor={accent} stopOpacity={0.075} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>

      <Ellipse cx={50} cy={109} rx={29} ry={5.8} fill="#000000" fillOpacity={0.2} />
      <Ellipse cx={50} cy={107.8} rx={21} ry={3.2} fill={darken(primary, 0.8)} fillOpacity={0.14} />
      <G transform="translate(2.5 2.6)">
        <Path d={body} fill="#000000" fillOpacity={0.15} />
      </G>
      <G transform="translate(-1.2 0.75)">
        <Path d={body} fill="#ffffff" fillOpacity={0.06} />
      </G>
      <Path d={body} fill={`url(#${ids.body})`} />
      <G clipPath={`url(#${ids.clip})`}>
        <Rect x={0} y={0} width={100} height={116} fill={`url(#${ids.volume})`} />
        <Rect x={0} y={0} width={100} height={116} fill={`url(#${ids.edge})`} />
        <Path d="M24 47 L34 47 C35 64 35 88 32 108 L24 108 Z" fill="#000000" fillOpacity={0.06} />
        <Path d="M76 47 L66 47 C65 64 65 88 68 108 L76 108 Z" fill="#000000" fillOpacity={0.055} />
        <Path d="M33 49 C34 68 34 88 31 106" stroke="#ffffff" strokeWidth={0.62} strokeOpacity={0.09} fill="none" strokeLinecap="round" />
        <Path d="M67 49 C66 68 66 88 69 106" stroke="#000000" strokeWidth={0.58} strokeOpacity={0.08} fill="none" strokeLinecap="round" />
        {[38, 44, 56, 62].map((x, index) => (
          <Path
            key={`basketball_channel_${renderId}_${index}`}
            d={`M${x} 32 C${x - 1.2} 52 ${x + 1.1} 82 ${x} 106`}
            stroke={index % 2 ? '#000000' : '#ffffff'}
            strokeWidth={0.42}
            strokeOpacity={index % 2 ? 0.11 : 0.13}
            fill="none"
            strokeLinecap="round"
          />
        ))}
        {[54, 64, 74, 84, 94].map((y, index) => (
          <Path
            key={`basketball_side_stitch_${renderId}_${index}`}
            d={`M29 ${y} L31.4 ${y + 0.8} M71 ${y} L68.6 ${y + 0.8}`}
            stroke={lighten(secondary, 0.42)}
            strokeWidth={0.72}
            strokeOpacity={0.38}
            strokeLinecap="round"
          />
        ))}
        <Path d="M34 48 C34 66 34 86 33 106" stroke="#ffffff" strokeWidth={0.52} strokeOpacity={0.075} fill="none" strokeLinecap="round" />
        <Path d="M66 48 C66 66 66 86 67 106" stroke="#000000" strokeWidth={0.52} strokeOpacity={0.075} fill="none" strokeLinecap="round" />
        <TextureLayer weave="mesh" id={renderId} primary={primary} accent={accent} />
        <ClothFoldLayer variant={variant} id={renderId} />
      </G>

      <Path d="M36 9 C39 21 45 30 50 30 C55 30 61 21 64 9" stroke={`url(#${ids.trim})`} strokeWidth={5.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M40 11 C43 20 46 26 50 26 C54 26 57 20 60 11" stroke="#05070a" strokeWidth={1.8} strokeOpacity={0.28} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M24 101 C38 106 62 106 76 101" stroke={`url(#${ids.trim})`} strokeWidth={1.65} strokeOpacity={0.36} fill="none" strokeLinecap="round" />

      <Path d={body} stroke="#000000" strokeWidth={1.55} strokeOpacity={0.12} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={body} stroke={`url(#${ids.rim})`} strokeWidth={0.95} strokeOpacity={0.42} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={body} stroke={secondary} strokeWidth={0.52} strokeOpacity={0.18} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={body} fill={`url(#${ids.glass})`} />
      <Path d="M23 18 C29 29 29 38 28 47 L24 47 C25 38 24 28 19 21 Z" fill={`url(#${ids.trim})`} />
      <Path d="M77 18 C71 29 71 38 72 47 L76 47 C75 38 76 28 81 21 Z" fill={`url(#${ids.trim})`} />
      <Path d="M24.4 20 C29.1 30 29.8 39 28.4 47" stroke={lighten(secondary, 0.5)} strokeWidth={0.82} strokeOpacity={0.42} fill="none" strokeLinecap="round" />
      <Path d="M75.6 20 C70.9 30 70.2 39 71.6 47" stroke={lighten(secondary, 0.5)} strokeWidth={0.82} strokeOpacity={0.42} fill="none" strokeLinecap="round" />
      <Path d="M27 22 C30 32 30 39 29 47" stroke="#05070a" strokeWidth={1.08} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
      <Path d="M73 22 C70 32 70 39 71 47" stroke="#05070a" strokeWidth={1.08} strokeOpacity={0.18} fill="none" strokeLinecap="round" />

      <G clipPath={`url(#${ids.clip})`}>
        <EmbroideredLabel x={50} y={54.5} label={wordmark} fill={detail} stroke={outline} fontSize={wordSize} maxWidth={48} minFontSize={7.6} />
        <EmbroideredLabel x={50} y={77} label={number} fill={detail} stroke={outline} fontSize={14} maxWidth={25} />
      </G>
      <Path d={body} fill={`url(#${ids.glass})`} fillOpacity={0.32} />
    </Svg>
  );
}

export function MiniJerseyModel({
  variant,
  primary,
  secondary,
  accent = '#FFFFFF',
  abbr,
  teamName,
  size = 52,
}: MiniJerseyModelProps) {
  const instanceIdRef = useRef<number | null>(null);
  if (instanceIdRef.current === null) instanceIdRef.current = ++jerseyModelId;
  const instanceId = instanceIdRef.current;
  const shape = modelShape(variant);
  const label = safeLabel(abbr);
  const wordmark = teamWordmark(teamName, abbr, variant);
  const detail = readableDetail(primary, secondary, accent);
  const outline = readableOutline(detail);
  const ids = {
    body: `mini_body_${instanceId}`,
    trim: `mini_trim_${instanceId}`,
    edge: `mini_edge_${instanceId}`,
    volume: `mini_volume_${instanceId}`,
    rim: `mini_rim_${instanceId}`,
    glass: `mini_glass_${instanceId}`,
    clip: `mini_clip_${instanceId}`,
  };

  if (variant === 'basketball' || variant === 'college-basketball') {
    return (
      <BasketballSleevelessModel
        ids={ids}
        variant={variant}
        primary={primary}
        secondary={secondary}
        accent={accent}
        abbr={abbr}
        teamName={teamName}
        size={size}
      />
    );
  }

  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 100 120" fill="none">
      <ModelDefs ids={ids} body={shape.body} primary={primary} secondary={secondary} accent={accent} />

      <Ellipse cx={50} cy={114} rx={33} ry={6.6} fill="#000000" fillOpacity={0.22} />
      <Ellipse cx={50} cy={112.8} rx={22} ry={3.4} fill={darken(primary, 0.8)} fillOpacity={0.16} />

      <G transform="translate(3 2.4)">
        <Path d={shape.body} fill="#000000" fillOpacity={0.2} />
      </G>
      <G transform="translate(-1.4 0.9)">
        <Path d={shape.body} fill="#ffffff" fillOpacity={0.07} />
      </G>

      <Path d={shape.body} fill={`url(#${ids.body})`} />
      <G clipPath={`url(#${ids.clip})`}>
        <Rect x={0} y={0} width={100} height={120} fill={`url(#${ids.volume})`} />
        <Rect x={0} y={0} width={100} height={120} fill={`url(#${ids.edge})`} />
        <PanelVolume variant={variant} />
        <TextureLayer weave={shape.weave} id={instanceId} primary={primary} accent={accent} />
        <ClothFoldLayer variant={variant} id={instanceId} />
      </G>

      <SportConstruction variant={variant} ids={ids} secondary={secondary} accent={accent} />

      <Path d={shape.body} stroke="#000000" strokeWidth={2.05} strokeOpacity={0.13} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={shape.body} stroke={`url(#${ids.rim})`} strokeWidth={1.05} strokeOpacity={0.46} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={shape.body} stroke={secondary} strokeWidth={0.58} strokeOpacity={0.18} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={shape.body} fill={`url(#${ids.glass})`} />

      <G clipPath={`url(#${ids.clip})`}>
        <GarmentMarkings
          variant={variant}
          label={label}
          wordmark={wordmark}
          shape={shape}
          ids={ids}
          fill={detail}
          stroke={outline}
          accent={accent}
        />
      </G>
      <Path d={shape.body} fill={`url(#${ids.glass})`} fillOpacity={0.34} />
    </Svg>
  );
}
