import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import Animated, {
  withSpring,
  withTiming,
  withSequence,
  Easing,
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Sport, SPORT_META } from '@/types/sports';
import { displaySport } from '@/lib/display-confidence';
import { useTapGestureGuard } from '@/hooks/useTapGestureGuard';
import { guardedRouterPush } from '@/lib/navigation-guard';
import Svg, { Path, Circle, Rect, Defs, Pattern, Line, Ellipse, RadialGradient, Stop, G } from 'react-native-svg';

// Short label for width-constrained LED/dot-matrix tiles. Most sports already
// have a compact code via displaySport (e.g. CFB/CBB); WORLDCUP's display name
// "World Cup" is too wide for the 86px tile, so use a tight code there only.
function tileAbbrev(sport: string): string {
  if (sport === 'WORLDCUP') return 'WC';
  return displaySport(sport);
}

// ─── JUMBOTRON COLORS ──────────────────────────────────────────
const JB = {
  blue: '#7A9DB8',
  blueDark: '#5A7A8A',
  blueText: '#9BB8CF',
  iconOn: '#FFFFFF',
  iconOff: '#2a2a30',
  bg: '#080c10',
  borderOff: 'rgba(255,255,255,0.06)',
  borderOn: 'rgba(122,157,184,0.18)',
};

