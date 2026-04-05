import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef, useMemo } from 'react';
import Animated, {
  FadeInRight,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  withDelay,
  useSharedValue,
  useAnimatedStyle,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Sport, SPORT_META } from '@/types/sports';
import { displaySport } from '@/lib/display-confidence';
import Svg, { Path, Circle, Rect, Defs, Pattern, Line, Ellipse } from 'react-native-svg';

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
SPORT_PIXEL_ICONS.NCAAB = SPORT_PIXEL_ICONS.NBA;

// ─── DOT MATRIX TEXT RENDERER ─────────────────────────────────
const PX = 1.5;
const PX_GAP = 0.5;
const CHAR_GAP = 1.5;
const DIM_PX = 'rgba(255,255,255,0.04)';

interface DotMatrixTextProps { text: string; litColor?: string; dimColor?: string; pixelSize?: number }

export const DotMatrixText = memo(function DotMatrixText({ text, litColor = '#9BB8CF', dimColor = DIM_PX, pixelSize = PX }: DotMatrixTextProps) {
  const step = pixelSize + PX_GAP;
  const chars = text.toUpperCase().split('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: CHAR_GAP }}>
      {chars.map((char, ci) => {
        const matrix = DOT_MATRIX[char];
        if (!matrix) return null;
        const w = matrix[0].length * step;
        const h = matrix.length * step;
        return (
          <Svg key={ci} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
            {matrix.map((row, ri) =>
              row.map((px, coli) => {
                const x = coli * step;
                const y = ri * step;
                return (
                  <React.Fragment key={`${ri}-${coli}`}>
                    {px === 1 ? <Rect x={x - 0.3} y={y - 0.3} width={pixelSize + 0.6} height={pixelSize + 0.6} rx={0.3} fill="rgba(122,157,184,0.12)" /> : null}
                    <Rect x={x} y={y} width={pixelSize} height={pixelSize} rx={0.3} fill={px ? litColor : dimColor} />
                  </React.Fragment>
                );
              })
            )}
          </Svg>
        );
      })}
    </View>
  );
});

// ─── DOT MATRIX ICON RENDERER ─────────────────────────────────
export const DotMatrixIcon = memo(function DotMatrixIcon({ sport, litColor = '#FFFFFF', dimColor = DIM_PX, pixelSize = PX }: { sport: string; litColor?: string; dimColor?: string; pixelSize?: number }) {
  const matrix = SPORT_PIXEL_ICONS[sport] || SPORT_PIXEL_ICONS.NBA;
  if (!matrix || !matrix.length) return null;
  const step = pixelSize + PX_GAP;
  const w = matrix[0].length * step;
  const h = matrix.length * step;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {matrix.map((row, ri) =>
        row.map((px, coli) => {
          const x = coli * step;
          const y = ri * step;
          return (
            <React.Fragment key={`${ri}-${coli}`}>
              {px === 1 ? <Rect x={x - 0.3} y={y - 0.3} width={pixelSize + 0.6} height={pixelSize + 0.6} rx={0.3} fill="rgba(122,157,184,0.12)" /> : null}
              <Rect x={x} y={y} width={pixelSize} height={pixelSize} rx={0.3} fill={px ? litColor : dimColor} />
            </React.Fragment>
          );
        })
      )}
    </Svg>
  );
});

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
export const PixelGrid = memo(function PixelGrid() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id="jbGrid" width="2" height="2" patternUnits="userSpaceOnUse">
            <Rect width="2" height="2" fill="transparent" />
            <Rect x="0" y="0" width="1.5" height="1.5" rx="0.2" fill="rgba(255,255,255,0.04)" />
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

// ─── SCANLINE (synced via global clock) ────────────────────────
const SCAN_DURATION = 2500;
export const ScanLine = memo(function ScanLine({ active }: { active: boolean }) {
  // Sync all scanlines by calculating where we are in the cycle
  const progress = useSharedValue(-24);

  useEffect(() => {
    if (active) {
      // Start from where the global cycle currently is
      const phase = (Date.now() % SCAN_DURATION) / SCAN_DURATION;
      const startVal = -24 + phase * 74; // -24 to 50 range = 74
      progress.value = startVal;
      progress.value = withTiming(50, {
        duration: SCAN_DURATION * (1 - phase),
        easing: Easing.linear,
      });
      // After first partial cycle, start full repeating loop
      const timer = setTimeout(() => {
        progress.value = -24;
        progress.value = withRepeat(
          withTiming(50, { duration: SCAN_DURATION, easing: Easing.linear }),
          -1,
          false
        );
      }, SCAN_DURATION * (1 - phase));
      return () => clearTimeout(timer);
    } else {
      progress.value = -24;
    }
  }, [active]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: progress.value }],
  }));

  if (!active) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: 3 }]} pointerEvents="none">
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            height: 24,
          },
          animStyle,
        ]}
      >
        <LinearGradient
          colors={['transparent', 'rgba(122,157,184,0.06)', 'rgba(255,255,255,0.03)', 'rgba(122,157,184,0.06)', 'transparent']}
          style={{ flex: 1 }}
        />
      </Animated.View>
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

          {/* Scanline sweep — on when lit */}
          <ScanLine active={isLit} />

          {/* Content — all dot-matrix rendered */}
          <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, flex: 1, justifyContent: 'space-between' as const, zIndex: 4 }}>
            <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 }}>
              <View style={{ height: 22, overflow: 'visible' as const, justifyContent: 'center' as const }}>
                <DotMatrixIcon sport={sport} litColor={isLit ? '#FFFFFF' : '#3a4a58'} dimColor={isDimmed ? 'rgba(255,255,255,0.02)' : DIM_PX} pixelSize={2} />
              </View>
              <DotMatrixText text={displaySport(sport)} litColor={isLit ? '#9BB8CF' : '#4a5a68'} dimColor={isDimmed ? 'rgba(255,255,255,0.02)' : DIM_PX} pixelSize={2} />
            </View>
            <DotMatrixText text={String(gameCount)} litColor={isLit ? '#FFFFFF' : '#4a5a68'} dimColor={isDimmed ? 'rgba(255,255,255,0.02)' : DIM_PX} pixelSize={2} />
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
  NBA: 0, NFL: 1, MLB: 2, NHL: 0, MLS: 1, EPL: 2, NCAAF: 0, NCAAB: 1,
};
export function getTicketColor(sport: string): string {
  return TICKET_COLORS[TICKET_COLOR_MAP[sport] ?? 0];
}
