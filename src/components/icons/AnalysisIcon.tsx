import React from 'react';
import Svg, { Path, Line, Rect, Circle } from 'react-native-svg';

/**
 * Magnifying glass over a bar chart.
 * Stroke-based, geometric, clear at 20-24px.
 * Props: size (default 24), color (default white)
 */
export function AnalysisIcon({ size = 24, color = '#FFFFFF' }: { size?: number; color?: string }) {
  // Viewbox 24x24
  const sw = (1.6 * 24) / size; // stroke weight scales with size
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Bar chart — 3 bars at left/bottom of circle */}
      <Rect x="2" y="13" width="2.8" height="5" rx="0.6" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <Rect x="6" y="10" width="2.8" height="8" rx="0.6" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      <Rect x="10" y="11.5" width="2.8" height="6.5" rx="0.6" stroke={color} strokeWidth={sw} strokeLinejoin="round" />

      {/* Magnifying glass circle — sits over right portion */}
      <Circle cx="15.5" cy="9.5" r="4" stroke={color} strokeWidth={sw} />

      {/* Magnifying glass handle */}
      <Line x1="18.3" y1="12.3" x2="21" y2="15" stroke={color} strokeWidth={sw} strokeLinecap="round" />

      {/* Tiny trend line inside the glass */}
      <Path
        d="M12.8 10.8 L14.8 8.8 L16.2 9.8 L18.1 7.8"
        stroke={color}
        strokeWidth={sw * 0.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