// ─── DOT MATRIX CHARACTER MAP (5x7 grids) ─────────────────────
const DOT_MATRIX: Record<string, number[][]> = {
  'A': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
  'B': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0]],
  'C': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  'D': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0]],
  'E': [[1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 1]],
  'F': [[1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0]],
  'G': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 0], [1, 0, 1, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  'H': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
  'I': [[0, 1, 1, 1, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 1, 1, 1, 0]],
  'J': [[0, 0, 1, 1, 1], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0], [1, 0, 0, 1, 0], [0, 1, 1, 0, 0]],
  'K': [[1, 0, 0, 0, 1], [1, 0, 0, 1, 0], [1, 0, 1, 0, 0], [1, 1, 0, 0, 0], [1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 0, 0, 0, 1]],
  'L': [[1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 1]],
  'M': [[1, 0, 0, 0, 1], [1, 1, 0, 1, 1], [1, 0, 1, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
  'N': [[1, 0, 0, 0, 1], [1, 1, 0, 0, 1], [1, 0, 1, 0, 1], [1, 0, 0, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
  'O': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  'P': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0]],
  'R': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0], [1, 0, 1, 0, 0], [1, 0, 0, 1, 0], [1, 0, 0, 0, 1]],
  'S': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  'T': [[1, 1, 1, 1, 1], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0]],
  'U': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  'V': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 0, 1, 0], [0, 1, 0, 1, 0], [0, 0, 1, 0, 0]],
  'W': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 1, 0, 1], [1, 0, 1, 0, 1], [1, 1, 0, 1, 1], [1, 0, 0, 0, 1]],
  'X': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
  'Y': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 0, 1, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0]],
  'Z': [[1, 1, 1, 1, 1], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 1]],
  '0': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 1, 1], [1, 0, 1, 0, 1], [1, 1, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '1': [[0, 0, 1, 0, 0], [0, 1, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 1, 1, 1, 0]],
  '2': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 1, 0, 0, 0], [1, 1, 1, 1, 1]],
  '3': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 0, 1, 1, 0], [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '4': [[0, 0, 0, 1, 0], [0, 0, 1, 1, 0], [0, 1, 0, 1, 0], [1, 0, 0, 1, 0], [1, 1, 1, 1, 1], [0, 0, 0, 1, 0], [0, 0, 0, 1, 0]],
  '5': [[1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '6': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '7': [[1, 1, 1, 1, 1], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 1, 0, 0]],
  '8': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '9': [[0, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 1], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
  '\'': [[0, 0, 1, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  '-': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  ' ': [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
};

// ─── PIXEL ART SPORT ICONS ────────────────────────────────────
function iconRows(rows: string[]): number[][] {
  return rows.map((row) => row.split('').map((cell) => (cell === '#' ? 1 : 0)));
}

const FOOTBALL_ICON = iconRows([
  '...........',
  '...#####...',
  '..#######..',
  '.##..#..##.',
  '##..###..##',
  '###########',
  '##..###..##',
  '.##..#..##.',
  '..#######..',
  '...#####...',
  '...........',
]);

const NBA_BASKETBALL_ICON = iconRows([
  '...#####...',
  '..#..#..#..',
  '.##..#..##.',
  '#.#..#..#.#',
  '#..#####..#',
  '###########',
  '#..#####..#',
  '#.#..#..#.#',
  '.##..#..##.',
  '..#..#..#..',
  '...#####...',
]);

const BASEBALL_DIAMOND_ICON = iconRows([
  '...........',
  '.....#.....',
  '....###....',
  '...#####...',
  '....###....',
  '.....#.....',
  '..#.....#..',
  '.###...###.',
  '#####.#####',
  '.###...###.',
  '..#.....#..',
]);

const SOCCER_ICON = iconRows([
  '...#####...',
  '..#..#..#..',
  '.#..###..#.',
  '#..#...#..#',
  '#.#.....#.#',
  '##.......##',
  '#.#.....#.#',
  '#..#####..#',
  '.#..#.#..#.',
  '..#..#..#..',
  '...#####...',
]);

const SPORT_PIXEL_ICONS: Record<string, number[][]> = {
  NFL: FOOTBALL_ICON,
  NCAAF: FOOTBALL_ICON,
  NBA: NBA_BASKETBALL_ICON,
  NCAAB: NBA_BASKETBALL_ICON,
  MLB: BASEBALL_DIAMOND_ICON,
  NHL: iconRows([
    '##.........',
    '##.........',
    '.##........',
    '.##........',
    '..##.......',
    '..##.......',
    '...##......',
    '...########',
    '....#######',
    '.......###.',
    '.......###.',
  ]),
  MLS: SOCCER_ICON,
  EPL: SOCCER_ICON,
  UCL: SOCCER_ICON,
  WORLDCUP: SOCCER_ICON,
  IPL: iconRows([
    '....##.....',
    '....##.....',
    '....##.....',
    '....##.....',
    '...####....',
    '...#..#....',
    '...#..#....',
    '...#..#....',
    '...#..#....',
    '...####....',
    '...####....',
  ]),
  TENNIS: iconRows([
    '...#####...',
    '..#.#.#.#..',
    '.#.#.#.#.#.',
    '.#..#.#..#.',
    '.#.#.#.#.#.',
    '..#.#.#.#..',
    '...#...#...',
    '....#.#....',
    '....###....',
    '....###....',
    '....###....',
  ]),
};

// ─── DOT MATRIX TEXT RENDERER (legacy — used by the FlatList sport-headers) ───
const PX = 1.5;
const PX_GAP = 0.5;
const CHAR_GAP = 1.5;
const LEGACY_OFF = '#0d1825';
const HALO_BLUE = 'rgba(122,157,184,0.12)';

interface DotMatrixTextProps { text: string; litColor?: string; dimColor?: string; pixelSize?: number; haloColor?: string }

export const DotMatrixText = memo(function DotMatrixText({ text, litColor = '#9BB8CF', dimColor = LEGACY_OFF, pixelSize = PX, haloColor = HALO_BLUE }: DotMatrixTextProps) {
  const step = pixelSize + PX_GAP;
  const coreRadius = pixelSize / 2;
  const haloSize = pixelSize + 0.6;
  const haloRadius = haloSize / 2;
  const chars = text.toUpperCase().split('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: CHAR_GAP }}>
      {chars.map((char, ci) => {
        const matrix = DOT_MATRIX[char];
        if (!matrix) return null;
        const w = matrix[0].length * step;
        const h = matrix.length * step;
        return (
          <View key={ci} style={{ width: w, height: h }}>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
                {matrix.map((row, ri) =>
                  row.map((px, coli) =>
                    px === 1 ? (
                      <Rect
                        key={`${ri}-${coli}`}
                        x={coli * step - 0.3}
                        y={ri * step - 0.3}
                        width={haloSize}
                        height={haloSize}
                        rx={haloRadius}
                        fill={haloColor}
                      />
                    ) : null
                  )
                )}
              </Svg>
            </View>
            <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
              {matrix.map((row, ri) =>
                row.map((px, coli) => (
                  <Rect
                    key={`${ri}-${coli}`}
                    x={coli * step}
                    y={ri * step}
                    width={pixelSize}
                    height={pixelSize}
                    rx={coreRadius}
                    fill={px ? litColor : dimColor}
                  />
                ))
              )}
            </Svg>
          </View>
        );
      })}
    </View>
  );
});

// ─── DOT MATRIX ICON RENDERER (legacy) ────────────────────────
export const DotMatrixIcon = memo(function DotMatrixIcon({ sport, litColor = '#FFFFFF', dimColor = LEGACY_OFF, pixelSize = PX, haloColor = HALO_BLUE }: { sport: string; litColor?: string; dimColor?: string; pixelSize?: number; haloColor?: string }) {
  const matrix = SPORT_PIXEL_ICONS[sport] || SPORT_PIXEL_ICONS.NBA;
  const step = pixelSize + PX_GAP;
  const coreRadius = pixelSize / 2;
  const haloSize = pixelSize + 0.6;
  const haloRadius = haloSize / 2;
  if (!matrix || !matrix.length) return null;
  const w = matrix[0].length * step;
  const h = matrix.length * step;
  return (
    <View style={{ width: w, height: h }}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          {matrix.map((row, ri) =>
            row.map((px, coli) =>
              px === 1 ? (
                <Rect
                  key={`${ri}-${coli}`}
                  x={coli * step - 0.3}
                  y={ri * step - 0.3}
                  width={haloSize}
                  height={haloSize}
                  rx={haloRadius}
                  fill={haloColor}
                />
              ) : null
            )
          )}
        </Svg>
      </View>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {matrix.map((row, ri) =>
          row.map((px, coli) => (
            <Rect
              key={`${ri}-${coli}`}
              x={coli * step}
              y={ri * step}
              width={pixelSize}
              height={pixelSize}
              rx={coreRadius}
              fill={px ? litColor : dimColor}
            />
          ))
        )}
      </Svg>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════
// REAL-LED PANEL RENDERING (used by sport-filter tiles + TODAY'S GAMES bar)
// ═══════════════════════════════════════════════════════════════
//
// Substrate:  matte black (#050505), 1px #161616 border.
// Off grid:   uniform 2.4-pitch dot lattice; every cell is a #262626 circle (radius 1.0).
// Lit pixel:  same-pitch grid, but the lit position renders 4 stacked layers —
//             three soft halos (Gaussian-blur source spec polyfilled with radial-gradient
//             discs that fade color → transparent) plus a sharp radial-gradient core.
// Glyph scale: every text glyph is 5×7 dots; all letters and counts share the same
//              pixel size (no hero scale). Hierarchy comes from positioning, not size.
// Animation:  none. Static radiance.
//
// Filter polyfill rationale: react-native-svg's <FeGaussianBlur> support varies across
// versions and platforms. Per spec ("match the look, not the exact filter primitive"),
// each blurred halo is rendered as a single circle whose radius equals
// (source radius + Gaussian σ) and whose fill is a radial gradient that fades from
// the spec'd color@opacity at the center to fully transparent at the edge. This
// approximates the soft 3-stage falloff with a single quad per layer, which keeps
// the SVG node count tractable for ~60 lit pixels per panel.

export const LED_BG = '#050505';
export const LED_BORDER = '#161616';
export const LED_OFF = '#262626';
// PITCH and DOT_RADIUS are the shared grid constants for every homepage LED
// panel. Each cell draws exactly one physical dot: either LED_OFF or the lit
// core at the same radius.
export const LED_PITCH = 2.4;
export const LED_OFF_RADIUS = 1.0;
const PITCH = LED_PITCH;
const DOT_RADIUS = LED_OFF_RADIUS;
// Whole-cell letter gap so multi-character text stays on the same board grid.
const LED_LETTER_GAP_COLS = 1;

const BLUE_FAR = '#5a85b5';
const BLUE_NEAR = '#c0d4e8';

// Subtle bloom only. The physical LED core stays DOT_RADIUS for both off and
// lit cells; these halos sit behind lit cells so brightness changes, not the
// dot lattice.
const LIT_CORE_RADIUS = DOT_RADIUS;
const LIT_HALO_LAYERS = {
  blue: [
    { r: 2.00, color: BLUE_FAR, opacity: 0.08 },
    { r: 1.55, color: BLUE_FAR, opacity: 0.16 },
    { r: 1.25, color: BLUE_NEAR, opacity: 0.30 },
  ],
  white: [
    { r: 2.00, color: '#ffffff', opacity: 0.05 },
    { r: 1.55, color: '#ffffff', opacity: 0.10 },
    { r: 1.25, color: '#ffffff', opacity: 0.22 },
  ],
} as const;

const CORE_STOPS = {
  blue: [
    ['0%', '#ffffff'] as const,
    ['50%', '#cfddef'] as const,
    ['100%', '#5d86b3'] as const,
  ],
  white: [
    ['0%', '#ffffff'] as const,
    ['70%', '#ffffff'] as const,
    ['100%', '#dadada'] as const,
  ],
} as const;

export type LedPalette = 'blue' | 'white';

// Reusable <Defs> block — must be a child of every LED panel <Svg>.
function LedDefs() {
  return (
    <Defs>
      <Pattern id="led-off-pattern" width={PITCH} height={PITCH} patternUnits="userSpaceOnUse">
        <Circle cx={PITCH / 2} cy={PITCH / 2} r={DOT_RADIUS} fill={LED_OFF} />
      </Pattern>
      {(['blue', 'white'] as const).map((p) => (
        <RadialGradient key={`core-${p}`} id={`led-core-${p}`} cx="50%" cy="50%" r="50%">
          {CORE_STOPS[p].map(([offset, color]) => (
            <Stop key={offset} offset={offset} stopColor={color} />
          ))}
        </RadialGradient>
      ))}
    </Defs>
  );
}

// Single grid coordinate function — used for both off-pixels and lit pixels.
// Every visible dot is drawn from an integer cell in this lattice, so the icon,
// letters, and numbers are the board pattern itself instead of an overlay on it.
function gridX(col: number): number {
  return PITCH / 2 + col * PITCH;
}
function gridY(row: number): number {
  return PITCH / 2 + row * PITCH;
}

function ledLitHalo(cx: number, cy: number, palette: LedPalette, key: string | number) {
  const halos = LIT_HALO_LAYERS[palette];
  return (
    <G key={key}>
      {halos.map((h, i) => (
        <Circle key={i} cx={cx} cy={cy} r={h.r} fill={h.color} fillOpacity={h.opacity} />
      ))}
    </G>
  );
}

// Draw the off LED lattice as one SVG pattern, then render only lit glyph cells.
// The old cell-by-cell renderer created thousands of native SVG nodes per panel.
function renderLedBoardDots(width: number, height: number, litCells: LitPos[]) {
  const cols = Math.max(0, Math.floor(width / PITCH));
  const rows = Math.max(0, Math.floor(height / PITCH));
  const litByCoord = new Map<string, LitPos>();

  for (const cell of litCells) {
    if (cell.col >= 0 && cell.col < cols && cell.row >= 0 && cell.row < rows) {
      litByCoord.set(`${cell.col}:${cell.row}`, cell);
    }
  }

  const halos: React.ReactNode[] = [];
  const dots: React.ReactNode[] = [];

  for (const [coord, cell] of litByCoord) {
    const cx = gridX(cell.col);
    const cy = gridY(cell.row);
    halos.push(ledLitHalo(cx, cy, cell.palette, `halo-${coord}`));
    dots.push(
      <Circle
        key={`dot-${coord}`}
        cx={cx}
        cy={cy}
        r={LIT_CORE_RADIUS}
        fill={`url(#led-core-${cell.palette})`}
      />,
    );
  }

  if (cols === 0 || rows === 0) {
    return null;
  }

  return (
    <>
      {halos}
      <Rect width={width} height={height} fill="url(#led-off-pattern)" />
      {dots}
    </>
  );
}

type LitPos = { col: number; row: number; palette: LedPalette };

// baseCol/baseRow are the integer grid column/row of the matrix's (0, 0) cell.
function emitMatrixCells(matrix: number[][], baseCol: number, baseRow: number, palette: LedPalette, out: LitPos[]) {
  for (let ri = 0; ri < matrix.length; ri++) {
    for (let ci = 0; ci < matrix[ri].length; ci++) {
      if (matrix[ri][ci] === 1) {
        out.push({ col: baseCol + ci, row: baseRow + ri, palette });
      }
    }
  }
}

function getLedIconMetrics(sport: Sport | string | null | undefined, fallbackMatrix: number[][]) {
  const matrix = sport ? (SPORT_PIXEL_ICONS[sport] || fallbackMatrix) : fallbackMatrix;
  return {
    colCount: matrix[0]?.length ?? 0,
    rowCount: matrix.length,
  };
}

function emitLedIconCells(
  sport: Sport | string | null | undefined,
  fallbackMatrix: number[][],
  baseCol: number,
  baseRow: number,
  out: LitPos[],
) {
  const matrix = sport ? (SPORT_PIXEL_ICONS[sport] || fallbackMatrix) : fallbackMatrix;
  emitMatrixCells(matrix, baseCol, baseRow, 'blue', out);
}

function measureLedText(text: string) {
  const chars = text.toUpperCase().split('');
  const datas = chars
    .map((c) => DOT_MATRIX[c])
    .filter(Boolean) as number[][][];
  const colCount = datas.reduce(
    (sum, m, i) => sum + m[0].length + (i > 0 ? LED_LETTER_GAP_COLS : 0),
    0,
  );
  const rowCount = datas.length > 0 ? datas[0].length : 0;
  const width = colCount * PITCH;
  const height = rowCount * PITCH;
  return { width, height, datas, colCount, rowCount };
}

function emitTextCells(text: string, baseCol: number, baseRow: number, palette: LedPalette, out: LitPos[]) {
  const { datas } = measureLedText(text);
  let cursorCol = baseCol;
  for (const matrix of datas) {
    emitMatrixCells(matrix, cursorCol, baseRow, palette, out);
    cursorCol += matrix[0].length + LED_LETTER_GAP_COLS;
  }
}

// Calendar pictograph used in the bar's default state.
const LED_CALENDAR_MATRIX = [
  [0, 1, 0, 0, 0, 1, 0],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 1, 0, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 0, 1, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

// ─── LED TILE PANEL ─────────────────────────────────────────────
// 86×86 square, vertical stack: icon (blue) → abbreviation (white) → count (blue).
// Layout is computed in GRID COLUMNS/ROWS so every lit core lands on the same
// lattice as every off-pixel. The dim board is one pattern; only lit glyphs are
// individual nodes.
export const LedTilePanel = memo(function LedTilePanel({ sport, gameCount, size = 86 }: { sport: Sport; gameCount: number | string; size?: number }) {
  const GAP_ICON_ROWS = 3;   // ~7.2 px — must be an integer number of grid rows
  const GAP_TEXT_ROWS = 3;   // ~7.2 px
  const ICON_ROW_SPAN = 11;  // accommodate the larger, more recognizable sport pictographs
  const TEXT_ROWS = 7;       // every char is 5×7

  const iconMetrics = getLedIconMetrics(sport, SPORT_PIXEL_ICONS.NBA);
  const iconCols = iconMetrics.colCount;
  const iconRows = iconMetrics.rowCount;

  const abbrText = tileAbbrev(sport);
  const abbr = measureLedText(abbrText);
  const countText = String(gameCount);
  const cnt = measureLedText(countText);

  const cols = Math.floor(size / PITCH);
  const rows = Math.floor(size / PITCH);

  const totalRows = ICON_ROW_SPAN + GAP_ICON_ROWS + TEXT_ROWS + GAP_TEXT_ROWS + TEXT_ROWS;
  const startRow = Math.max(0, Math.floor((rows - totalRows) / 2));

  const iconStartRow = startRow + Math.floor((ICON_ROW_SPAN - iconRows) / 2);
  const iconStartCol = Math.floor((cols - iconCols) / 2);

  const abbrStartRow = startRow + ICON_ROW_SPAN + GAP_ICON_ROWS;
  const abbrStartCol = Math.floor((cols - abbr.colCount) / 2);

  const countStartRow = abbrStartRow + TEXT_ROWS + GAP_TEXT_ROWS;
  const countStartCol = Math.floor((cols - cnt.colCount) / 2);

  const cells = useMemo(() => {
    const next: LitPos[] = [];
    emitLedIconCells(sport, SPORT_PIXEL_ICONS.NBA, iconStartCol, iconStartRow, next);
    emitTextCells(abbrText, abbrStartCol, abbrStartRow, 'white', next);
    emitTextCells(countText, countStartCol, countStartRow, 'blue', next);
    return next;
  }, [abbrStartCol, abbrStartRow, abbrText, countStartCol, countStartRow, countText, iconStartCol, iconStartRow, sport]);

  return (
    <Svg width={size} height={size}>
      <LedDefs />
      {renderLedBoardDots(size, size, cells)}
    </Svg>
  );
});

// ─── LED BAR PANEL ──────────────────────────────────────────────
// Width-flexible horizontal panel: icon left, label centered-left, count right-aligned.
// Width is captured via onLayout so the count's grid column can be computed.
export const LedBarPanel = memo(function LedBarPanel({
  label,
  count,
  leftSport,
  height = 44,
  borderRadius = 7,
}: {
  label: string;
  count: number | string;
  leftSport?: Sport | null;
  height?: number;
  borderRadius?: number;
}) {
  const leftIconMetrics = getLedIconMetrics(leftSport, LED_CALENDAR_MATRIX);
  const ICON_LABEL_GAP_COLS = 2;
  const LEFT_GAP_COLS = 8;
  const RIGHT_GAP_COLS = 8;

  const [width, setWidth] = useState(0);

  const leftCols = leftIconMetrics.colCount;
  const leftRows = leftIconMetrics.rowCount;
  const labelM = measureLedText(label);
  const countText = String(count);
  const countM = measureLedText(countText);

  // Grid extent of the bar.
  const cols = Math.max(0, Math.floor(width / PITCH));
  const rows = Math.max(0, Math.floor(height / PITCH));

  // Vertical centering — every glyph row span is centered in the bar.
  const centerRow = (rowSpan: number) => Math.floor((rows - rowSpan) / 2);
  const leftStartRow = centerRow(leftRows);
  const labelStartRow = centerRow(labelM.rowCount);
  const countStartRow = centerRow(countM.rowCount);

  const leftStartCol = LEFT_GAP_COLS;
  const labelStartCol = leftStartCol + leftCols + ICON_LABEL_GAP_COLS;
  const countStartCol = Math.max(
    labelStartCol + labelM.colCount + ICON_LABEL_GAP_COLS,
    cols - countM.colCount - RIGHT_GAP_COLS,
  );

  const cells = useMemo(() => {
    const next: LitPos[] = [];
    if (cols > 0) {
      emitLedIconCells(leftSport, LED_CALENDAR_MATRIX, leftStartCol, leftStartRow, next);
      emitTextCells(label, labelStartCol, labelStartRow, 'white', next);
      emitTextCells(countText, countStartCol, countStartRow, 'blue', next);
    }
    return next;
  }, [cols, countStartCol, countStartRow, countText, label, labelStartCol, labelStartRow, leftSport, leftStartCol, leftStartRow]);

  return (
    <View
      style={{
        width: '100%',
        height,
        borderRadius,
        overflow: 'hidden',
        backgroundColor: LED_BG,
        borderWidth: 1,
        borderColor: LED_BORDER,
      }}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w !== width) setWidth(w);
      }}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <LedDefs />
          {renderLedBoardDots(width, height, cells)}
        </Svg>
      ) : null}
    </View>
  );
});

// ─── LED MINI PANEL ─────────────────────────────────────────────
// Small selected-filter pill used on the homepage, with an optional blue rail
// kept as the physical marker.
export const LedMiniPanel = memo(function LedMiniPanel({
  label,
  count,
  leftSport,
  sideRail = false,
  height = 36,
  borderRadius = 3,
}: {
  label: string;
  count?: number | string;
  leftSport?: Sport | null;
  sideRail?: boolean;
  height?: number;
  borderRadius?: number;
}) {
  const iconMetrics = getLedIconMetrics(leftSport, SPORT_PIXEL_ICONS.NBA);
  const labelM = measureLedText(label);
  const countText = count === undefined ? null : String(count);
  const countM = countText ? measureLedText(countText) : null;
  const ICON_LABEL_GAP_COLS = leftSport ? 3 : 0;
  const LABEL_COUNT_GAP_COLS = countM ? 3 : 0;
  const LEFT_PAD_COLS = sideRail ? 6 : 6;
  const RIGHT_PAD_COLS = 6;

  const iconCols = leftSport ? iconMetrics.colCount : 0;
  const iconRows = leftSport ? iconMetrics.rowCount : 0;
  const contentCols =
    iconCols +
    ICON_LABEL_GAP_COLS +
    labelM.colCount +
    LABEL_COUNT_GAP_COLS +
    (countM?.colCount ?? 0);
  const cols = LEFT_PAD_COLS + contentCols + RIGHT_PAD_COLS;
  const rows = Math.max(0, Math.floor(height / PITCH));
  const width = Math.ceil(cols * PITCH);

  const cells = useMemo(() => {
    const next: LitPos[] = [];
    let cursorCol = LEFT_PAD_COLS;
    if (leftSport) {
      emitLedIconCells(leftSport, SPORT_PIXEL_ICONS.NBA, cursorCol, Math.floor((rows - iconRows) / 2), next);
      cursorCol += iconCols + ICON_LABEL_GAP_COLS;
    }
    emitTextCells(label, cursorCol, Math.floor((rows - labelM.rowCount) / 2), 'white', next);
    cursorCol += labelM.colCount + LABEL_COUNT_GAP_COLS;
    if (countText && countM) {
      emitTextCells(countText, cursorCol, Math.floor((rows - countM.rowCount) / 2), 'blue', next);
    }
    return next;
  }, [ICON_LABEL_GAP_COLS, LABEL_COUNT_GAP_COLS, LEFT_PAD_COLS, countM, countText, iconCols, iconRows, label, labelM.colCount, labelM.rowCount, leftSport, rows]);

  return (
    <View
      style={{
        position: 'relative' as const,
        width,
        height,
        borderRadius,
        overflow: 'hidden' as const,
        backgroundColor: LED_BG,
        borderWidth: 1,
        borderColor: LED_BORDER,
      }}
    >
      <Svg width={width} height={height}>
        <LedDefs />
        {renderLedBoardDots(width, height, cells)}
      </Svg>
      {sideRail ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute' as const,
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            backgroundColor: '#7A9DB8',
            opacity: 0.6,
          }}
        />
      ) : null}
    </View>
  );
});

// ─── LED SCORE PANEL ────────────────────────────────────────────
// Inline LED scoreboard for the live card on My Arena. Reuses the same dot-matrix
// glyphs and core gradient as the home-page LED tiles, but with its own pitch /
// dot radius / bloom so the score reads at conversational distance.
//
// Layout: away_score | wide gap | home_score. Each character is 5×7 dots scaled
// by SCORE_SCALE (one matrix dot → SCORE_SCALE × SCORE_SCALE grid cells).
// 2× scale matches a real arena scoreboard's chunky pixel aesthetic.
const SCORE_PITCH = 2.1;
const SCORE_DOT_RADIUS = 0.85;
const SCORE_CORE_RADIUS = 1.0;
const SCORE_PAD = 5;
const SCORE_SCALE = 2;
const SCORE_GLYPH_GAP_COLS = 3;     // gap between each glyph (home, dash, away)
const SCORE_CHAR_GAP_COLS = 1;      // small gap between digits within one number
// Black bezel wrapping the LED face — gives it a real-scoreboard frame look.
// Stack of layers (outer → inner):
//   1. Drop shadow under the whole panel → physical lift off the card
//   2. Bezel-gradient frame (darker matte black with a top→bottom sculpt)
//   3. Recessed inner ring (slight darker stroke around the LED face)
//   4. LED face with a thin top gloss strip → glass-screen highlight
const SCORE_BEZEL_W = 4;
// Bloom layers — scaled down with the smaller pitch. Stacked solid circles, no
// filters. Score panel uses the WHITE palette: scores read as headline-bright
// on the dark card background, distinct from the blue accents elsewhere on the
// card.
const SCORE_HALO_LAYERS = [
  { r: 1.80, color: '#ffffff', opacity: 0.10 },
  { r: 1.55, color: '#ffffff', opacity: 0.22 },
  { r: 1.28, color: '#ffffff', opacity: 0.36 },
  { r: 1.10, color: '#ffffff', opacity: 0.68 },
] as const;

function scoreCols(text: string): number {
  let cols = 0;
  for (let i = 0; i < text.length; i++) {
    const m = DOT_MATRIX[text[i]];
    if (!m) continue;
    if (i > 0) cols += SCORE_CHAR_GAP_COLS;
    cols += m[0].length * SCORE_SCALE;
  }
  return cols;
}

export function LedScorePanel({ awayScore, homeScore }: { awayScore: number; homeScore: number }) {
  const homeStr = String(homeScore);
  const awayStr = String(awayScore);
  const dashStr = '-';

  const homeColCount = scoreCols(homeStr);
  const dashColCount = scoreCols(dashStr);
  const awayColCount = scoreCols(awayStr);
  // home_score | gap | dash | gap | away_score — three glyphs, two gaps.
  const totalCols = homeColCount + SCORE_GLYPH_GAP_COLS + dashColCount + SCORE_GLYPH_GAP_COLS + awayColCount;
  const totalRows = 7 * SCORE_SCALE;

  const panelW = totalCols * SCORE_PITCH + 2 * SCORE_PAD;
  const panelH = totalRows * SCORE_PITCH + 2 * SCORE_PAD;

  // Grid-aligned coords (dot center at SCORE_PAD + col*PITCH + PITCH/2).
  const gx = (col: number) => SCORE_PAD + col * SCORE_PITCH + SCORE_PITCH / 2;
  const gy = (row: number) => SCORE_PAD + row * SCORE_PITCH + SCORE_PITCH / 2;

  const cells: { cx: number; cy: number }[] = [];

  function emitText(text: string, startCol: number) {
    let cursor = startCol;
    for (const ch of text) {
      const m = DOT_MATRIX[ch];
      if (!m) {
        continue;
      }
      for (let r = 0; r < m.length; r++) {
        for (let c = 0; c < m[r].length; c++) {
          if (m[r][c] === 1) {
            // 2× scale: one matrix dot lights a SCALE × SCALE block
            for (let dy = 0; dy < SCORE_SCALE; dy++) {
              for (let dx = 0; dx < SCORE_SCALE; dx++) {
                cells.push({ cx: gx(cursor + c * SCORE_SCALE + dx), cy: gy(r * SCORE_SCALE + dy) });
              }
            }
          }
        }
      }
      cursor += m[0].length * SCORE_SCALE + SCORE_CHAR_GAP_COLS;
    }
  }

  // Layout: home (left) → dash → away (right). The dash glyph rides the same
  // emitText pipeline as the digits, so it inherits the off-grid alignment and
  // bloom without any special-casing.
  emitText(homeStr, 0);
  emitText(dashStr, homeColCount + SCORE_GLYPH_GAP_COLS);
  emitText(awayStr, homeColCount + SCORE_GLYPH_GAP_COLS + dashColCount + SCORE_GLYPH_GAP_COLS);

  return (
    // Container holds the 3D housing plus a separate "contact shadow" beneath it
    // so the scoreboard reads as a physical object hovering above the card.
    <View style={{ position: 'relative' }}>
      {/* Contact / floor shadow — a soft dark blob below the housing. Sits a
          touch wider than the body so it reads like cast light, not just an
          attached drop shadow. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 2,
          right: 2,
          bottom: -3,
          height: 8,
          borderRadius: 6,
          backgroundColor: 'rgba(0,0,0,0.6)',
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.55,
              shadowRadius: 8,
            },
            android: { elevation: 4 },
          }),
        }}
      />
      {/* Outer ambient shadow — wide soft halo that lifts the box off the card. */}
      <View
        style={{
          borderRadius: 9,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.6,
              shadowRadius: 12,
            },
            android: { elevation: 10 },
          }),
        }}
      >
        {/* Inner key shadow — tight, sharp shadow giving a hard contact edge. */}
        <View
          style={{
            borderRadius: 9,
            ...Platform.select({
              ios: {
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.85,
                shadowRadius: 3,
              },
              android: {},
            }),
          }}
        >
          {/* Bezel — richer four-stop sculpt creates a matte-metal housing with a
              brighter lip on top and a darker recess at center. */}
          <LinearGradient
            colors={['#3d3d3d', '#1a1a1a', '#000000', '#1c1c1c']}
            locations={[0, 0.18, 0.55, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={{
              padding: SCORE_BEZEL_W,
              borderRadius: 9,
              borderWidth: 0.5,
              borderColor: '#2a2a2a',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Top edge specular hairline — a single bright pixel-row highlight
                that reads as light catching the front lip. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 0,
                left: 1,
                right: 1,
                height: 1,
                backgroundColor: 'rgba(255,255,255,0.22)',
              }}
            />
            {/* Bottom edge dark hairline — creates the bezel's underside in
                shadow. */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                bottom: 0,
                left: 1,
                right: 1,
                height: 1,
                backgroundColor: 'rgba(0,0,0,0.9)',
              }}
            />
            {/* Side wash — a faint left-to-right gradient on the bezel itself,
                simulating overhead light wrapping the side faces. */}
            <LinearGradient
              colors={['rgba(255,255,255,0.05)', 'transparent', 'rgba(255,255,255,0.07)']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              pointerEvents="none"
            />
            {/* Four corner rivets / screws — the single detail that pushes this
                from "card with gradient" to "real piece of hardware". */}
            {[
              { top: 2, left: 2 },
              { top: 2, right: 2 },
              { bottom: 2, left: 2 },
              { bottom: 2, right: 2 },
            ].map((pos, i) => (
              <View
                key={i}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  ...pos,
                  width: 3,
                  height: 3,
                  borderRadius: 1.5,
                  backgroundColor: '#050505',
                  borderWidth: 0.5,
                  borderColor: 'rgba(255,255,255,0.22)',
                }}
              />
            ))}
            {/* Recessed inner ring — narrow darker stroke between bezel and LED
                face. */}
            <View
              style={{
                padding: 1,
                borderRadius: 6,
                backgroundColor: '#000000',
              }}
            >
              <View
                style={{
                  width: panelW,
                  height: panelH,
                  borderRadius: 5,
                  overflow: 'hidden',
                  backgroundColor: LED_BG,
                }}
              >
                <Svg width={panelW} height={panelH}>
                  <Defs>
                    <Pattern id="ledScoreGrid" width={SCORE_PITCH} height={SCORE_PITCH} patternUnits="userSpaceOnUse">
                      <Circle cx={SCORE_PITCH / 2} cy={SCORE_PITCH / 2} r={SCORE_DOT_RADIUS} fill={LED_OFF} />
                    </Pattern>
                    <RadialGradient id="led-score-core" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor="#ffffff" />
                      <Stop offset="70%" stopColor="#ffffff" />
                      <Stop offset="100%" stopColor="#dadada" />
                    </RadialGradient>
                  </Defs>
                  <Rect width={panelW} height={panelH} fill="url(#ledScoreGrid)" />
                  {cells.map((c, i) => (
                    <G key={i}>
                      {SCORE_HALO_LAYERS.map((h, j) => (
                        <Circle key={j} cx={c.cx} cy={c.cy} r={h.r} fill={h.color} fillOpacity={h.opacity} />
                      ))}
                      <Circle cx={c.cx} cy={c.cy} r={SCORE_CORE_RADIUS} fill="url(#led-score-core)" />
                    </G>
                  ))}
                </Svg>
                {/* Inner top shadow — bezel casts a shadow onto the glass face. */}
                <LinearGradient
                  colors={['rgba(0,0,0,0.55)', 'transparent']}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3 }}
                  pointerEvents="none"
                />
                {/* Glass-screen highlight — gloss strip across the very top of
                    the LED face. */}
                <LinearGradient
                  colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: Math.max(4, panelH * 0.22) }}
                  pointerEvents="none"
                />
                {/* Diagonal specular streak — angled light catch across the
                    glass surface. */}
                <LinearGradient
                  colors={['transparent', 'rgba(255,255,255,0.07)', 'transparent']}
                  locations={[0.35, 0.5, 0.65]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                  pointerEvents="none"
                />
                {/* Edge vignette — slight darkening at the bottom for depth. */}
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.28)']}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                  pointerEvents="none"
                />
              </View>
            </View>
          </LinearGradient>
        </View>
      </View>
    </View>
  );
}

