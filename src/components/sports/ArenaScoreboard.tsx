import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, G, RadialGradient, Rect, Stop } from 'react-native-svg';

const SCORE_FACE_MATRIX: Record<string, number[][]> = {
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
  '-': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
  ' ': [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  'D': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0]],
  'E': [[1, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 1, 1, 1, 1]],
  'N': [[1, 0, 0, 0, 1], [1, 1, 0, 0, 1], [1, 0, 1, 0, 1], [1, 0, 0, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1]],
  'P': [[1, 1, 1, 1, 0], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0]],
  'S': [[0, 1, 1, 1, 1], [1, 0, 0, 0, 0], [1, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1], [1, 1, 1, 1, 0]],
  'U': [[1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [0, 1, 1, 1, 0]],
};

const SCORE_FACE_SCALE = 2;
const SCORE_FACE_PITCH = 1.62;
const SCORE_FACE_PAD_X = 6;
const SCORE_FACE_PAD_Y = 5;
const SCORE_FACE_GAP = 2;

function hexWithAlpha(hex: string | undefined, alpha: number): string {
  if (!hex) return 'rgba(31,41,55,0)';
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255).toString(16).padStart(2, '0');
  if (hex.length === 7 && hex[0] === '#') return `${hex}${aHex}`;
  if (hex.length === 4 && hex[0] === '#') {
    const expanded = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    return `${expanded}${aHex}`;
  }
  return hex;
}

function scoreFaceTextWidth(text: string, glyphScale = SCORE_FACE_SCALE): number {
  let cols = 0;
  for (let i = 0; i < text.length; i++) {
    const matrix = SCORE_FACE_MATRIX[text[i]];
    if (!matrix) continue;
    if (cols > 0) cols += SCORE_FACE_GAP;
    cols += matrix[0].length * glyphScale;
  }
  return cols;
}

const ArenaScoreFace = memo(function ArenaScoreFace({
  homeScore,
  awayScore,
  scale,
  label,
}: {
  homeScore: number;
  awayScore: number;
  scale: number;
  label?: string;
}) {
  const text = label ? label.toUpperCase() : `${homeScore}-${awayScore}`;
  const glyphScale = label ? 1 : SCORE_FACE_SCALE;
  const textCols = scoreFaceTextWidth(text, glyphScale);
  const cols = textCols + 4;
  const rows = 7 * glyphScale + 4;
  const pitch = SCORE_FACE_PITCH * scale;
  const padX = SCORE_FACE_PAD_X * scale;
  const padY = SCORE_FACE_PAD_Y * scale;
  const width = cols * pitch + padX * 2;
  const height = rows * pitch + padY * 2;

  const lit = new Set<string>();
  let cursor = 2;
  for (let i = 0; i < text.length; i++) {
    const matrix = SCORE_FACE_MATRIX[text[i]];
    if (!matrix) continue;
    if (i > 0) cursor += SCORE_FACE_GAP;
    for (let row = 0; row < matrix.length; row++) {
      for (let col = 0; col < matrix[row].length; col++) {
        if (matrix[row][col] !== 1) continue;
        for (let sy = 0; sy < glyphScale; sy++) {
          for (let sx = 0; sx < glyphScale; sx++) {
            lit.add(`${cursor + col * glyphScale + sx},${row * glyphScale + sy + 2}`);
          }
        }
      }
    }
    cursor += matrix[0].length * glyphScale;
  }

  const cells: { x: number; y: number; lit: boolean }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({
        x: padX + col * pitch + pitch / 2,
        y: padY + row * pitch + pitch / 2,
        lit: lit.has(`${col},${row}`),
      });
    }
  }

  return (
    <View style={{ borderRadius: 10 * scale, overflow: 'hidden', backgroundColor: '#020303' }}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="scoreFaceLit" cx="50%" cy="42%" r="62%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
            <Stop offset="46%" stopColor="#f7fbfc" stopOpacity={1} />
            <Stop offset="100%" stopColor="#aeb8bd" stopOpacity={1} />
          </RadialGradient>
          <RadialGradient id="scoreFaceOff" cx="45%" cy="38%" r="64%">
            <Stop offset="0%" stopColor="#323738" stopOpacity={1} />
            <Stop offset="56%" stopColor="#131718" stopOpacity={1} />
            <Stop offset="100%" stopColor="#050606" stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="#020303" />
        <Rect x={scale} y={scale} width={width - 2 * scale} height={height - 2 * scale} rx={7 * scale} fill="#070909" />
        {cells.map((cell, index) => (
          <G key={index}>
            {cell.lit ? (
              <>
                <Circle cx={cell.x} cy={cell.y} r={1.52 * scale} fill="#eaf7ff" opacity={0.13} />
                <Circle cx={cell.x} cy={cell.y} r={0.82 * scale} fill="#010202" opacity={0.96} />
                <Circle cx={cell.x} cy={cell.y} r={0.58 * scale} fill="url(#scoreFaceLit)" />
                <Circle cx={cell.x - 0.18 * scale} cy={cell.y - 0.2 * scale} r={0.16 * scale} fill="#ffffff" opacity={0.72} />
              </>
            ) : (
              <>
                <Circle cx={cell.x} cy={cell.y} r={0.82 * scale} fill="#010202" opacity={0.96} />
                <Circle cx={cell.x} cy={cell.y} r={0.58 * scale} fill="url(#scoreFaceOff)" opacity={0.9} />
                <Circle cx={cell.x - 0.16 * scale} cy={cell.y - 0.18 * scale} r={0.13 * scale} fill="#475052" opacity={0.18} />
              </>
            )}
          </G>
        ))}
        {Array.from({ length: rows + 1 }).map((_, row) => (
          <Rect key={`scan-${row}`} x={0} y={padY + row * pitch - 0.18 * scale} width={width} height={0.2 * scale} fill="#ffffff" opacity={0.025} />
        ))}
        {Array.from({ length: Math.floor(cols / 5) + 1 }).map((_, col) => (
          <Rect key={`panel-col-${col}`} x={padX + col * pitch * 5 - 0.1 * scale} y={2 * scale} width={0.2 * scale} height={height - 4 * scale} fill="#000000" opacity={0.28} />
        ))}
        <Rect x={0} y={0} width={width} height={height * 0.28} fill="#ffffff" opacity={0.052} />
        <Rect x={0} y={height * 0.7} width={width} height={height * 0.3} fill="#000000" opacity={0.3} />
        <Rect x={0} y={0} width={width} height={height} fill="#000000" opacity={0.06} />
      </Svg>
    </View>
  );
});

