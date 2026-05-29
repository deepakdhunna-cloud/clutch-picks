import React, { useRef, memo } from 'react';
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
  TextPath,
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
const WORDMARK_FONT_FAMILY = 'BebasNeue_400Regular';

// Below this rendered size, the fine weave dots, fold micro-strokes, panel
// channels and crest sub-detail are physically sub-pixel (a mesh dot of r=0.45
// in a 100-unit viewBox at size 34 is ~0.3px; a 0.55-unit fold stroke is
// ~0.19px) so they are invisible yet cost the most nodes. We drop them on the
// smallest, most-numerous jerseys (e.g. the 34px CompactLiveCard thumbnails)
// while keeping the silhouette, baked lighting, construction and lettering that
// actually read at that size. Full detail is untouched at >= this size.
const REDUCED_DETAIL_THRESHOLD = 40;

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
  // BROADCAST CONTRAST GUARD (run 7/8). A bold team graphic wants the team's REAL
  // high-contrast color — vivid white-on-navy, gold-on-black, scarlet-on-white —
  // not a flat fallback that flattens every team to white. So the candidate set is
  // ranked brand-first: the true secondary/accent, then progressively punchier
  // tints of the SAME color (run 8: stronger steps so a mid-value team color can
  // still clear the bar while staying on-brand), and only THEN the neutral
  // white/near-black safety nets. The guard then prefers the first brand candidate
  // that clears 3.4:1 over snapping to a generic neutral (the over-snap gap).
  const brandCandidates = [
    secondary,
    accent,
    lighten(secondary, 0.34),
    darken(secondary, 0.34),
    lighten(accent, 0.34),
    darken(accent, 0.34),
    lighten(secondary, 0.55),
    darken(secondary, 0.55),
  ];
  const neutralCandidates = ['#FFFFFF', '#0A1016'];
  const candidates = [...brandCandidates, ...neutralCandidates];
  const unique = candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);

  // The richest brand color that clears the confident 3.4:1 bar (kept on-brand).
  const brandPass = unique
    .slice(0, brandCandidates.length)
    .find((candidate) => contrastRatio(candidate, primary) >= 3.4);
  if (brandPass) return brandPass;

  // No tint of the team's own color is legible enough — return the single highest-
  // contrast candidate of all (the best brand tint OR the better neutral). We pick
  // whichever neutral actually has more separation rather than a luminance guess:
  // on a mid-value body (e.g. scarlet) white and near-black can BOTH be marginal,
  // so choosing the genuinely-higher-contrast option keeps the number as legible as
  // the body allows. This guarantees we never return a number that pops LESS than
  // the best available option.
  return unique.reduce((current, candidate) => (
    contrastRatio(candidate, primary) > contrastRatio(current, primary) ? candidate : current
  ), unique[0]);
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
      return { maxWidth: 52, minFontSize: 8.2 };
    case 'football':
      return { maxWidth: 52, minFontSize: 7.8 };
    case 'baseball':
      return { maxWidth: 68, minFontSize: 8.8 };
    case 'hockey':
      return { maxWidth: 54, minFontSize: 7.8 };
    case 'soccer':
    case 'ucl':
      return { maxWidth: 48, minFontSize: 7.4 };
    case 'tennis':
      return { maxWidth: 54, minFontSize: 7.8 };
    case 'cricket':
      return { maxWidth: 48, minFontSize: 7.4 };
    default:
      return { maxWidth: 50, minFontSize: 7.4 };
  }
}

function jerseyWordmarkFontSize(label: string, variant: JerseyModelVariant): number {
  const length = label.replace(/\s/g, '').length;
  if (variant === 'basketball' || variant === 'college-basketball') {
    return length >= 12 ? 9.6 : length >= 10 ? 10.4 : length >= 8 ? 11.2 : 12.4;
  }

  return wordmarkFontSize(label, variant);
}