// ─── PIXEL GRID OVERLAY ────────────────────────────────────────
// Off-state pixels for the entire panel: same circle shape & size as the lit pixel cores.
// Only color differs — these are dim (#0d1825) versus the bright lit core.
export const PixelGrid = memo(function PixelGrid() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="jbGrid" width="2" height="2" patternUnits="userSpaceOnUse">
            <Rect width="2" height="2" fill="transparent" />
            <Rect x="0.25" y="0.25" width="1.5" height="1.5" rx="0.75" fill={LED_OFF} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#jbGrid)" />
      </Svg>
    </View>
  );
});

// ─── ORIGINAL LARGE 3D SPORT ICONS (kept for full-size cards & getSportIcon) ──

const FootballHelmetIcon = memo(function FootballHelmetIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Ellipse cx="25" cy="40" rx="10" ry="2.5" fill="black" fillOpacity="0.25" />
      <Ellipse cx="24.6" cy="24.6" rx="14" ry="9.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.25" />
      <Ellipse cx="24" cy="24" rx="14" ry="9.5" stroke={color} strokeWidth="2.5" />
      <Path d="M12 20C14 17 18 15.5 22 15.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
      <Line x1="24" y1="14.5" x2="24" y2="33.5" stroke={color} strokeWidth="2" strokeOpacity="0.85" />
      <Line x1="20" y1="19" x2="28" y2="19" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Line x1="20" y1="24" x2="28" y2="24" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7" />
      <Line x1="20" y1="29" x2="28" y2="29" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.4" />
      <Ellipse cx="18" cy="18" rx="3" ry="1.8" fill={color} fillOpacity="0.18" />
    </Svg>
  );
});