export const ArenaScoreboard = memo(function ArenaScoreboard({
  awayScore,
  homeScore,
  awayColor,
  homeColor,
  scale = 1,
  label,
  subLabel,
  detailLabel,
}: {
  awayScore: number;
  homeScore: number;
  awayColor: string;
  homeColor: string;
  scale?: number;
  label?: string;
  subLabel?: string;
  detailLabel?: string;
}) {
  const hasStatusDetail = Boolean(label && (subLabel || detailLabel));
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 8 * scale,
          right: 8 * scale,
          bottom: -5 * scale,
          height: 12 * scale,
          borderRadius: 8 * scale,
          backgroundColor: 'rgba(0,0,0,0.56)',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 5 * scale },
          shadowOpacity: 0.7,
          shadowRadius: 8 * scale,
        }}
      />
      <LinearGradient
        colors={['#46515d', '#111318', '#050505', '#2b323a']}
        locations={[0, 0.2, 0.62, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{
          borderRadius: 18 * scale,
          padding: 3 * scale,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
          shadowColor: '#ffffff',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.14,
          shadowRadius: 14 * scale,
        }}
      >
        <View style={{ borderRadius: 15 * scale, padding: 5 * scale, backgroundColor: '#030303', overflow: 'hidden' }}>
          <LinearGradient
            colors={[hexWithAlpha(homeColor, 0.62), 'rgba(255,255,255,0.34)', hexWithAlpha(awayColor, 0.62)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ position: 'absolute', top: 0, left: 8 * scale, right: 8 * scale, height: 2 * scale }}
          />
          <LinearGradient
            colors={[hexWithAlpha(homeColor, 0.26), 'rgba(255,255,255,0.04)', hexWithAlpha(awayColor, 0.26)]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{ position: 'absolute', left: 0, top: 10 * scale, bottom: 10 * scale, width: 3 * scale, backgroundColor: hexWithAlpha(homeColor, 0.75), borderTopRightRadius: 3 * scale, borderBottomRightRadius: 3 * scale }} />
          <View style={{ position: 'absolute', right: 0, top: 10 * scale, bottom: 10 * scale, width: 3 * scale, backgroundColor: hexWithAlpha(awayColor, 0.75), borderTopLeftRadius: 3 * scale, borderBottomLeftRadius: 3 * scale }} />
          {[
            { top: 4 * scale, left: 4 * scale },
            { top: 4 * scale, right: 4 * scale },
            { bottom: 4 * scale, left: 4 * scale },
            { bottom: 4 * scale, right: 4 * scale },
          ].map((pos, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: 'absolute',
                ...pos,
                width: 4 * scale,
                height: 4 * scale,
                borderRadius: 2 * scale,
                backgroundColor: '#050505',
                borderWidth: 0.7,
                borderColor: 'rgba(255,255,255,0.28)',
              }}
            />
          ))}
          <View style={{ borderRadius: 12 * scale, padding: 2 * scale, backgroundColor: 'rgba(255,255,255,0.04)' }}>
            <ArenaScoreFace awayScore={awayScore} homeScore={homeScore} scale={scale} label={label} />
          </View>
          {hasStatusDetail ? (
            <View style={{ alignItems: 'center', paddingTop: 5 * scale, paddingHorizontal: 5 * scale, minWidth: 98 * scale, maxWidth: 150 * scale }}>
              {subLabel ? (
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  numberOfLines={1}
                  style={{
                    color: '#f8fafc',
                    fontSize: 10 * scale,
                    fontWeight: '900',
                    textAlign: 'center',
                  }}
                >
                  {subLabel}
                </Text>
              ) : null}
              {detailLabel ? (
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  numberOfLines={1}
                  style={{
                    color: 'rgba(248,250,252,0.66)',
                    fontSize: 8.5 * scale,
                    fontWeight: '800',
                    marginTop: 1 * scale,
                    textAlign: 'center',
                  }}
                >
                  {detailLabel}
                </Text>
              ) : null}
            </View>
          ) : null}
          <LinearGradient
            colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.08)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
        </View>
      </LinearGradient>
    </View>
  );
});