function wordmarkStrokeReserve(fontSize: number): number {
  return Math.max(1.1, fontSize * 0.12);
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
    if (/\s/.test(char)) return sum + 0.28;
    if (/[MW]/.test(char)) return sum + 0.74;
    if (/[I1JL]/.test(char)) return sum + 0.32;
    if (/[0-9]/.test(char)) return sum + 0.52;
    if (/[-.]/.test(char)) return sum + 0.26;
    return sum + 0.56;
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
  if (variant === 'baseball') return length >= 11 ? 9.8 : length >= 9 ? 10.7 : length >= 7 ? 11.4 : 12.6;
  if (variant === 'football') return length >= 11 ? 9.2 : length >= 9 ? 9.9 : length >= 7 ? 10.8 : 12.1;
  if (variant === 'hockey') return length >= 11 ? 9.1 : length >= 9 ? 9.8 : length >= 7 ? 10.6 : 11.7;
  if (variant === 'tennis') return length >= 10 ? 9.2 : length >= 8 ? 9.9 : length >= 5 ? 10.9 : 12;
  if (variant === 'cricket') return length >= 8 ? 9.5 : length >= 5 ? 10.6 : 11.8;
  if (variant === 'soccer' || variant === 'ucl') return length >= 8 ? 8.4 : length >= 5 ? 9.4 : 10.4;
  return length >= 11 ? 9 : length >= 9 ? 9.8 : length >= 7 ? 10.5 : 11.6;
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
    // Real baseball pinstripes are sewn into a worn torso, so they BOW with the
    // chest — bellying outward away from centre and pinching back at the hem —
    // never the dead-straight printed grid the old <Line>s drew (a top "drawn by
    // code" tell). Each stripe is a gentle quadratic curve whose bow scales with
    // its distance from centre (50), so the set reads as cloth wrapping a body.
    // Same node count as before (Path vs Line), zero per-frame cost.
    const pinstripe = (x: number) => {
      const bow = (x - 50) * 0.12;
      return `M${(x + bow * 0.18).toFixed(2)} 18 Q${(x + bow).toFixed(2)} 64 ${(x + bow * 0.32).toFixed(2)} 110`;
    };
    return (
      <>
        {[25, 31, 37, 43, 57, 63, 69, 75].map((x, index) => (
          <Path key={`pin_${id}_${index}`} d={pinstripe(x)} stroke={accent} strokeWidth={0.62} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
        ))}
        {[28, 46, 54, 72].map((x, index) => (
          <Path key={`pin_shadow_${id}_${index}`} d={pinstripe(x)} stroke="#000000" strokeWidth={0.38} strokeOpacity={0.09} fill="none" strokeLinecap="round" />
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

// Per-garment key-light + specular placement. Pro renders read as ONE soft key
// light shaped to the actual textile, not a generic band stamped on every shirt.
// We keep the exact same gradient DEFS (zero added nodes) but tune their geometry
// per garment family so the sheen rakes where that fabric would actually catch
// light and the key falls off the way that textile reflects:
//  - football: heavy twill on padded shoulders — broad, soft, low-gloss sheen
//    sitting high on the pad cap; the key sits higher/wider over the yoke.
//  - soccer / ucl: smooth tech-poly — a crisp, tighter, brighter specular streak.
//  - baseball: matte flannel/knit — the softest, most diffuse sheen, lowest gloss.
//  - hockey: heavy knit — broad, low, diffuse.
//  - default (cricket/tennis): balanced poly sheen.
function lightingProfile(variant: JerseyModelVariant): {
  volume: { cx: string; cy: string; r: string; peak: number };
  sheen: { x1: string; y1: string; x2: string; y2: string; peak: number; band: number };
} {
  switch (variant) {
    case 'football':
      return {
        volume: { cx: '50%', cy: '20%', r: '82%', peak: 0.2 },
        sheen: { x1: '0.1', y1: '0.02', x2: '0.82', y2: '0.5', peak: 0.13, band: 0.2 },
      };
    case 'soccer':
    case 'ucl':
      return {
        volume: { cx: '46%', cy: '26%', r: '76%', peak: 0.19 },
        sheen: { x1: '0.14', y1: '0.06', x2: '0.66', y2: '0.66', peak: 0.2, band: 0.13 },
      };
    case 'baseball':
      return {
        volume: { cx: '48%', cy: '27%', r: '80%', peak: 0.14 },
        sheen: { x1: '0.16', y1: '0.08', x2: '0.74', y2: '0.6', peak: 0.1, band: 0.22 },
      };
    case 'hockey':
      return {
        volume: { cx: '48%', cy: '24%', r: '80%', peak: 0.15 },
        sheen: { x1: '0.12', y1: '0.05', x2: '0.78', y2: '0.56', peak: 0.12, band: 0.24 },
      };
    default:
      return {
        volume: { cx: '48%', cy: '25%', r: '78%', peak: 0.18 },
        sheen: { x1: '0.12', y1: '0.05', x2: '0.74', y2: '0.62', peak: 0.16, band: 0.18 },
      };
  }
}

function ModelDefs({
  ids,
  body,
  variant,
  primary,
  secondary,
  accent,
}: {
  ids: Record<string, string>;
  body: string;
  variant: JerseyModelVariant;
  primary: string;
  secondary: string;
  accent: string;
}) {
  const light = lightingProfile(variant);
  const sheenMid = (Number(light.sheen.peak) * 0.25).toFixed(3);
  return (
    <Defs>
      <ClipPath id={ids.clip}>
        <Path d={body} />
      </ClipPath>
      {/* BODY VALUE RAMP (run 7 — bold-graphic rebalance). The old top stop lifted
          32% toward white, which desaturated the shoulders and read washed. A
          broadcast team graphic keeps the team color SATURATED and confident with
          a shorter, punchier value swing: a tighter highlight on the shoulders,
          the pure team color owning more of the chest, and a confident (not muddy)
          shadow at the hem for dimension. */}
      <SvgLinearGradient id={ids.body} x1="0.08" y1="0" x2="0.92" y2="1">
        <Stop offset="0" stopColor={lighten(primary, 0.2)} stopOpacity={1} />
        <Stop offset="0.18" stopColor={lighten(primary, 0.08)} stopOpacity={1} />
        <Stop offset="0.46" stopColor={primary} stopOpacity={1} />
        <Stop offset="0.78" stopColor={darken(primary, 0.2)} stopOpacity={1} />
        <Stop offset="1" stopColor={darken(primary, 0.4)} stopOpacity={1} />
      </SvgLinearGradient>
      {/* CORE BODY-SHADOW. The body linear gradient alone runs corner-to-corner,
          which reads as a flat laminated sheet. A real worn torso has its value
          PEAK on the upper chest and a soft form-shadow core that wraps down the
          flanks toward the hem. This vertical-ish radial, offset slightly off the
          highlight, deepens that core so the cloth reads as a rounded body with
          honest value contrast (the washed-out tell) — NOT extra airbrush. Painted
          under the markings, clipped to the body, zero per-frame cost. */}
      <RadialGradient id={ids.core} cx="50%" cy="38%" r="74%">
        <Stop offset="0" stopColor="#000000" stopOpacity={0} />
        <Stop offset="0.52" stopColor="#000000" stopOpacity={0} />
        <Stop offset="0.82" stopColor="#000000" stopOpacity={0.07} />
        <Stop offset="1" stopColor="#000000" stopOpacity={0.2} />
      </RadialGradient>
      {/* TRIM RAMP (run 7/8). Trim/collar/cuff/panel/stripe color reads as the
          team's confident secondary. Now that the trim fills are near-solid (run 8
          opacity lift), the ramp keeps the secondary VIVID across the whole band:
          a tight highlight, the pure secondary owning the broad core, and only a
          shallow shadow at the far edge for dimension — so a bold colored cuff or
          panel never fades to a muddy dark at one end. */}
      <SvgLinearGradient id={ids.trim} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={lighten(secondary, 0.22)} stopOpacity={1} />
        <Stop offset="0.55" stopColor={secondary} stopOpacity={1} />
        <Stop offset="1" stopColor={darken(secondary, 0.2)} stopOpacity={1} />
      </SvgLinearGradient>
      <SvgLinearGradient id={ids.edge} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor="#000000" stopOpacity={0.18} />
        <Stop offset="0.2" stopColor="#000000" stopOpacity={0.035} />
        <Stop offset="0.44" stopColor="#ffffff" stopOpacity={0.11} />
        <Stop offset="0.64" stopColor="#ffffff" stopOpacity={0.035} />
        <Stop offset="0.84" stopColor="#000000" stopOpacity={0.04} />
        <Stop offset="1" stopColor="#000000" stopOpacity={0.2} />
      </SvgLinearGradient>
      <RadialGradient id={ids.volume} cx={light.volume.cx} cy={light.volume.cy} r={light.volume.r}>
        <Stop offset="0" stopColor="#ffffff" stopOpacity={light.volume.peak} />
        <Stop offset="0.34" stopColor="#ffffff" stopOpacity={light.volume.peak * 0.33} />
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
      <SvgLinearGradient id={ids.sheen} x1={light.sheen.x1} y1={light.sheen.y1} x2={light.sheen.x2} y2={light.sheen.y2}>
        <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
        <Stop offset={(0.16 - light.sheen.band * 0.18).toFixed(3)} stopColor="#ffffff" stopOpacity={light.sheen.peak} />
        <Stop offset={(0.27 + light.sheen.band * 0.18).toFixed(3)} stopColor="#ffffff" stopOpacity={Number(sheenMid)} />
        <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0} />
        <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
      </SvgLinearGradient>
      {/* SOFT CONTACT SHADOW. The old grounding was a flat hard-edged ellipse —
          it read as a gray pill, so the jersey looked pasted on. A real cast
          shadow is densest directly under the hem and feathers out to nothing.
          This radial fills the contact ellipse so the shadow has a soft penumbra
          and the garment sits in space instead of floating. One gradient def. */}
      <RadialGradient id={ids.contact} cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor="#000000" stopOpacity={0.26} />
        <Stop offset="0.55" stopColor="#000000" stopOpacity={0.14} />
        <Stop offset="0.82" stopColor="#000000" stopOpacity={0.04} />
        <Stop offset="1" stopColor="#000000" stopOpacity={0} />
      </RadialGradient>
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

function PanelVolume({ variant, reducedDetail = false }: { variant: JerseyModelVariant; reducedDetail?: boolean }) {
  if (variant === 'basketball' || variant === 'college-basketball') {
    return (
      <>
        {reducedDetail ? null : (
          <>
            <Path d="M24 23 C29 49 29 82 25 110" stroke="#000000" strokeWidth={0.72} strokeOpacity={0.08} fill="none" strokeLinecap="round" />
            <Path d="M76 23 C71 49 71 82 75 110" stroke="#ffffff" strokeWidth={0.62} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
            <Path d="M39 14 C45 43 45 82 41 112" stroke="#ffffff" strokeWidth={0.48} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
            <Path d="M61 14 C55 43 55 82 59 112" stroke="#000000" strokeWidth={0.48} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
          </>
        )}
        <Path d="M28 101 C40 106 60 106 72 101 L75 111 C61 116 39 116 25 111 Z" fill="#000000" fillOpacity={0.045} />
      </>
    );
  }

  const centerFold = variant === 'baseball'
    ? 'M50 23 C48 48 48 80 50 110'
    : 'M50 22 C47 50 47 80 50 111';

  return (
    <>
      {/* Large side / center AO fills read even at thumbnail size — keep them. */}
      <Path d="M21 15 C34 42 33 83 25 113 L7 116 L7 2 Z" fill="#000000" fillOpacity={0.075} />
      <Path d="M79 15 C66 42 67 83 75 113 L93 116 L93 2 Z" fill="#000000" fillOpacity={0.07} />
      <Path d="M39 13 C47 36 46 82 39 113 L53 116 C61 81 60 36 55 13 Z" fill="#ffffff" fillOpacity={0.055} />
      {reducedDetail ? null : (
        <>
          <Path d="M31 18 C38 42 36 78 30 110" stroke="#000000" strokeWidth={0.64} strokeOpacity={0.075} fill="none" strokeLinecap="round" />
          <Path d="M69 18 C62 42 64 78 70 110" stroke="#ffffff" strokeWidth={0.56} strokeOpacity={0.07} fill="none" strokeLinecap="round" />
          <Path d={centerFold} stroke="#000000" strokeWidth={0.45} strokeOpacity={0.085} fill="none" strokeLinecap="round" />
          <Path d="M53 23 C57 51 56 80 52 111" stroke="#ffffff" strokeWidth={0.42} strokeOpacity={0.075} fill="none" strokeLinecap="round" />
        </>
      )}
      <Path d="M23 98 C38 106 62 106 77 98 L79 113 C63 119 37 119 21 113 Z" fill="#000000" fillOpacity={0.055} />
    </>
  );
}

function SportConstruction({
  variant,
  ids,
  secondary,
  accent,
  reducedDetail = false,
}: {
  variant: JerseyModelVariant;
  ids: Record<string, string>;
  secondary: string;
  accent: string;
  reducedDetail?: boolean;
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
        <Path d="M24 103 C39 108 61 108 76 103" stroke={`url(#${ids.trim})`} strokeWidth={1.65} strokeOpacity={0.78} fill="none" strokeLinecap="round" />
        <Path d="M25 109 C39 114 61 114 75 109" stroke={secondary} strokeWidth={0.95} strokeOpacity={0.36} fill="none" strokeLinecap="round" />
      </>
    );
  }

  if (variant === 'football') {
    return (
      <>
        {/* PADDED SHOULDERS — the signature of the football silhouette. Each
            shoulder is built as baked volume: a broad highlight cap catching the
            top-left key light, then a curved AO crease where the pad rolls down
            into the sleeve, so the shoulder reads as a hard foam pad under cloth
            rather than a flat panel. Black/white overlays keep it team-agnostic. */}
        <Path d="M14 30 C24 19 36 21 50 24 C64 21 76 19 86 30 L84 36 C74 28 62 27 50 30 C38 27 26 28 16 36 Z" fill="#ffffff" fillOpacity={0.14} />
        <Path d="M12 41 C26 33 38 34 50 36 C62 34 74 33 88 41 L86 49 C73 43 62 42 50 44 C38 42 27 43 14 49 Z" fill="#000000" fillOpacity={0.16} />
        <Path d="M17 48 C30 43 40 43 50 45 C60 43 70 43 83 48" stroke="#000000" strokeWidth={1.1} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
        {/* Shoulder yoke trim band (the colored pad seam). Run 8: opacity 0.34 ->
            0.82 so the team's secondary reads as a CONFIDENT broadcast accent on
            the pads, not a tinted ghost veiled by the body color underneath. */}
        <Path d="M10 35 C24 25 37 27 50 30 C63 27 76 25 90 35 L88 41 C73 32 62 31 50 33 C38 31 27 32 12 41 Z" fill={`url(#${ids.trim})`} fillOpacity={0.82} />
        {/* Crew collar (full-opacity trim gradient stroke). */}
        <Path d="M39 22 C45 31 55 31 61 22" stroke={`url(#${ids.trim})`} strokeWidth={5.5} fill="none" strokeLinecap="round" />
        <Path d="M42 24 C47 28 53 28 58 24" stroke="#05070a" strokeWidth={1.45} strokeOpacity={0.28} fill="none" strokeLinecap="round" />
        {/* Real short-sleeve cuffs: a trim band wrapping each sleeve end. Run 8:
            0.46 -> 0.92 so the cuffs are a crisp solid accent band. */}
        <Path d="M2 45 L4 56 L17 58 L19 50 C13 49 7 47 4 44 Z" fill={`url(#${ids.trim})`} fillOpacity={0.92} />
        <Path d="M98 45 L96 56 L83 58 L81 50 C87 49 93 47 96 44 Z" fill={`url(#${ids.trim})`} fillOpacity={0.92} />
        <Rect x={24} y={100} width={52} height={4.2} rx={1.6} fill={`url(#${ids.trim})`} fillOpacity={0.82} />
        {/* Fine pad/cuff seam strokes (sub-pixel at thumbnail size) — these are
            the fold highlights + under-cuff shadows that sell the turned cuff and
            the rolled pad edge; dropped below the reduced-detail threshold. */}
        {reducedDetail ? null : (
          <>
            <Path d="M16 34 C28 27 39 27 50 29" stroke="#ffffff" strokeWidth={0.85} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
            <Path d="M84 34 C72 27 61 27 50 29" stroke="#ffffff" strokeWidth={0.85} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
            <Path d="M12 41 C27 32 38 31 50 33 C62 31 73 32 88 41" stroke={secondary} strokeWidth={1.05} strokeDasharray="4,2" strokeOpacity={0.32} fill="none" />
            <Path d="M40 20.5 C45.5 28.5 54.5 28.5 60 20.5" stroke={lighten(secondary, 0.5)} strokeWidth={0.8} strokeOpacity={0.46} fill="none" strokeLinecap="round" />
            <Path d="M3.4 46 C8 49 13 50 18.4 50.6" stroke={lighten(secondary, 0.5)} strokeWidth={0.7} strokeOpacity={0.4} fill="none" strokeLinecap="round" />
            <Path d="M4 53.5 C9 55.5 13 56.5 17.6 57" stroke="#05070a" strokeWidth={0.85} strokeOpacity={0.22} fill="none" strokeLinecap="round" />
            <Path d="M96.6 46 C92 49 87 50 81.6 50.6" stroke={lighten(secondary, 0.5)} strokeWidth={0.7} strokeOpacity={0.4} fill="none" strokeLinecap="round" />
            <Path d="M96 53.5 C91 55.5 87 56.5 82.4 57" stroke="#05070a" strokeWidth={0.85} strokeOpacity={0.22} fill="none" strokeLinecap="round" />
          </>
        )}
      </>
    );
  }

  if (variant === 'baseball') {
    return (
      <>
        {/* Run 8: collar 0.72 -> 0.9, front-placket piping/sleeve piping/hem arc
            opacities lifted so the secondary trim reads as crisp, confident piping
            (bold broadcast) instead of a faint tint over the body flannel. */}
        <Path d="M36 11 C42 22 58 22 64 11 L58 20 C53 25 47 25 42 20 Z" fill={`url(#${ids.trim})`} fillOpacity={0.9} />
        <Path d="M39 14 C44 20 56 20 61 14" stroke="#05070a" strokeWidth={1.55} strokeOpacity={0.24} fill="none" strokeLinecap="round" />
        <Line x1={47.2} y1={21} x2={47.2} y2={109} stroke={`url(#${ids.trim})`} strokeWidth={1.25} strokeOpacity={1} />
        <Line x1={52.8} y1={21} x2={52.8} y2={109} stroke={`url(#${ids.trim})`} strokeWidth={1.25} strokeOpacity={1} />
        <Line x1={50} y1={24} x2={50} y2={109} stroke="#000000" strokeWidth={0.42} strokeOpacity={0.11} />
        {[30, 41, 52, 63, 74, 85].map((y, index) => (
          <Circle key={`button_${index}`} cx={50} cy={y} r={1.55} fill={`url(#${ids.trim})`} stroke="#000000" strokeWidth={0.3} strokeOpacity={0.35} />
        ))}
        <Path d="M36 14 L21 42" stroke={`url(#${ids.trim})`} strokeWidth={1.05} strokeOpacity={0.82} fill="none" strokeLinecap="round" />
        <Path d="M64 14 L79 42" stroke={`url(#${ids.trim})`} strokeWidth={1.05} strokeOpacity={0.82} fill="none" strokeLinecap="round" />
        <Line x1={8} y1={50} x2={18} y2={39} stroke={`url(#${ids.trim})`} strokeWidth={2.9} strokeLinecap="round" />
        <Line x1={92} y1={50} x2={82} y2={39} stroke={`url(#${ids.trim})`} strokeWidth={2.9} strokeLinecap="round" />
        <Path d="M23 107 C36 113 64 113 77 107" stroke={`url(#${ids.trim})`} strokeWidth={1.05} strokeOpacity={0.78} fill="none" strokeLinecap="round" />
      </>
    );
  }

  if (variant === 'hockey') {
    return (
      <>
        {/* Run 8: chest yoke band 0.24 -> 0.5 — a hockey sweater carries a real
            colored chest yoke; bump it to a confident accent, but keep it below the
            hem/crest so the number stays the focus. */}
        <Path d="M9 38 C27 29 38 32 50 34 C62 32 73 29 91 38 L84 50 C63 56 37 56 16 50 Z" fill={`url(#${ids.trim})`} fillOpacity={0.5} />
        <Line x1={16} y1={51} x2={84} y2={51} stroke={secondary} strokeWidth={1.05} strokeDasharray="4,2" strokeOpacity={0.5} />
        <Path d="M40 22 C46 30 54 30 60 22 L50 36 Z" fill="#05070a" fillOpacity={0.24} />
        <Line x1={50} y1={35} x2={43} y2={19} stroke={accent} strokeWidth={1.18} strokeOpacity={0.46} />
        <Line x1={50} y1={35} x2={57} y2={19} stroke={accent} strokeWidth={1.18} strokeOpacity={0.46} />
        {[23, 27, 31].map((y, index) => (
          <Line key={`lace_${index}`} x1={45 + index * 0.8} y1={y} x2={55 - index * 0.8} y2={y} stroke={secondary} strokeWidth={1} strokeOpacity={0.64} />
        ))}
        {/* COORDINATED STRIPE SET. A real hockey sweater hem/cuff is a designed
            band — a wide trim stripe carrying a thin contrast accent stripe down
            its centre — not two unrelated rects with a gap. The accent center
            line ties the hem + both cuffs into one set so the trim reads as
            intentional. The hem band reads at all sizes; the cuff accent center
            lines are sub-pixel-thin so they drop on the thumbnail tier. */}
        {/* Run 8: hem + cuff stripe set lifted to near-solid (0.76->0.95 / 0.66->0.9
            / 0.58->0.92) and the accent center stripes punched up (0.34->0.62) so
            the coordinated trim band reads as a crisp, confident broadcast stripe
            set instead of a faded gradient wash. */}
        <Rect x={17} y={91.5} width={66} height={7.4} rx={1.3} fill={`url(#${ids.trim})`} fillOpacity={0.95} />
        <Rect x={17} y={94.4} width={66} height={1.9} fill={accent} fillOpacity={0.62} />
        <Rect x={17} y={101.5} width={66} height={4.4} rx={1.1} fill={`url(#${ids.trim})`} fillOpacity={0.9} />
        <Rect x={2} y={57.5} width={13} height={6} rx={1} fill={`url(#${ids.trim})`} fillOpacity={0.92} />
        <Rect x={85} y={57.5} width={13} height={6} rx={1} fill={`url(#${ids.trim})`} fillOpacity={0.92} />
        {reducedDetail ? null : (
          <>
            <Rect x={2} y={59.6} width={13} height={1.6} fill={accent} fillOpacity={0.62} />
            <Rect x={85} y={59.6} width={13} height={1.6} fill={accent} fillOpacity={0.62} />
          </>
        )}
        <Line x1={2} y1={67} x2={15} y2={68} stroke={accent} strokeWidth={1.2} strokeOpacity={0.24} />
        <Line x1={85} y1={68} x2={98} y2={67} stroke={accent} strokeWidth={1.2} strokeOpacity={0.24} />
      </>
    );
  }

  if (variant === 'cricket') {
    return (
      <>
        {/* Run 8: collar V 0.72->0.9, shoulder flashes 0.42->0.82, hem arc 0.62->0.82
            and the diagonal sash 0.34->0.78 so the IPL kit's bold colored trim reads
            as confident broadcast accent rather than a faint tint over the body. */}
        <Path d="M36 11 C42 21 58 21 64 11 L58 23 C53 28 47 28 42 23 Z" fill={`url(#${ids.trim})`} fillOpacity={0.9} />
        <Path d="M41 16 L50 29 L59 16" stroke="#05070a" strokeWidth={1.55} strokeOpacity={0.24} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M39 15 L50 31 L61 15" stroke={accent} strokeWidth={0.72} strokeOpacity={0.52} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* Open turn-down collar wings so it reads as a collared cricket shirt. */}
        <Path d="M35 11 L47 13 L49 21 L42 19 Z" fill={`url(#${ids.trim})`} stroke="#05070a" strokeWidth={0.5} strokeOpacity={0.3} strokeLinejoin="round" />
        <Path d="M65 11 L53 13 L51 21 L58 19 Z" fill={`url(#${ids.trim})`} stroke="#05070a" strokeWidth={0.5} strokeOpacity={0.3} strokeLinejoin="round" />
        <Path d="M17 27 L7 42 L14 49 L24 39 L25 32 Z" fill={`url(#${ids.trim})`} fillOpacity={0.82} />
        <Path d="M83 27 L93 42 L86 49 L76 39 L75 32 Z" fill={`url(#${ids.trim})`} fillOpacity={0.82} />
        <Path d="M24 92 C37 98 63 98 76 92" stroke={`url(#${ids.trim})`} strokeWidth={2.2} strokeOpacity={0.82} fill="none" strokeLinecap="round" />
        {/* DESIGNED DIAGONAL FLASH. The old lone diagonal line read as an
            accidental stray mark. A modern IPL kit carries a deliberate diagonal
            sash: a wider trim band with a tight accent pinstripe running parallel
            alongside it — a coordinated set, not one random line. The band reads
            at all sizes; the thin parallel accent piping drops on thumbnails. */}
        <Line x1={24} y1={41} x2={74} y2={101} stroke={`url(#${ids.trim})`} strokeWidth={2.4} strokeOpacity={0.78} strokeLinecap="round" />
        {/* Fine wing highlight / hem + diagonal accent piping — sub-pixel at thumbnail. */}
        {reducedDetail ? null : (
          <>
            <Path d="M35.4 11.6 L46.6 13.4 M64.6 11.6 L53.4 13.4" stroke={lighten(secondary, 0.5)} strokeWidth={0.46} strokeOpacity={0.42} strokeLinecap="round" />
            <Path d="M24 100 C38 106 62 106 76 100" stroke={accent} strokeWidth={0.82} strokeOpacity={0.22} fill="none" strokeLinecap="round" />
            <Line x1={27.6} y1={40.4} x2={77.6} y2={100.4} stroke={accent} strokeWidth={0.6} strokeOpacity={0.32} strokeLinecap="round" />
            <Line x1={22.2} y1={42} x2={72.2} y2={102} stroke={lighten(secondary, 0.5)} strokeWidth={0.42} strokeOpacity={0.3} strokeLinecap="round" />
          </>
        )}
      </>
    );
  }

  if (variant === 'tennis') {
    return (
      <>
        {/* Sleeve cuff trims (cap sleeves). Run 8: 0.34 -> 0.78 so the cap-sleeve
            tipping reads as a crisp colored band. */}
        <Path d="M18 27 L8 41 L15 48 L24 39 L25 33 Z" fill={`url(#${ids.trim})`} fillOpacity={0.78} />
        <Path d="M82 27 L92 41 L85 48 L76 39 L75 33 Z" fill={`url(#${ids.trim})`} fillOpacity={0.78} />
        {/* Polo placket: a short button strip below the collar with a shaded
            fold edge + two buttons — the defining cut that separates a tennis
            polo from a soccer crew. Run 8: 0.5 -> 0.8 so the placket is a clear
            colored strip. */}
        <Path d="M46.4 24 L46.4 41 L53.6 41 L53.6 24 Z" fill={`url(#${ids.trim})`} fillOpacity={0.8} />
        {/* Turn-down polo collar: two pointed wings with a centre notch, set on
            an inner-neck shadow so the fold reads with depth. */}
        <Path d="M36 12 C42 20 58 20 64 12 L58 23 C53 27 47 27 42 23 Z" fill="#05070a" fillOpacity={0.2} />
        <Path d="M35 11 L48 14 L50 24 L42 22 Z" fill={`url(#${ids.trim})`} stroke="#05070a" strokeWidth={0.55} strokeOpacity={0.34} strokeLinejoin="round" />
        <Path d="M65 11 L52 14 L50 24 L58 22 Z" fill={`url(#${ids.trim})`} stroke="#05070a" strokeWidth={0.55} strokeOpacity={0.34} strokeLinejoin="round" />
        {/* Hem trim. Run 8: 0.52 -> 0.82 — crisp confident hem band. */}
        <Path d="M24 89 C37 95 63 95 76 89" stroke={`url(#${ids.trim})`} strokeWidth={1.8} strokeOpacity={0.82} fill="none" strokeLinecap="round" />
        {/* Fine placket seams, collar-wing highlights, buttons + hem accent —
            sub-pixel at thumbnail (buttons r=1.1u ~0.37px at 34px). */}
        {reducedDetail ? null : (
          <>
            <Line x1={50} y1={25} x2={50} y2={41} stroke="#05070a" strokeWidth={0.5} strokeOpacity={0.2} />
            <Line x1={46.7} y1={24.5} x2={46.7} y2={41} stroke={lighten(secondary, 0.5)} strokeWidth={0.42} strokeOpacity={0.4} />
            {[29, 36].map((cy, index) => (
              <Circle key={`tennis_button_${index}`} cx={50} cy={cy} r={1.1} fill={lighten(secondary, 0.3)} stroke="#05070a" strokeWidth={0.32} strokeOpacity={0.4} />
            ))}
            <Path d="M36.4 11.6 L47.6 14.4" stroke={lighten(secondary, 0.5)} strokeWidth={0.5} strokeOpacity={0.46} strokeLinecap="round" />
            <Path d="M63.6 11.6 L52.4 14.4" stroke={lighten(secondary, 0.5)} strokeWidth={0.5} strokeOpacity={0.46} strokeLinecap="round" />
            <Path d="M24 100 C38 106 62 106 76 100" stroke={accent} strokeWidth={0.82} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
          </>
        )}
      </>
    );
  }

  const ucl = variant === 'ucl';
  return (
    <>
      {/* RAGLAN + side-panel + cuff seams — the fine stitch lines that make the
          kit read as engineered panels rather than a plain tee. All are <=0.78u
          strokes that go sub-pixel at thumbnail size, so they drop on the
          reduced-detail tier while the collar / cuff fills / hem (which read at
          34px) stay. */}
      {reducedDetail ? null : (
        <>
          <Path d="M38 14 C30 22 26 30 25 37" stroke="#05070a" strokeWidth={0.78} strokeOpacity={0.22} fill="none" strokeLinecap="round" />
          <Path d="M38.8 14.6 C31 22.6 26.8 30.4 25.8 37" stroke={lighten(secondary, 0.5)} strokeWidth={0.46} strokeOpacity={0.4} fill="none" strokeLinecap="round" />
          <Path d="M62 14 C70 22 74 30 75 37" stroke="#05070a" strokeWidth={0.78} strokeOpacity={0.22} fill="none" strokeLinecap="round" />
          <Path d="M61.2 14.6 C69 22.6 73.2 30.4 74.2 37" stroke={lighten(secondary, 0.5)} strokeWidth={0.46} strokeOpacity={0.4} fill="none" strokeLinecap="round" />
          <Path d="M30 40 C28 64 28 88 31 106" stroke="#05070a" strokeWidth={0.6} strokeOpacity={0.16} fill="none" strokeLinecap="round" />
          <Path d="M70 40 C72 64 72 88 69 106" stroke="#ffffff" strokeWidth={0.5} strokeOpacity={0.1} fill="none" strokeLinecap="round" />
        </>
      )}
      {/* Ribbed crew collar: inner-neck shadow (depth) -> rib band -> top fold
          highlight + under-rib seam, so the opening reads as folded cloth with
          volume instead of a single flat arc. */}
      <Path d="M37 13 C42 21 58 21 63 13 C58 18 42 18 37 13 Z" fill="#05070a" fillOpacity={0.26} />
      <Ellipse cx={50} cy={16} rx={9.5} ry={4.5} fill="#05070a" fillOpacity={0.16} />
      <Path d="M36 11 C42 20 58 20 64 11" stroke={`url(#${ids.trim})`} strokeWidth={3.7} fill="none" strokeLinecap="round" />
      <Path d="M37.4 10.4 C42.6 18.6 57.4 18.6 62.6 10.4" stroke={lighten(secondary, 0.5)} strokeWidth={0.78} strokeOpacity={0.5} fill="none" strokeLinecap="round" />
      <Path d="M38.4 13.2 C43 20.4 57 20.4 61.6 13.2" stroke="#05070a" strokeWidth={0.72} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
      {/* Sleeve cuffs (fills read at all sizes; turned-cuff seams drop on thumbs).
          Run 8: 0.34 -> 0.78 so the cuff tipping reads as a crisp colored band. */}
      <Path d="M17 27 L8 39 L15 46 L25 37 L26 31 Z" fill={`url(#${ids.trim})`} fillOpacity={0.78} />
      <Path d="M83 27 L92 39 L85 46 L75 37 L74 31 Z" fill={`url(#${ids.trim})`} fillOpacity={0.78} />
      {reducedDetail ? null : (
        <>
          <Path d="M9.6 40 L24 37.4" stroke={lighten(secondary, 0.5)} strokeWidth={0.5} strokeOpacity={0.42} fill="none" strokeLinecap="round" />
          <Path d="M90.4 40 L76 37.4" stroke={lighten(secondary, 0.5)} strokeWidth={0.5} strokeOpacity={0.42} fill="none" strokeLinecap="round" />
          <Path d="M14 44 L24 39" stroke="#05070a" strokeWidth={0.55} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
          <Path d="M86 44 L76 39" stroke="#05070a" strokeWidth={0.55} strokeOpacity={0.2} fill="none" strokeLinecap="round" />
        </>
      )}
      {/* Double hem band (trim reads at 34px; lit fold edge drops on thumbs).
          Run 8: 0.54 -> 0.82 — crisp confident hem band. */}
      <Line x1={22} y1={105} x2={78} y2={105} stroke={`url(#${ids.trim})`} strokeWidth={1.65} strokeOpacity={0.82} strokeLinecap="round" />
      {reducedDetail ? null : (
        <Line x1={22} y1={103.2} x2={78} y2={103.2} stroke={lighten(secondary, 0.4)} strokeWidth={0.5} strokeOpacity={0.34} strokeLinecap="round" />
      )}
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

// A real nameplate / chest-script arc. `arc` is the rise of the baseline (in
// viewBox units): positive bows the word upward (a smile, e.g. a nameplate
// curving over a back number), negative bows it downward. We build ONE quadratic
// arc path per line and run the whole word along it with <TextPath>, so an arced
// label costs the same node count as a flat one (one text element per pass, not
// one per glyph). A small overshoot on the half-width makes the curve read
// confidently rather than nearly-flat.
function labelArcPath(cx: number, baselineY: number, halfWidth: number, arc: number): string {
  const span = halfWidth + Math.max(2.4, halfWidth * 0.16);
  const x0 = cx - span;
  const x1 = cx + span;
  // Quadratic control lifts the midpoint by `arc` so the chord stays on the
  // baseline at the word ends and bows at the centre.
  const ctrlY = baselineY - arc * 2;
  return `M${x0.toFixed(2)} ${baselineY.toFixed(2)} Q${cx.toFixed(2)} ${ctrlY.toFixed(2)} ${x1.toFixed(2)} ${baselineY.toFixed(2)}`;
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
  arc = 0,
  arcId,
  stitch = true,
  surface,
  surfaceAccent,
  reducedDetail = false,
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
  arc?: number;
  arcId?: string;
  stitch?: boolean;
  surface?: string;
  surfaceAccent?: string;
  reducedDetail?: boolean;
}) {
  const targetMaxWidth = maxWidth ? wordmarkInnerWidth(maxWidth, fontSize) : undefined;
  const layout = fittedLabelLayout(label, fontSize, targetMaxWidth, minFontSize ?? 6.8);
  const transform = rotation ? `rotate(${rotation} ${x} ${y})` : undefined;
  const baselineStart = y - ((layout.lines.length - 1) * layout.lineHeight) / 2;
  const lineYs = layout.lines.map((_, index) => baselineStart + index * layout.lineHeight);
  const lineWidths = layout.lines.map((line) => estimatedTextWidth(line, layout.fontSize));
  // Arc only the front-and-centre single-line marks (multi-line nameplates fall
  // back to flat so the stacked lines stay legible). The arc id namespaces the
  // per-line paths to this label instance so multiple jerseys never collide.
  const arcActive = arc !== 0 && layout.lines.length === 1 && !!arcId;
  const arcPaths = arcActive
    ? lineYs.map((lineY, index) => `${arcId}_l${index}`)
    : [];
  // Optical kerning. Real block/varsity jersey lettering is set TIGHT — the
  // letters nearly touch. A small negative tracking (~3% of the cap height for
  // numerals/short marks, eased back toward 0 for longer wordmarks so they never
  // collide) reads as a designed set rather than default system spacing. It is a
  // single attribute on the existing text node (zero added nodes). Because the
  // tracking is negative, the rendered width is slightly *under* the estimator's
  // value, so it can never overflow the fitted maxWidth — it only ever tightens.
  const compactLen = label.replace(/\s/g, '').length;
  const tracking = -layout.fontSize * (compactLen <= 3 ? 0.03 : compactLen <= 6 ? 0.022 : 0.014);
  // A glyph pass: flat text uses x/y; an arced pass runs the same string along
  // its line's arc path via <TextPath>, keeping one text node per pass.
  const glyph = (
    key: string,
    line: string,
    index: number,
    dx: number,
    dy: number,
    textProps: Record<string, unknown>,
  ) => {
    if (arcActive) {
      return (
        <SvgText
          key={key}
          textAnchor="middle"
          fontSize={layout.fontSize}
          fontWeight="900"
          fontFamily={WORDMARK_FONT_FAMILY}
          letterSpacing={tracking}
          {...textProps}
        >
          <TextPath href={`#${arcPaths[index]}`} startOffset="50%">
            {line}
          </TextPath>
        </SvgText>
      );
    }
    return (
      <SvgText
        key={key}
        x={x + dx}
        y={lineYs[index] + dy}
        textAnchor="middle"
        fontSize={layout.fontSize}
        fontWeight="900"
        fontFamily={WORDMARK_FONT_FAMILY}
        letterSpacing={tracking}
        {...textProps}
      >
        {line}
      </SvgText>
    );
  };
  // BROADCAST-GRADE LETTERING (run 7). The goal is EA Sports / ESPN team-graphic
  // typography: bold, big, crisp, high-contrast. Earlier runs muddied the fill and
  // outline toward the body color and stacked low-opacity haze passes — that read
  // soft/washed. Now the fill is PURE and punchy, the outline is a CRISP full-
  // opacity twill border, and a thin hard keyline rings the whole mark so the
  // edges snap. Dimension is kept honest (one tight drop shadow + one raised inner
  // emboss) but never at the cost of crispness.
  const outerStroke = Math.max(1.15, Math.min(3.1, layout.fontSize * 0.215));
  const keylineStroke = outerStroke + Math.max(0.42, layout.fontSize * 0.07);
  const insetStroke = Math.max(0.24, Math.min(0.6, layout.fontSize * 0.045));
  const stitchStroke = Math.max(0.18, Math.min(0.42, layout.fontSize * 0.035));
  const stitchDash = `${Math.max(0.52, layout.fontSize * 0.09)},${Math.max(1.08, layout.fontSize * 0.18)}`;
  const lightThread = lighten(fill, luminance(fill) > 0.58 ? 0.2 : 0.42);
  const darkThread = darken(fill, luminance(fill) > 0.58 ? 0.36 : 0.22);
  const jerseySurface = surface ?? mixColor(fill, stroke, 0.22);
  // PUNCHY FILL: keep the contrast-guard color essentially pure (only a hair of
  // integration so it isn't a 100% flat laminate chip), instead of the old heavy
  // 7-12% mix toward the body that washed it out.
  const integratedFill = mixColor(fill, jerseySurface, luminance(fill) > 0.62 ? 0.05 : 0.03);
  // CRISP OUTLINE: the true outline color (no muddying toward the body) at full
  // strength, so the tackle-twill border is clean and high-contrast.
  const integratedStroke = stroke;
  // The hard outer keyline is the opposite-value of the outline so the whole mark
  // is ringed by a clean broadcast edge that pops off the cloth at a glance.
  const keylineColor = luminance(stroke) > 0.5 ? '#06080c' : '#ffffff';
  const fabricShadow = darken(jerseySurface, 0.5);
  // TWO-PLY TACKLE-TWILL satin rim — a thin crisp highlight on the upper edge of
  // the fill so the top ply reads raised. Kept in the fill family so it never
  // fights the contrast guard.
  const topPlyRim = lighten(integratedFill, luminance(integratedFill) > 0.6 ? 0.1 : 0.26);
  const topPlyRimStroke = Math.max(0.2, Math.min(0.6, layout.fontSize * 0.055));

  return (
    <G transform={transform}>
      {arcActive
        ? lineYs.map((lineY, index) => (
            <Path
              key={`applique_arc_${arcPaths[index]}`}
              id={arcPaths[index]}
              d={labelArcPath(x, lineY, lineWidths[index] / 2, arc)}
              fill="none"
            />
          ))
        : null}
      {/* Tight cast shadow on the cloth below the mark — grounds the applique so it
          reads as raised twill, not paint. Crisp and short, not a soft halo. */}
      {reducedDetail ? null : layout.lines.map((line, index) => (
        <Path
          key={`applique_shadow_${line}_${index}`}
          d={`M${x - lineWidths[index] / 2} ${lineYs[index] + layout.fontSize * 0.34} C${x - lineWidths[index] * 0.22} ${lineYs[index] + layout.fontSize * 0.45} ${x + lineWidths[index] * 0.22} ${lineYs[index] + layout.fontSize * 0.45} ${x + lineWidths[index] / 2} ${lineYs[index] + layout.fontSize * 0.34}`}
          stroke={fabricShadow}
          strokeWidth={Math.max(0.4, layout.fontSize * 0.045)}
          strokeOpacity={0.2}
          strokeLinecap="round"
          fill="none"
        />
      ))}
      {/* CRISP CAST SHADOW: a real offset drop shadow of the glyph (down-right) at
          broadcast strength — gives the lettering hard punchy pop off the cloth
          instead of the old soft 0.1 blur stroke. */}
      {reducedDetail ? null : layout.lines.map((line, index) => glyph(
        `applique_depth_${line}_${index}`,
        line,
        index,
        Math.max(0.18, layout.fontSize * 0.03),
        Math.max(0.26, layout.fontSize * 0.05),
        {
          fill: 'none',
          stroke: keylineColor,
          strokeWidth: keylineStroke,
          strokeOpacity: keylineColor === '#ffffff' ? 0.22 : 0.34,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        },
      ))}
      {/* HARD KEYLINE: a clean high-contrast edge ringing the whole mark (the
          opposite value of the outline) so the broadcast graphic snaps off the
          body at a glance. This is the crisp outer border, drawn under the twill
          border so the twill sits cleanly inside it. */}
      {layout.lines.map((line, index) => glyph(
        `applique_keyline_${line}_${index}`,
        line,
        index,
        0,
        0,
        {
          fill: 'none',
          stroke: keylineColor,
          strokeWidth: keylineStroke,
          strokeOpacity: 1,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        },
      ))}
      {/* CRISP TWILL BORDER: the true outline color at full strength — a clean,
          confident, high-contrast applique edge (no muddying toward the body). */}
      {layout.lines.map((line, index) => glyph(
        `applique_outline_${line}_${index}`,
        line,
        index,
        0,
        0,
        {
          fill: 'none',
          stroke: integratedStroke,
          strokeWidth: outerStroke,
          strokeOpacity: 1,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        },
      ))}
      {/* PUNCHY FILL: pure contrast-guard color, fully opaque. */}
      {layout.lines.map((line, index) => glyph(
        `applique_fill_${line}_${index}`,
        line,
        index,
        0,
        0,
        { fill: integratedFill, fillOpacity: 1 },
      ))}
      {reducedDetail ? null : (
        <>
          {/* TWO-PLY satin rim — crisp bright top-ply edge so the fill reads as a
              raised stitched ply. */}
          {layout.lines.map((line, index) => glyph(
            `applique_top_ply_${line}_${index}`,
            line,
            index,
            0,
            0,
            {
              fill: 'none',
              stroke: topPlyRim,
              strokeWidth: topPlyRimStroke,
              strokeOpacity: 0.6,
              strokeLinejoin: 'round',
              strokeLinecap: 'round',
            },
          ))}
          {/* RAISED EMBOSS: one crisp inner shadow on the lower edge of the fill +
              one crisp inner highlight on the upper edge, so the twill reads
              embossed (raised) without a soft haze that would mud the fill. */}
          {layout.lines.map((line, index) => glyph(
            `applique_surface_shadow_${line}_${index}`,
            line,
            index,
            0,
            Math.max(0.14, layout.fontSize * 0.02),
            {
              fill: 'none',
              stroke: darkThread,
              strokeWidth: insetStroke,
              strokeOpacity: 0.32,
              strokeLinejoin: 'round',
              strokeLinecap: 'round',
            },
          ))}
          {layout.lines.map((line, index) => glyph(
            `applique_inset_${line}_${index}`,
            line,
            index,
            0,
            -Math.max(0.12, layout.fontSize * 0.016),
            {
              fill: 'none',
              stroke: lightThread,
              strokeWidth: insetStroke * 0.86,
              strokeOpacity: 0.34,
              strokeLinejoin: 'round',
              strokeLinecap: 'round',
            },
          ))}
        </>
      )}
      {stitch && !reducedDetail
        ? layout.lines.map((line, index) => glyph(
            `applique_stitch_${line}_${index}`,
            line,
            index,
            0,
            0,
            {
              fill: 'none',
              stroke: lightThread,
              strokeWidth: stitchStroke,
              strokeDasharray: stitchDash,
              strokeOpacity: 0.3,
              strokeLinejoin: 'round',
              strokeLinecap: 'round',
            },
          ))
        : null}
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
        {/* Run 8: crest 0.76 -> 0.9 + crisper accent ring — a solid colored badge. */}
        <Circle cx={x} cy={y} r={5.8} fill={`url(#${ids.trim})`} fillOpacity={0.9} stroke={accent} strokeWidth={0.85} strokeOpacity={0.62} />
        <Path d={`M${x - 3.7} ${y + 3.2} L${x + 3.8} ${y - 3.2}`} stroke={stroke} strokeWidth={0.78} strokeOpacity={0.44} strokeLinecap="round" />
        {showMark ? (
          <SvgText x={x} y={y + 2.1} textAnchor="middle" fontSize={4.5} fontWeight="900" fontFamily={WORDMARK_FONT_FAMILY} fill={fill} stroke={stroke} strokeWidth={0.42}>
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
        <Path d={`M${x} ${y - 5.6} L${x + 5.2} ${y} L${x} ${y + 5.6} L${x - 5.2} ${y} Z`} fill={`url(#${ids.trim})`} fillOpacity={0.9} stroke={accent} strokeWidth={0.78} strokeOpacity={0.6} />
        {showMark ? (
          <SvgText x={x} y={y + 1.9} textAnchor="middle" fontSize={4.3} fontWeight="900" fontFamily={WORDMARK_FONT_FAMILY} fill={fill} stroke={stroke} strokeWidth={0.38}>
            {mark}
          </SvgText>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Path d={`M${x - 5.8} ${y - 6} L${x + 5.8} ${y - 6} L${x + 4.9} ${y + 3.6} Q${x} ${y + 7.8} ${x - 4.9} ${y + 3.6} Z`} fill="#000000" fillOpacity={0.22} />
      <Path d={`M${x - 4.9} ${y - 5.1} L${x + 4.9} ${y - 5.1} L${x + 4.1} ${y + 2.9} Q${x} ${y + 6.5} ${x - 4.1} ${y + 2.9} Z`} fill={`url(#${ids.trim})`} fillOpacity={0.9} stroke={accent} strokeWidth={0.8} strokeOpacity={0.62} />
      <Path d={`M${x - 2.9} ${y - 2.4} L${x + 2.9} ${y - 2.4}`} stroke="#ffffff" strokeWidth={0.62} strokeOpacity={0.22} strokeLinecap="round" />
      {showMark ? (
        <SvgText x={x} y={y + 1.9} textAnchor="middle" fontSize={4.2} fontWeight="900" fontFamily={WORDMARK_FONT_FAMILY} fill={fill} stroke={stroke} strokeWidth={0.38}>
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
  number,
  shape,
  ids,
  fill,
  stroke,
  accent,
  surface,
  reducedDetail = false,
}: {
  variant: JerseyModelVariant;
  label: string;
  wordmark: string;
  number: string;
  shape: ModelShape;
  ids: Record<string, string>;
  fill: string;
  stroke: string;
  accent: string;
  surface: string;
  reducedDetail?: boolean;
}) {
  const fontSize = jerseyFontSize(label, variant);
  const wordSize = wordmarkFontSize(wordmark, variant);
  const wordIsLabel = sameMark(wordmark, label);
  // Namespace arc-baseline paths to this jersey instance so multiple cards on a
  // screen never share a <Path id>. Derived from the already-unique clip id.
  const arcBase = `arc_${ids.clip}`;

  if (variant === 'hockey') {
    return (
      <>
        <Ellipse cx={50} cy={64} rx={17.5} ry={13.4} fill="#000000" fillOpacity={0.24} />
        {/* Run 8: crest oval 0.66 -> 0.9 + a crisper accent ring so the chest crest
            reads as a solid, confident colored patch the number sits on. */}
        <Ellipse cx={50} cy={63.2} rx={16} ry={12} fill={`url(#${ids.trim})`} fillOpacity={0.9} stroke={accent} strokeWidth={0.9} strokeOpacity={0.6} />
        <Ellipse cx={47.5} cy={59} rx={10.5} ry={2.8} fill="#ffffff" fillOpacity={0.17} />
        <EmbroideredLabel x={50} y={shape.labelY} label={label} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={fontSize} maxWidth={28} />
        {!wordIsLabel ? (
          <EmbroideredLabel x={50} y={84} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={54} minFontSize={7.8} arc={3.4} arcId={`${arcBase}_word`} />
        ) : null}
      </>
    );
  }

  if (variant === 'soccer' || variant === 'ucl') {
    return (
      <>
        <LegalSafeCrest x={34} y={42.5} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="circle" />
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={48} minFontSize={7.4} />
      </>
    );
  }

  if (variant === 'cricket') {
    return (
      <>
        <LegalSafeCrest x={35} y={45} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="circle" />
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={48} minFontSize={7.4} arc={3} arcId={`${arcBase}_word`} />
        <Path d="M31 72 C42 76 58 77 70 72" stroke={stroke} strokeWidth={0.9} strokeOpacity={0.16} strokeLinecap="round" fill="none" />
      </>
    );
  }

  if (variant === 'tennis') {
    return (
      <>
        <LegalSafeCrest x={35} y={45} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="circle" />
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={54} minFontSize={7.8} />
        <Path d="M32 72 C43 75 57 75 68 72" stroke={stroke} strokeWidth={0.82} strokeOpacity={0.14} strokeLinecap="round" fill="none" />
      </>
    );
  }

  if (variant === 'baseball') {
    return (
      <>
        <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={68} minFontSize={8.8} arc={3.8} arcId={`${arcBase}_word`} />
        <LegalSafeCrest x={85} y={42} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="shield" />
        <Rect x={31} y={98} width={12} height={3.4} rx={0.9} fill={accent} fillOpacity={0.62} />
        <Rect x={57} y={98} width={12} height={3.4} rx={0.9} fill={`url(#${ids.trim})`} fillOpacity={0.82} />
      </>
    );
  }

  if (variant === 'football') {
    return (
      <>
        <EmbroideredLabel x={shape.labelX} y={54.5} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={52} minFontSize={7.8} />
        {/* Big weighted front number under the chest wordmark — the hero of the
            football front. Real broadcast football fronts are number-forward and
            dominant; enlarged (run 7: 19 -> 22) and owning the lower chest under
            the pads. */}
        <EmbroideredLabel x={50} y={88} label={number} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={22} maxWidth={34} />
        {/* TV numbers: small twill numbers on each shoulder pad — a real football
            cue — sitting on the padded yoke, not empty placeholder flashes. */}
        <EmbroideredLabel x={20} y={43} label={number} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={6.4} maxWidth={13} stitch={false} />
        <EmbroideredLabel x={80} y={43} label={number} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={6.4} maxWidth={13} stitch={false} />
      </>
    );
  }

  if (variant === 'basketball' || variant === 'college-basketball') {
    const basketballWordSize = jerseyWordmarkFontSize(wordmark, variant);
    const y = shape.labelY;

    return (
      <>
        <EmbroideredLabel x={shape.labelX} y={y} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={basketballWordSize} maxWidth={52} minFontSize={8.2} />
      </>
    );
  }

  return (
    <>
      <LegalSafeCrest x={38} y={43} label={label} ids={ids} fill={fill} stroke={stroke} accent={accent} showMark={!wordIsLabel} shape="diamond" />
      <EmbroideredLabel x={shape.labelX} y={shape.labelY} label={wordmark} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={50} minFontSize={7.4} />
      {!wordIsLabel ? (
        <EmbroideredLabel x={50} y={77} label={safeLabel(label, 2)} fill={fill} stroke={stroke} surface={surface} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={fontSize} maxWidth={22} />
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
  const reducedDetail = size < REDUCED_DETAIL_THRESHOLD;

  return (
    <Svg width={size} height={size * 1.16} viewBox="0 0 100 116" fill="none">
      <Defs>
        <ClipPath id={ids.clip}>
          <Path d={body} />
        </ClipPath>
        {/* Bold-graphic body ramp (run 7) — saturated team color, tighter
            highlight, confident hem shadow. Matches the shared ModelDefs ramp. */}
        <SvgLinearGradient id={ids.body} x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor={lighten(primary, 0.18)} stopOpacity={1} />
          <Stop offset="0.18" stopColor={lighten(primary, 0.07)} stopOpacity={1} />
          <Stop offset="0.5" stopColor={primary} stopOpacity={1} />
          <Stop offset="0.82" stopColor={darken(primary, 0.18)} stopOpacity={1} />
          <Stop offset="1" stopColor={darken(primary, 0.36)} stopOpacity={1} />
        </SvgLinearGradient>
        {/* Trim ramp — vivid across the whole band (run 8: shallower dark falloff
            so the near-solid panels/binding stay punchy at both ends). */}
        <SvgLinearGradient id={ids.trim} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={lighten(secondary, 0.2)} stopOpacity={1} />
          <Stop offset="0.55" stopColor={secondary} stopOpacity={1} />
          <Stop offset="1" stopColor={darken(secondary, 0.18)} stopOpacity={1} />
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
        {/* Form-shadow core — wraps the tank flanks/hem so the torso reads round
            rather than as a flat diagonal sheet (see ModelDefs note). */}
        <RadialGradient id={ids.core} cx="50%" cy="40%" r="72%">
          <Stop offset="0" stopColor="#000000" stopOpacity={0} />
          <Stop offset="0.54" stopColor="#000000" stopOpacity={0} />
          <Stop offset="0.83" stopColor="#000000" stopOpacity={0.06} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0.18} />
        </RadialGradient>
        {/* Soft feathered contact shadow (see ModelDefs note). */}
        <RadialGradient id={ids.contact} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#000000" stopOpacity={0.24} />
          <Stop offset="0.55" stopColor="#000000" stopOpacity={0.13} />
          <Stop offset="0.82" stopColor="#000000" stopOpacity={0.04} />
          <Stop offset="1" stopColor="#000000" stopOpacity={0} />
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
        <SvgLinearGradient id={ids.sheen} x1="0.16" y1="0.06" x2="0.72" y2="0.58">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="0.18" stopColor="#ffffff" stopOpacity={0.14} />
          <Stop offset="0.3" stopColor="#ffffff" stopOpacity={0.035} />
          <Stop offset="0.48" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>

      <Ellipse cx={50} cy={109} rx={30} ry={6.2} fill={`url(#${ids.contact})`} />
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
        <Rect x={0} y={0} width={100} height={116} fill={`url(#${ids.core})`} />
        <Rect x={0} y={0} width={100} height={116} fill={`url(#${ids.sheen})`} />
        {/* Contrast SIDE PANELS with piping — the signature cut-and-sewn detail of
            a modern NBA/NCAAB tank. A secondary-toned panel hugs each torso edge
            from armhole to hem, bounded by a piping seam (lit edge + dark stitch)
            so the body reads as a paneled garment, not a single sheet. The panel
            also carries the rounded-torso AO. */}
        {/* Run 8: side panels 0.5/0.46 -> 0.92/0.88 so each panel reads as a
            DISTINCT secondary-colored textile (confident broadcast contrast),
            not a tint of the body. The panel value falloff (dark hem pool + lit
            armhole cap) and piping seams still layer on top to keep the volume. */}
        <Path d="M24 47 L33 47 C34 65 34 89 31 108 L24 108 Z" fill={`url(#${ids.trim})`} fillOpacity={0.92} />
        <Path d="M76 47 L67 47 C66 65 66 89 69 108 L76 108 Z" fill={`url(#${ids.trim})`} fillOpacity={0.88} />
        {/* Panel value falloff: each side panel is a SEPARATE textile, so it
            carries its own light — a darker pooled shadow at the hem and a lit
            cap up at the armhole — instead of a flat single-opacity stripe (the
            "colored stripe, not a panel" tell). Two fills per panel, render at
            all sizes since they read as shading, not micro-detail. */}
        <Path d="M24 84 L33 84 C33 95 32 102 31 108 L24 108 Z" fill="#000000" fillOpacity={0.16} />
        <Path d="M76 84 L67 84 C67 95 68 102 69 108 L76 108 Z" fill="#000000" fillOpacity={0.16} />
        <Path d="M24 47 L33 47 C33.6 56 33.8 63 33.6 68 L24 68 Z" fill="#ffffff" fillOpacity={0.075} />
        <Path d="M76 47 L67 47 C66.4 56 66.2 63 66.4 68 L76 68 Z" fill="#ffffff" fillOpacity={0.06} />
        {reducedDetail ? null : (
          <>
            {/* Piping seam between panel and body: dark stitch + lit fold edge. */}
            <Path d="M33 47 C34 65 34 89 31 108" stroke="#05070a" strokeWidth={0.9} strokeOpacity={0.26} fill="none" strokeLinecap="round" />
            <Path d="M33.8 47 C34.8 65 34.8 89 31.8 108" stroke={lighten(secondary, 0.5)} strokeWidth={0.5} strokeOpacity={0.46} fill="none" strokeLinecap="round" />
            <Path d="M67 47 C66 65 66 89 69 108" stroke="#05070a" strokeWidth={0.9} strokeOpacity={0.26} fill="none" strokeLinecap="round" />
            <Path d="M66.2 47 C65.2 65 65.2 89 68.2 108" stroke={lighten(secondary, 0.5)} strokeWidth={0.5} strokeOpacity={0.46} fill="none" strokeLinecap="round" />
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
          </>
        )}
      </G>

      {/* Rounded neck BINDING reading cut-and-sewn: a cast AO just below the
          binding (it sits proud of the chest), the colored binding band, a top
          fold highlight catching the key light, and a tight inner seam line. */}
      <Path d="M37 11 C40 23 45 32 50 32 C55 32 60 23 63 11 C60 20 55 27 50 27 C45 27 40 20 37 11 Z" fill="#000000" fillOpacity={0.14} />
      <Path d="M36 9 C39 21 45 30 50 30 C55 30 61 21 64 9" stroke={`url(#${ids.trim})`} strokeWidth={5.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M37 8.2 C40 19.6 45.6 28 50 28 C54.4 28 60 19.6 63 8.2" stroke={lighten(secondary, 0.5)} strokeWidth={0.92} strokeOpacity={0.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M40 11 C43 20 46 26 50 26 C54 26 57 20 60 11" stroke="#05070a" strokeWidth={1.8} strokeOpacity={0.28} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M24 101 C38 106 62 106 76 101" stroke={`url(#${ids.trim})`} strokeWidth={1.65} strokeOpacity={0.72} fill="none" strokeLinecap="round" />

      <Path d={body} stroke="#000000" strokeWidth={1.55} strokeOpacity={0.12} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={body} stroke={`url(#${ids.rim})`} strokeWidth={0.95} strokeOpacity={0.42} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={body} stroke={secondary} strokeWidth={0.52} strokeOpacity={0.18} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={body} fill={`url(#${ids.glass})`} />
      {/* Under-arm AO where the armhole binding sews to the body — the curved
          shadow that makes the armhole read as a cut-and-sewn opening. */}
      <Path d="M28 30 C31 38 31 44 29.5 48 L33 48 C34 43 33 37 31 31 Z" fill="#000000" fillOpacity={0.12} />
      <Path d="M72 30 C69 38 69 44 70.5 48 L67 48 C66 43 67 37 69 31 Z" fill="#000000" fillOpacity={0.12} />
      <Path d="M23 18 C29 29 29 38 28 47 L24 47 C25 38 24 28 19 21 Z" fill={`url(#${ids.trim})`} />
      <Path d="M77 18 C71 29 71 38 72 47 L76 47 C75 38 76 28 81 21 Z" fill={`url(#${ids.trim})`} />
      <Path d="M24.4 20 C29.1 30 29.8 39 28.4 47" stroke={lighten(secondary, 0.5)} strokeWidth={0.82} strokeOpacity={0.42} fill="none" strokeLinecap="round" />
      <Path d="M75.6 20 C70.9 30 70.2 39 71.6 47" stroke={lighten(secondary, 0.5)} strokeWidth={0.82} strokeOpacity={0.42} fill="none" strokeLinecap="round" />
      <Path d="M27 22 C30 32 30 39 29 47" stroke="#05070a" strokeWidth={1.08} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
      <Path d="M73 22 C70 32 70 39 71 47" stroke="#05070a" strokeWidth={1.08} strokeOpacity={0.18} fill="none" strokeLinecap="round" />

      <G clipPath={`url(#${ids.clip})`}>
        <EmbroideredLabel x={50} y={51.5} label={wordmark} fill={detail} stroke={outline} surface={primary} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={wordSize} maxWidth={52} minFontSize={8.2} />
        {/* The front number is the DOMINANT chest element on a real NBA/NCAAB tank
            and the hero of a broadcast team graphic — enlarged to a confident
            broadcast scale (run 7: 18 -> 21) and centred low in the open chest
            with breathing room above the hem. The wordmark sits above it as the
            supporting line so the hierarchy reads number-first. */}
        <EmbroideredLabel x={50} y={81} label={number} fill={detail} stroke={outline} surface={primary} surfaceAccent={accent} reducedDetail={reducedDetail} fontSize={21} maxWidth={32} />
      </G>
      <Path d={body} fill={`url(#${ids.glass})`} fillOpacity={0.32} />
    </Svg>
  );
}

export const MiniJerseyModel = memo(function MiniJerseyModel({
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
  const reducedDetail = size < REDUCED_DETAIL_THRESHOLD;
  const label = safeLabel(abbr);
  const wordmark = teamWordmark(teamName, abbr, variant);
  const number = jerseyNumber(abbr);
  const detail = readableDetail(primary, secondary, accent);
  const outline = readableOutline(detail);
  const ids = {
    body: `mini_body_${instanceId}`,
    trim: `mini_trim_${instanceId}`,
    edge: `mini_edge_${instanceId}`,
    volume: `mini_volume_${instanceId}`,
    core: `mini_core_${instanceId}`,
    rim: `mini_rim_${instanceId}`,
    glass: `mini_glass_${instanceId}`,
    sheen: `mini_sheen_${instanceId}`,
    contact: `mini_contact_${instanceId}`,
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
      <ModelDefs ids={ids} body={shape.body} variant={variant} primary={primary} secondary={secondary} accent={accent} />

      {/* Soft, feathered contact shadow (gradient-filled ellipse) so the jersey
          sits grounded in space instead of on a flat gray pill. */}
      <Ellipse cx={50} cy={114} rx={34} ry={7} fill={`url(#${ids.contact})`} />

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
        {/* Form-shadow core — wraps the flanks/hem so the torso reads round. */}
        <Rect x={0} y={0} width={100} height={120} fill={`url(#${ids.core})`} />
        <Rect x={0} y={0} width={100} height={120} fill={`url(#${ids.sheen})`} />
        <PanelVolume variant={variant} reducedDetail={reducedDetail} />
        {reducedDetail ? null : (
          <>
            <TextureLayer weave={shape.weave} id={instanceId} primary={primary} accent={accent} />
            <ClothFoldLayer variant={variant} id={instanceId} />
          </>
        )}
      </G>

      <SportConstruction variant={variant} ids={ids} secondary={secondary} accent={accent} reducedDetail={reducedDetail} />

      <Path d={shape.body} stroke="#000000" strokeWidth={2.05} strokeOpacity={0.13} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={shape.body} stroke={`url(#${ids.rim})`} strokeWidth={1.05} strokeOpacity={0.46} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={shape.body} stroke={secondary} strokeWidth={0.58} strokeOpacity={0.18} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Path d={shape.body} fill={`url(#${ids.glass})`} />

      <G clipPath={`url(#${ids.clip})`}>
        <GarmentMarkings
          variant={variant}
          label={label}
          wordmark={wordmark}
          number={number}
          shape={shape}
          ids={ids}
          fill={detail}
          stroke={outline}
          accent={accent}
          surface={primary}
          reducedDetail={reducedDetail}
        />
      </G>
      <Path d={shape.body} fill={`url(#${ids.glass})`} fillOpacity={0.34} />
    </Svg>
  );
});