const BasketballHoopIcon = memo(function BasketballHoopIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Ellipse cx="25" cy="41" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      <Circle cx="24.6" cy="24.6" r="14" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <Circle cx="24" cy="24" r="14" stroke={color} strokeWidth="2.5" />
      <Path d="M13 16C16 12 20 11 24 11" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      <Line x1="24" y1="10" x2="24" y2="38" stroke={color} strokeWidth="1.8" strokeOpacity="0.8" />
      <Line x1="10" y1="24" x2="38" y2="24" stroke={color} strokeWidth="1.8" strokeOpacity="0.7" />
      <Path d="M16 12C19 18 19 30 16 36" stroke={color} strokeWidth="1.6" strokeOpacity="0.7" />
      <Path d="M32 12C29 18 29 30 32 36" stroke={color} strokeWidth="1.6" strokeOpacity="0.35" />
      <Circle cx="17" cy="16" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

const BaseballBatIcon = memo(function BaseballBatIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Ellipse cx="25" cy="41" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      <Circle cx="24.6" cy="24.6" r="14" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <Circle cx="24" cy="24" r="14" stroke={color} strokeWidth="2.5" />
      <Path d="M13 16C16 12 20 11 24 11" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      <Path d="M14 13C18 18 18 30 14 35" stroke={color} strokeWidth="1.6" strokeOpacity="0.75" />
      <Path d="M34 13C30 18 30 30 34 35" stroke={color} strokeWidth="1.6" strokeOpacity="0.4" />
      <Line x1="12.5" y1="17" x2="16" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
      <Line x1="12" y1="21" x2="15.5" y2="20.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.7" />
      <Line x1="12" y1="25" x2="15.5" y2="25" stroke={color} strokeWidth="1.2" strokeOpacity="0.6" />
      <Line x1="12" y1="29" x2="15.5" y2="29.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.5" />
      <Line x1="12.5" y1="33" x2="16" y2="33.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.4" />
      <Line x1="35.5" y1="17" x2="32" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.45" />
      <Line x1="36" y1="21" x2="32.5" y2="20.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.38" />
      <Line x1="36" y1="25" x2="32.5" y2="25" stroke={color} strokeWidth="1.2" strokeOpacity="0.3" />
      <Line x1="36" y1="29" x2="32.5" y2="29.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.25" />
      <Line x1="35.5" y1="33" x2="32" y2="33.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.2" />
      <Circle cx="17" cy="16" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

const HockeyStickIcon = memo(function HockeyStickIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path d="M16.5 7L16.5 31L11.5 35.5L11.5 39L23.5 39L23.5 35.5L18.5 31L18.5 7" stroke="black" strokeWidth="2.5" strokeOpacity="0.15" strokeLinejoin="round" />
      <Path d="M15 6L15 30L10 34.5L10 38L22 38L22 34.5L17 30L17 6" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      <Line x1="15" y1="10" x2="17" y2="10" stroke={color} strokeWidth="1.8" strokeOpacity="0.7" />
      <Line x1="15" y1="13" x2="17" y2="13" stroke={color} strokeWidth="1.8" strokeOpacity="0.55" />
      <Line x1="15" y1="16" x2="17" y2="16" stroke={color} strokeWidth="1.8" strokeOpacity="0.4" />
      <Ellipse cx="35" cy="40" rx="8" ry="2" fill="black" fillOpacity="0.2" />
      <Ellipse cx="34.5" cy="36.5" rx="8" ry="3.5" stroke={color} strokeWidth="2" strokeOpacity="0.3" />
      <Line x1="26.5" y1="33" x2="26.5" y2="36.5" stroke={color} strokeWidth="2" strokeOpacity="0.5" />
      <Line x1="42.5" y1="33" x2="42.5" y2="36.5" stroke={color} strokeWidth="2" strokeOpacity="0.2" />
      <Ellipse cx="34" cy="32.5" rx="8" ry="3.5" stroke={color} strokeWidth="2.2" />
      <Ellipse cx="30" cy="31.5" rx="3.5" ry="1.2" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

const SoccerCleatIcon = memo(function SoccerCleatIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Ellipse cx="25" cy="41" rx="9.5" ry="2" fill="black" fillOpacity="0.25" />
      <Circle cx="24.6" cy="24.6" r="14.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <Circle cx="24" cy="24" r="14.5" stroke={color} strokeWidth="2.5" />
      <Path d="M12 16C15 12 19 10.5 23 10.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      <Path d="M24 15L18.5 19L20.5 26L27.5 26L29.5 19Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeOpacity="0.85" />
      <Line x1="24" y1="15" x2="24" y2="9.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
      <Line x1="18.5" y1="19" x2="11" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.7" />
      <Line x1="29.5" y1="19" x2="37" y2="16" stroke={color} strokeWidth="1.2" strokeOpacity="0.45" />
      <Line x1="20.5" y1="26" x2="15" y2="34" stroke={color} strokeWidth="1.2" strokeOpacity="0.5" />
      <Line x1="27.5" y1="26" x2="33" y2="34" stroke={color} strokeWidth="1.2" strokeOpacity="0.3" />
      <Circle cx="17" cy="16" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

const CollegeFootballIcon = memo(function CollegeFootballIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path d="M24 2L25.8 6.5L30.5 6.5L26.8 9.2L28 13.5L24 10.8L20 13.5L21.2 9.2L17.5 6.5L22.2 6.5Z" fill={color} />
      <Ellipse cx="25" cy="43" rx="10" ry="2.5" fill="black" fillOpacity="0.25" />
      <Ellipse cx="24.6" cy="28.6" rx="14.5" ry="9.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.25" />
      <Ellipse cx="24" cy="28" rx="14.5" ry="9.5" stroke={color} strokeWidth="2.5" />
      <Path d="M11 24C13 21 17 19.5 21 19.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.5" strokeLinecap="round" />
      <Line x1="24" y1="18.5" x2="24" y2="37.5" stroke={color} strokeWidth="2" strokeOpacity="0.85" />
      <Line x1="20" y1="23" x2="28" y2="23" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Line x1="20" y1="28" x2="28" y2="28" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.7" />
      <Line x1="20" y1="33" x2="28" y2="33" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.4" />
      <Ellipse cx="17" cy="22" rx="3" ry="1.8" fill={color} fillOpacity="0.18" />
    </Svg>
  );
});

const CollegeBasketballIcon = memo(function CollegeBasketballIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path d="M24 0.5L25.5 4L29.5 4L26.2 6.3L27.2 10L24 7.5L20.8 10L21.8 6.3L18.5 4L22.5 4Z" fill={color} />
      <Ellipse cx="25" cy="43" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      <Circle cx="24.6" cy="27.6" r="14" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <Circle cx="24" cy="27" r="14" stroke={color} strokeWidth="2.5" />
      <Path d="M13 19C16 15 20 14 24 14" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      <Line x1="24" y1="13" x2="24" y2="41" stroke={color} strokeWidth="1.8" strokeOpacity="0.8" />
      <Line x1="10" y1="27" x2="38" y2="27" stroke={color} strokeWidth="1.8" strokeOpacity="0.7" />
      <Path d="M13 15C18 20 18 34 13 39" stroke={color} strokeWidth="1.6" strokeOpacity="0.7" />
      <Path d="M35 15C30 20 30 34 35 39" stroke={color} strokeWidth="1.6" strokeOpacity="0.35" />
      <Circle cx="17" cy="19" r="3.5" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

const PremierLeagueIcon = memo(function PremierLeagueIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path d="M14 7.5L18 12L24 6.5L30 12L34 7.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="14" cy="7.5" r="1.3" fill={color} />
      <Circle cx="24" cy="6.5" r="1.3" fill={color} />
      <Circle cx="34" cy="7.5" r="1.3" fill={color} />
      <Ellipse cx="25" cy="43" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      <Circle cx="24.6" cy="27.6" r="13.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <Circle cx="24" cy="27" r="13.5" stroke={color} strokeWidth="2.5" />
      <Path d="M13 19C16 15 20 14 24 14" stroke={color} strokeWidth="1.5" strokeOpacity="0.45" strokeLinecap="round" />
      <Path d="M24 18.5L18.5 22.5L20.5 29.5L27.5 29.5L29.5 22.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeOpacity="0.85" />
      <Line x1="24" y1="18.5" x2="24" y2="13.5" stroke={color} strokeWidth="1.2" strokeOpacity="0.8" />
      <Line x1="18.5" y1="22.5" x2="11" y2="19" stroke={color} strokeWidth="1.2" strokeOpacity="0.7" />
      <Line x1="29.5" y1="22.5" x2="37" y2="19" stroke={color} strokeWidth="1.2" strokeOpacity="0.45" />
      <Line x1="20.5" y1="29.5" x2="15" y2="37" stroke={color} strokeWidth="1.2" strokeOpacity="0.5" />
      <Line x1="27.5" y1="29.5" x2="33" y2="37" stroke={color} strokeWidth="1.2" strokeOpacity="0.3" />
      <Circle cx="17" cy="19" r="3" fill={color} fillOpacity="0.15" />
    </Svg>
  );
});

const CricketBatIcon = memo(function CricketBatIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Ellipse cx="25" cy="43" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      <Path d="M14 38L33.5 18.5C36 16 39 16 41 18C43 20 43 23 40.5 25.5L21 45" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 31L17 38" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <Path d="M13 28L20 35" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.45" />
      <Circle cx="13" cy="13" r="6" stroke={color} strokeWidth="2.5" />
      <Path d="M9 9C11.5 11.8 14.2 14.4 17 17" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.75" />
      <Path d="M29 23L35.5 29.5" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.45" />
    </Svg>
  );
});

