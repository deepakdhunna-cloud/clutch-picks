import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef, useMemo, useState } from 'react';
import Animated, {
  FadeInRight,
  withSpring,
  useSharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Sport, SPORT_META } from '@/types/sports';
import { displaySport } from '@/lib/display-confidence';
import Svg, { Path, Circle, Rect, Defs, Pattern, Line, Ellipse, RadialGradient, Stop, G } from 'react-native-svg';

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
  'A': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'B': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  'C': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,1],[0,1,1,1,0]],
  'D': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0]],
  'E': [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'F': [[1,1,1,1,1],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
  'G': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[1,0,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'H': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'I': [[0,1,1,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0]],
  'J': [[0,0,1,1,1],[0,0,0,1,0],[0,0,0,1,0],[0,0,0,1,0],[0,0,0,1,0],[1,0,0,1,0],[0,1,1,0,0]],
  'K': [[1,0,0,0,1],[1,0,0,1,0],[1,0,1,0,0],[1,1,0,0,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  'L': [[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  'M': [[1,0,0,0,1],[1,1,0,1,1],[1,0,1,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'N': [[1,0,0,0,1],[1,1,0,0,1],[1,0,1,0,1],[1,0,0,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1]],
  'O': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'P': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,0,0,0,0]],
  'R': [[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[1,1,1,1,0],[1,0,1,0,0],[1,0,0,1,0],[1,0,0,0,1]],
  'S': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,0],[0,1,1,1,0],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'T': [[1,1,1,1,1],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  'U': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  'V': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,1,0,1,0],[0,0,1,0,0]],
  'W': [[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,1,0,1],[1,1,0,1,1],[1,0,0,0,1]],
  'X': [[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,1,0,1,0],[1,0,0,0,1],[1,0,0,0,1]],
  'Y': [[1,0,0,0,1],[1,0,0,0,1],[0,1,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  'Z': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,0,0,0,0],[1,1,1,1,1]],
  '0': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,1,1],[1,0,1,0,1],[1,1,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '1': [[0,0,1,0,0],[0,1,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,1,1,1,0]],
  '2': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,1,0,0,0],[1,1,1,1,1]],
  '3': [[0,1,1,1,0],[1,0,0,0,1],[0,0,0,0,1],[0,0,1,1,0],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '4': [[0,0,0,1,0],[0,0,1,1,0],[0,1,0,1,0],[1,0,0,1,0],[1,1,1,1,1],[0,0,0,1,0],[0,0,0,1,0]],
  '5': [[1,1,1,1,1],[1,0,0,0,0],[1,1,1,1,0],[0,0,0,0,1],[0,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '6': [[0,1,1,1,0],[1,0,0,0,0],[1,0,0,0,0],[1,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '7': [[1,1,1,1,1],[0,0,0,0,1],[0,0,0,1,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0],[0,0,1,0,0]],
  '8': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,0]],
  '9': [[0,1,1,1,0],[1,0,0,0,1],[1,0,0,0,1],[0,1,1,1,1],[0,0,0,0,1],[0,0,0,0,1],[0,1,1,1,0]],
  '\'': [[0,0,1,0,0],[0,0,1,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
  '-': [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0],[0,1,1,1,0],[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]],
  ' ': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
};

// ─── PIXEL ART SPORT ICONS ────────────────────────────────────
const SPORT_PIXEL_ICONS: Record<string, number[][]> = {
  NFL: [[0,0,0,1,1,1,0,0,0],[0,0,1,1,1,1,1,0,0],[0,1,1,0,1,0,1,1,0],[1,1,0,1,1,1,0,1,1],[0,1,1,0,1,0,1,1,0],[0,0,1,1,1,1,1,0,0],[0,0,0,1,1,1,0,0,0]],
  NBA: [[0,0,1,1,1,1,1,0,0],[0,1,0,0,1,0,0,1,0],[1,0,0,0,1,0,0,0,1],[1,0,0,0,1,0,0,0,1],[1,1,1,1,1,1,1,1,1],[1,0,0,0,1,0,0,0,1],[1,0,0,0,1,0,0,0,1],[0,1,0,0,1,0,0,1,0],[0,0,1,1,1,1,1,0,0]],
  MLB: [[0,0,0,1,0,0,0],[0,0,1,0,1,0,0],[0,1,0,0,0,1,0],[1,0,0,0,0,0,1],[0,1,0,0,0,1,0],[0,0,1,0,1,0,0],[0,0,0,1,0,0,0]],
  NHL: [[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,0,0,0,0,0,0,0,0],[1,1,0,0,0,1,1,1,0],[0,1,1,0,0,0,0,0,0],[0,0,1,1,1,0,0,0,0]],
  EPL: [[0,0,1,1,1,1,1,0,0],[0,1,0,0,0,0,0,1,0],[1,0,0,1,1,1,0,0,1],[1,0,1,0,0,0,1,0,1],[1,0,1,0,0,0,1,0,1],[1,0,0,1,1,1,0,0,1],[1,0,0,0,0,0,0,0,1],[0,1,0,0,0,0,0,1,0],[0,0,1,1,1,1,1,0,0]],
  NCAAF: [[0,0,1,1,1,1,1,0,0],[0,1,1,1,1,1,1,1,0],[1,1,0,1,1,0,0,1,1],[1,0,0,1,1,0,0,0,1],[1,1,0,0,0,0,0,1,1],[0,1,1,1,1,1,1,1,0],[0,0,0,1,1,1,0,0,0]],
};
SPORT_PIXEL_ICONS.MLS = SPORT_PIXEL_ICONS.EPL;
SPORT_PIXEL_ICONS.UCL = SPORT_PIXEL_ICONS.EPL;
SPORT_PIXEL_ICONS.NCAAB = SPORT_PIXEL_ICONS.NBA;

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
// PITCH and DOT_RADIUS are the SHARED grid constants — used by both the off-grid
// background pattern AND the sharp core of every lit pixel. There is exactly one
// grid; the only thing that differs between an off-pixel and a lit-pixel at the
// same (col, row) is the fill (LED_OFF vs the bright core gradient + the four
// stacked halo circles around it).
export const LED_PITCH = 2.4;
export const LED_OFF_RADIUS = 1.0;
const PITCH = LED_PITCH;
const DOT_RADIUS = LED_OFF_RADIUS;
// Whole-cell letter gap so multi-character text stays on the same grid as the
// off-grid Pattern. (Half-pitch gaps would put characters past the first off the
// shared grid and re-introduce the misalignment bug.)
const LED_LETTER_GAP_COLS = 1;

const BLUE_FAR = '#5a85b5';
const BLUE_NEAR = '#c0d4e8';

// Sharpened bloom — the wide outer halo (the source of fuzzy bleed between
// adjacent lit pixels) is gone entirely. What remains: a 2-circle mid glow,
// a 2-circle tight inner glow, and a sharp gradient core. Stacked solid
// circles, no filter primitives — works identically on iOS and Android.
const LIT_CORE_RADIUS = 1.2;
const LIT_HALO_LAYERS = {
  blue: [
    // Layer 1 — mid glow (outer ring + denser inner ring fakes a soft falloff)
    { r: 2.10, color: BLUE_FAR, opacity: 0.16 },
    { r: 1.85, color: BLUE_FAR, opacity: 0.32 },
    // Layer 2 — tight inner glow
    { r: 1.55, color: BLUE_NEAR, opacity: 0.46 },
    { r: 1.40, color: BLUE_NEAR, opacity: 0.78 },
  ],
  white: [
    { r: 2.10, color: '#ffffff', opacity: 0.08 },
    { r: 1.85, color: '#ffffff', opacity: 0.16 },
    { r: 1.55, color: '#ffffff', opacity: 0.26 },
    { r: 1.40, color: '#ffffff', opacity: 0.50 },
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
// The Pattern places one off-pixel at the center of every PITCH×PITCH cell,
// globally anchored to (0, 0). Lit pixels MUST be positioned at the same
// canonical grid coordinates (PITCH/2 + N*PITCH) — see gridX/gridY.
function LedDefs() {
  return (
    <Defs>
      <Pattern id="ledOffGrid" width={PITCH} height={PITCH} patternUnits="userSpaceOnUse">
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

// Single grid coordinate function — used for BOTH off-pixels (implicitly via the
// Pattern, whose dots land at PITCH/2 + col*PITCH) and lit pixels (explicitly
// via gridX/Y below). The sharp core of every lit pixel sits at exactly the
// same (cx, cy) the corresponding off-pixel would occupy.
function gridX(col: number): number {
  return PITCH / 2 + col * PITCH;
}
function gridY(row: number): number {
  return PITCH / 2 + row * PITCH;
}

// Render one lit pixel: 4 solid halo circles + 1 sharp gradient core. The core
// sits at exactly the same (cx, cy) as the off-pixel it replaces (alignment fix
// from the previous commit, preserved here). The core is slightly larger than
// the off-pixel (LIT_CORE_RADIUS=1.2 vs DOT_RADIUS=1.0) so the bright center
// dominates and characters read crisp.
function ledLitCell(cx: number, cy: number, palette: LedPalette, key: string | number) {
  const halos = LIT_HALO_LAYERS[palette];
  return (
    <G key={key}>
      {halos.map((h, i) => (
        <Circle key={i} cx={cx} cy={cy} r={h.r} fill={h.color} fillOpacity={h.opacity} />
      ))}
      <Circle cx={cx} cy={cy} r={LIT_CORE_RADIUS} fill={`url(#led-core-${palette})`} />
    </G>
  );
}

type LitPos = { cx: number; cy: number; palette: LedPalette };

// baseCol/baseRow are the integer grid column/row of the matrix's (0, 0) cell.
function emitMatrixCells(matrix: number[][], baseCol: number, baseRow: number, palette: LedPalette, out: LitPos[]) {
  for (let ri = 0; ri < matrix.length; ri++) {
    for (let ci = 0; ci < matrix[ri].length; ci++) {
      if (matrix[ri][ci] === 1) {
        out.push({ cx: gridX(baseCol + ci), cy: gridY(baseRow + ri), palette });
      }
    }
  }
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
// lattice as every off-pixel. The off-grid Pattern fills the full panel so dots
// are visible edge-to-edge; visual padding emerges from the glyph centering.
export function LedTilePanel({ sport, gameCount, size = 86 }: { sport: Sport; gameCount: number; size?: number }) {
  const GAP_ICON_ROWS = 3;   // ~7.2 px — must be an integer number of grid rows
  const GAP_TEXT_ROWS = 3;   // ~7.2 px
  const ICON_ROW_SPAN = 9;   // accommodate the tallest icon (NBA/EPL/UCL/MLS at 9 rows)
  const TEXT_ROWS = 7;       // every char is 5×7

  const iconMatrix = SPORT_PIXEL_ICONS[sport] || SPORT_PIXEL_ICONS.NBA;
  const iconCols = iconMatrix[0].length;
  const iconRows = iconMatrix.length;

  const abbrText = displaySport(sport);
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

  const cells: LitPos[] = [];
  emitMatrixCells(iconMatrix, iconStartCol, iconStartRow, 'blue', cells);
  emitTextCells(abbrText, abbrStartCol, abbrStartRow, 'white', cells);
  emitTextCells(countText, countStartCol, countStartRow, 'blue', cells);

  return (
    <Svg width={size} height={size}>
      <LedDefs />
      <Rect width={size} height={size} fill="url(#ledOffGrid)" />
      {cells.map((c, i) => ledLitCell(c.cx, c.cy, c.palette, i))}
    </Svg>
  );
}

// ─── LED BAR PANEL ──────────────────────────────────────────────
// Width-flexible horizontal panel: icon left, label centered-left, count right-aligned.
// Width is captured via onLayout so the count's grid column can be computed.
export function LedBarPanel({
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
  const leftMatrix = leftSport
    ? (SPORT_PIXEL_ICONS[leftSport as string] || LED_CALENDAR_MATRIX)
    : LED_CALENDAR_MATRIX;
  const ICON_LABEL_GAP_COLS = 2;
  const SIDE_GAP_COLS = 2;

  const [width, setWidth] = useState(0);

  const leftCols = leftMatrix[0].length;
  const leftRows = leftMatrix.length;
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

  const leftStartCol = SIDE_GAP_COLS;
  const labelStartCol = leftStartCol + leftCols + ICON_LABEL_GAP_COLS;
  const countStartCol = Math.max(
    labelStartCol + labelM.colCount + ICON_LABEL_GAP_COLS,
    cols - countM.colCount - SIDE_GAP_COLS,
  );

  const cells: LitPos[] = [];
  if (cols > 0) {
    emitMatrixCells(leftMatrix, leftStartCol, leftStartRow, 'blue', cells);
    emitTextCells(label, labelStartCol, labelStartRow, 'white', cells);
    emitTextCells(countText, countStartCol, countStartRow, 'blue', cells);
  }

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
        const w = e.nativeEvent.layout.width;
        if (w !== width) setWidth(w);
      }}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          <LedDefs />
          <Rect width={width} height={height} fill="url(#ledOffGrid)" />
          {cells.map((c, i) => ledLitCell(c.cx, c.cy, c.palette, i))}
        </Svg>
      ) : null}
    </View>
  );
}

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
          {/* Bezel — richer four-stop sculpt fakes a matte-metal housing with a
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
            {/* Bottom edge dark hairline — fakes the bezel's underside in
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

// ─── JUMBOTRON SPORT ICONS (kept for full-size cards & getSportIcon) ──
interface JBIconProps { color: string; size?: number }

const JBIcons: Record<string, React.FC<JBIconProps>> = {
  NFL: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M14.5 3.5C12 1 6 1 3.5 3.5S1 12 3.5 14.5 12 17 14.5 14.5 17 6 14.5 3.5z" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M6.5 11.5l5-5" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M7.5 8.5l-1 1M9.5 6.5l-1 1M9.5 10.5l-1 1" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  )),
  NBA: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Circle cx={9} cy={9} r={7} stroke={color} strokeWidth={1.5} />
      <Path d="M2 9h14M9 2v14" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M4.2 3.5C6.5 6.5 6.5 11.5 4.2 14.5" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M13.8 3.5C11.5 6.5 11.5 11.5 13.8 14.5" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  )),
  MLB: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M9 2.5L15 9l-6 6.5L3 9z" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M9 11L6.5 9 9 7l2.5 2z" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
      <Circle cx={9} cy={14} r={0.8} fill={color} />
    </Svg>
  )),
  NHL: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M5 3l5.5 8.5H14" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14 11.5c0 1-0.8 1.5-2 1.5h-1.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Rect x={5} y={14} width={5} height={2} rx={1} stroke={color} strokeWidth={1.2} />
    </Svg>
  )),
  MLS: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Circle cx={9} cy={9} r={7} stroke={color} strokeWidth={1.5} />
      <Path d="M9 4.5l2.5 1.8-.9 3H7.4l-.9-3z" stroke={color} strokeWidth={1} strokeLinejoin="round" />
      <Path d="M9 4.5V2.2M11.5 6.3l2-1.2M10.6 9.3l1.8 1.5M7.4 9.3l-1.8 1.5M6.5 6.3l-2-1.2" stroke={color} strokeWidth={1} strokeLinecap="round" />
    </Svg>
  )),
  EPL: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Circle cx={9} cy={9} r={7} stroke={color} strokeWidth={1.5} />
      <Path d="M9 4.5l2.5 1.8-.9 3H7.4l-.9-3z" stroke={color} strokeWidth={1} strokeLinejoin="round" />
      <Path d="M9 4.5V2.2M11.5 6.3l2-1.2M10.6 9.3l1.8 1.5M7.4 9.3l-1.8 1.5M6.5 6.3l-2-1.2" stroke={color} strokeWidth={1} strokeLinecap="round" />
    </Svg>
  )),
  UCL: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Circle cx={9} cy={9} r={7} stroke={color} strokeWidth={1.5} />
      <Path d="M9 4.5l2.5 1.8-.9 3H7.4l-.9-3z" stroke={color} strokeWidth={1} strokeLinejoin="round" />
      <Path d="M9 4.5V2.2M11.5 6.3l2-1.2M10.6 9.3l1.8 1.5M7.4 9.3l-1.8 1.5M6.5 6.3l-2-1.2" stroke={color} strokeWidth={1} strokeLinecap="round" />
    </Svg>
  )),
  NCAAF: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path d="M4 12c0-4 2-8 6.5-8 3 0 4.5 2 4.5 5s-1.5 5-5 5H6.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4 12h3c1.2 0 2-.8 2-2" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M9.5 4v5" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  )),
  NCAAB: memo(({ color, size = 16 }: JBIconProps) => (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Circle cx={9} cy={9} r={7} stroke={color} strokeWidth={1.5} />
      <Path d="M2 9h14M9 2v14" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M4.2 3.5C6.5 6.5 6.5 11.5 4.2 14.5" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
      <Path d="M13.8 3.5C11.5 6.5 11.5 11.5 13.8 14.5" stroke={color} strokeWidth={1.2} strokeLinecap="round" />
    </Svg>
  )),
};

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

// ─── DEAD PIXELS ───────────────────────────────────────────────
const DeadPixels = memo(function DeadPixels({ visible }: { visible: boolean }) {
  const pixels = useRef(
    Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => ({
      left: 8 + Math.random() * 78,
      top: 15 + Math.random() * 55,
      opacity: 0.25 + Math.random() * 0.25,
    }))
  ).current;

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pixels.map((px, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: `${px.left}%` as any,
            top: `${px.top}%` as any,
            width: 2,
            height: 2,
            borderRadius: 1,
            backgroundColor: 'rgba(255,255,255,0.04)',
          }}
        />
      ))}
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
    case Sport.NCAAF: return <CollegeFootballIcon size={size} color={color} />;
    case Sport.NCAAB: return <CollegeBasketballIcon size={size} color={color} />;
    default: return <SoccerCleatIcon size={size} color={color} />;
  }
}

// ─── SPORT CARD PROPS ──────────────────────────────────────────
interface SportCardProps {
  sport: Sport;
  gameCount: number;
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

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
    } else {
      router.push(`/sport/${sport}` as any);
    }
  }, [onPress, router, sport]);

  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // ═══════════════════════════════════════════════
  // TILE: SQUARE LED PANEL (real-LED look — uniform pixel grid + 4-layer bloom)
  // ═══════════════════════════════════════════════
  if (tile) {
    const isDimmed = hasActiveFilter && !isSelected;
    const isChosen = hasActiveFilter && isSelected;
    const borderColor = isChosen ? '#2a3a4a' : LED_BORDER;

    return (
      <AnimatedPressable
        onPress={handlePress}
        onPressIn={() => {
          scale.value = withSpring(0.93, { damping: 15, stiffness: 400 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 12, stiffness: 300 });
        }}
        style={animatedStyle}
      >
        <View
          style={{
            width: tileSize,
            height: tileSize,
            borderRadius: 9,
            overflow: 'hidden' as const,
            backgroundColor: LED_BG,
            borderWidth: 1,
            borderColor,
            opacity: isDimmed ? 0.45 : 1,
          }}
        >
          <LedTilePanel sport={sport} gameCount={gameCount} size={tileSize} />
        </View>
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
        onPress={handlePress}
        onPressIn={() => {
          scale.value = withSpring(0.93, { damping: 15, stiffness: 400 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 12, stiffness: 300 });
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
            height: 42,
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
              <DotMatrixText text={displaySport(sport)} litColor={isLit ? '#9BB8CF' : '#4a5a68'} pixelSize={2} />
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
      entering={FadeInRight.delay(index * 80).duration(500)}
      onPress={handlePress}
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
  NBA: 0, NFL: 1, MLB: 2, NHL: 0, MLS: 1, EPL: 2, UCL: 0, NCAAF: 0, NCAAB: 1,
};
export function getTicketColor(sport: string): string {
  return TICKET_COLORS[TICKET_COLOR_MAP[sport] ?? 0];
}
