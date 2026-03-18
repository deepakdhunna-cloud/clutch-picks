import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

const CELL = 20;
const COLS = Math.ceil(W / CELL);
const ROWS = Math.ceil(H / CELL);
const STEP = 3;
const SVG_W = W;
const SVG_H = H;

// Center of the screen for radial fade
const CX = W / 2;
const CY = H * 0.35;

function dx(x: number, y: number): number {
  return Math.sin(y * 0.012 + x * 0.003) * 10 + Math.sin(y * 0.006) * 6;
}

function dy(x: number, y: number): number {
  return Math.sin(x * 0.014 + y * 0.0025) * 9 + Math.cos(x * 0.008) * 5;
}

// Opacity based on distance from center — bright center, fading edges
function getOpacity(x: number, y: number): number {
  const distX = (x - CX) / (W * 0.55);
  const distY = (y - CY) / (H * 0.55);
  const dist = Math.sqrt(distX * distX + distY * distY);
  const base = Math.max(0, 1 - dist * dist);
  return 0.04 + base * 0.14;
}

// Pre-compute horizontal paths with per-line opacity
const hLines: { d: string; opacity: number }[] = [];
for (let r = 0; r <= ROWS; r++) {
  const baseY = r * CELL;
  let d = '';
  for (let x = 0; x <= SVG_W; x += STEP) {
    const px = (x + dx(x, baseY)).toFixed(1);
    const py = (baseY + dy(x, baseY)).toFixed(1);
    d += x === 0 ? `M${px} ${py}` : `L${px} ${py}`;
  }
  const opacity = getOpacity(CX, baseY);
  hLines.push({ d, opacity });
}

// Pre-compute vertical paths with per-line opacity
const vLines: { d: string; opacity: number }[] = [];
for (let c = 0; c <= COLS; c++) {
  const baseX = c * CELL;
  let d = '';
  for (let y = 0; y <= SVG_H; y += STEP) {
    const px = (baseX + dx(baseX, y)).toFixed(1);
    const py = (y + dy(baseX, y)).toFixed(1);
    d += y === 0 ? `M${px} ${py}` : `L${px} ${py}`;
  }
  const opacity = getOpacity(baseX, CY);
  vLines.push({ d, opacity });
}

export default function GridBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}>
        <Defs>
          <RadialGradient id="gridFade" cx="50%" cy="35%" rx="60%" ry="60%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.06} />
            <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0.02} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* Subtle radial glow behind the grid */}
        <Rect x="0" y="0" width={SVG_W} height={SVG_H} fill="url(#gridFade)" />
        {/* Horizontal lines — opacity varies by distance from center */}
        {hLines.map((line, i) => (
          <Path key={`h${i}`} d={line.d} stroke={`rgba(160,170,180,${line.opacity.toFixed(3)})`} strokeWidth={0.5} fill="none" />
        ))}
        {/* Vertical lines — opacity varies by distance from center */}
        {vLines.map((line, i) => (
          <Path key={`v${i}`} d={line.d} stroke={`rgba(160,170,180,${line.opacity.toFixed(3)})`} strokeWidth={0.5} fill="none" />
        ))}
      </Svg>
    </View>
  );
}