const TennisRacketIcon = memo(function TennisRacketIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Ellipse cx="25" cy="43" rx="9" ry="2" fill="black" fillOpacity="0.25" />
      <Circle cx="18" cy="17" r="10.5" stroke={color} strokeWidth="2.5" strokeOpacity="0.24" />
      <Circle cx="17" cy="16" r="10.5" stroke={color} strokeWidth="2.5" />
      <Path d="M9.5 9.5L24.5 24.5M24.5 9.5L9.5 24.5" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeOpacity="0.65" />
      <Path d="M27 25L40 38" stroke={color} strokeWidth="3" strokeLinecap="round" />
      <Path d="M36 36L42 42" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <Circle cx="34" cy="11" r="4" stroke={color} strokeWidth="2.2" />
      <Path d="M12 8C15 5.8 19 5.5 22 7" stroke={color} strokeWidth="1.4" strokeOpacity="0.45" strokeLinecap="round" />
    </Svg>
  );
});

// Keep original getSportIcon for full-size cards
export function getSportIcon(sport: Sport, size: number, color: string) {
  switch (sport) {
    case Sport.NFL: return <FootballHelmetIcon size={size} color={color} />;
    case Sport.NBA: return <BasketballHoopIcon size={size} color={color} />;
    case Sport.MLB: return <BaseballBatIcon size={size} color={color} />;
    case Sport.NHL: return <HockeyStickIcon size={size} color={color} />;
    case Sport.MLS: return <SoccerCleatIcon size={size} color={color} />;
    case Sport.EPL: return <PremierLeagueIcon size={size} color={color} />;
    case Sport.UCL: return <PremierLeagueIcon size={size} color={color} />;
    case Sport.WORLDCUP: return <SoccerCleatIcon size={size} color={color} />;
    case Sport.IPL: return <CricketBatIcon size={size} color={color} />;
    case Sport.TENNIS: return <TennisRacketIcon size={size} color={color} />;
    case Sport.NCAAF: return <CollegeFootballIcon size={size} color={color} />;
    case Sport.NCAAB: return <CollegeBasketballIcon size={size} color={color} />;
    default: return <SoccerCleatIcon size={size} color={color} />;
  }
}

// ─── SPORT CARD PROPS ──────────────────────────────────────────
interface SportCardProps {
  sport: Sport;
  gameCount: number | string;
  index?: number;
  compact?: boolean;
  tile?: boolean;
  tileSize?: number;
  onPress?: () => void;
  isSelected?: boolean;
  hasActiveFilter?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── MAIN COMPONENT ───────────────────────────────────────────
export const SportCard = memo(function SportCard({
  sport,
  gameCount,
  index = 0,
  compact = false,
  tile = false,
  tileSize = 86,
  onPress,
  isSelected = false,
  hasActiveFilter = false,
}: SportCardProps) {
  const router = useRouter();
  const meta = SPORT_META[sport];
  const baseColor = meta.color;
  const {
    onTouchStart,
    onTouchMove,
    onTouchCancel,
    shouldHandlePress,
  } = useTapGestureGuard();

  const handlePress = useCallback(() => {
    if (!shouldHandlePress()) return;
    if (onPress) {
      onPress();
    } else {
      guardedRouterPush(router, `/sport/${sport}` as any);
    }
  }, [onPress, router, shouldHandlePress, sport]);

  const scale = useSharedValue(1);
  const selectionScale = useSharedValue(1);
  // Tile focus state: the selected tile grows + stays crisp, the rest shrink + fade.
  const tileFocusScale = useSharedValue(1);
  const dimProgress = useSharedValue(0);

  useEffect(() => {
    // Compact pill keeps its quick selection pop.
    if (isSelected) {
      selectionScale.value = withSequence(
        withTiming(1.07, { duration: 130, easing: Easing.out(Easing.cubic) }),
        withSpring(1, { damping: 10, stiffness: 240, mass: 0.7 })
      );
    }
    // Tile focus: the chosen tile grows; the others recede (smaller + blurred).
    // One shared spring for every direction so selecting AND unselecting feel
    // equally smooth and satisfying.
    const chosen = hasActiveFilter && isSelected;
    const dimmed = hasActiveFilter && !isSelected;
    const focusSpring = { damping: 18, stiffness: 360, mass: 0.55 };
    tileFocusScale.value = withSpring(chosen ? 1.025 : dimmed ? 0.94 : 1, focusSpring);
    dimProgress.value = withTiming(dimmed ? 1 : 0, { duration: 150, easing: Easing.out(Easing.cubic) });
  }, [isSelected, hasActiveFilter, selectionScale, tileFocusScale, dimProgress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * selectionScale.value }],
  }));

  // Tile: press scale × focus scale (grows when chosen, shrinks when dimmed).
  const tileScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * tileFocusScale.value }],
  }));
  // Unselected tiles fade and recede (cheap + smooth — no real-time blur).
  const dimContainerStyle = useAnimatedStyle(() => ({
    opacity: 1 - dimProgress.value * 0.32,
  }));

  // ═══════════════════════════════════════════════
  // TILE: SQUARE LED PANEL (real-LED look — uniform pixel grid + 4-layer bloom)
  // ═══════════════════════════════════════════════
  if (tile) {
    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`${displaySport(sport)}, ${gameCount} game${gameCount === 1 ? '' : 's'}`}
        accessibilityHint={`Filters the home board by ${displaySport(sport)}`}
        accessibilityState={{ selected: isSelected }}
        onPress={handlePress}
        pressRetentionOffset={6}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchCancel={onTouchCancel}
        onPressIn={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          scale.value = withTiming(0.94, { duration: 70, easing: Easing.out(Easing.cubic) });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 420, mass: 0.55 });
        }}
        style={[tileScaleStyle, { position: 'relative' }]}
      >
        <Animated.View
          style={[
            {
              width: tileSize,
              height: tileSize,
              borderRadius: 9,
              overflow: 'hidden' as const,
              backgroundColor: LED_BG,
              borderWidth: 1,
              borderColor: LED_BORDER,
            },
            dimContainerStyle,
          ]}
        >
          <LedTilePanel sport={sport} gameCount={gameCount} size={tileSize} />
        </Animated.View>
      </AnimatedPressable>
    );
  }

  // ═══════════════════════════════════════════════
  // COMPACT: JUMBOTRON LED TILE (horizontal pill)
  // ═══════════════════════════════════════════════
  if (compact) {
    // States: lit (default/selected), dimmed (another filter active)
    const isDimmed = hasActiveFilter && !isSelected;
    const isLit = !isDimmed; // fully lit by default, or when selected
    const isChosen = hasActiveFilter && isSelected; // the actively chosen one
    const borderColor = isChosen ? 'rgba(122,157,184,0.35)' : 'rgba(122,157,184,0.15)';

    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`${displaySport(sport)}, ${gameCount} game${gameCount === 1 ? '' : 's'}`}
        accessibilityHint={`Filters the home board by ${displaySport(sport)}`}
        accessibilityState={{ selected: isSelected }}
        onPress={handlePress}
        pressRetentionOffset={6}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchCancel={onTouchCancel}
        onPressIn={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          scale.value = withSpring(0.9, { damping: 16, stiffness: 420 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 11, stiffness: 320, mass: 0.6 });
        }}
        style={[animatedStyle, { flex: 1 }]}
      >
        <View
          style={{
            position: 'relative' as const,
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            justifyContent: 'space-between' as const,
            gap: 5,
            paddingVertical: 8,
            paddingHorizontal: 10,
            height: 44,
            borderRadius: 3,
            backgroundColor: JB.bg,
            borderWidth: 1,
            borderColor,
            overflow: 'hidden' as const,
            opacity: isDimmed ? 0.45 : 1,
            ...Platform.select({
              ios: {
                shadowColor: isLit ? '#7A9DB8' : '#000',
                shadowOffset: { width: 0, height: isLit ? 0 : 2 },
                shadowOpacity: isLit ? 0.2 : 0.4,
                shadowRadius: isLit ? 14 : 4,
              },
              android: { elevation: isChosen ? 6 : isLit ? 4 : 2 },
            }),
          }}
        >
          {/* Pixel grid — ALWAYS visible */}
          <PixelGrid />

          {/* Content — all dot-matrix rendered */}
          <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, flex: 1, justifyContent: 'space-between' as const, zIndex: 4 }}>
            <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 }}>
              <View style={{ height: 22, overflow: 'visible' as const, justifyContent: 'center' as const }}>
                <DotMatrixIcon sport={sport} litColor={isLit ? '#FFFFFF' : '#3a4a58'} pixelSize={2} />
              </View>
              <DotMatrixText text={tileAbbrev(sport)} litColor={isLit ? '#9BB8CF' : '#4a5a68'} pixelSize={2} />
            </View>
            <DotMatrixText text={String(gameCount)} litColor={isLit ? '#FFFFFF' : '#4a5a68'} pixelSize={2} />
          </View>

        </View>
      </AnimatedPressable>
    );
  }

  // ═══════════════════════════════════════════════
  // FULL-SIZE CARD (unchanged)
  // ═══════════════════════════════════════════════
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={`${displaySport(sport)}, ${gameCount} game${gameCount === 1 ? '' : 's'}`}
      accessibilityHint={`Opens ${displaySport(sport)} games`}
      accessibilityState={{ selected: isSelected }}
      onPress={handlePress}
      pressRetentionOffset={6}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchCancel={onTouchCancel}
      className="mb-3 active:opacity-80"
    >
      <View
        style={{
          borderRadius: 16,
          backgroundColor: baseColor,
          flexDirection: 'row',
          alignItems: 'center',
          padding: 16,
          borderWidth: 3,
          borderColor: 'rgba(0,0,0,0.3)',
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 16,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.2)',
          }}
        >
          {getSportIcon(sport, 26, meta.accentColor)}
        </View>

        <View className="flex-1">
          <Text className="text-white font-semibold text-base">{meta.name}</Text>
          <View className="flex-row items-center mt-1">
            {meta.isCollege ? (
              <View
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 4,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '500' }}>College</Text>
              </View>
            ) : null}
            <Text className="text-white/60 text-sm">{gameCount} games today</Text>
          </View>
        </View>

        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.2)',
          }}
        >
          <Text style={{ color: '#FFFFFF' }} className="font-bold text-sm">
            {gameCount}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
});

// Ticket color helper — used by index.tsx for Today's Games bar
export const TICKET_COLORS = ['#8B0A1F', '#8B0A1F', '#8B0A1F'];
export const TICKET_COLOR_MAP: Record<string, number> = {
  NBA: 0, NFL: 1, MLB: 2, NHL: 0, MLS: 1, EPL: 2, UCL: 0, WORLDCUP: 2, IPL: 1, TENNIS: 2, NCAAF: 0, NCAAB: 1,
};
export function getTicketColor(sport: string): string {
  return TICKET_COLORS[TICKET_COLOR_MAP[sport] ?? 0];
}
