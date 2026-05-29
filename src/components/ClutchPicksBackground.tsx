import React, { useEffect, useState } from 'react';
import { Dimensions, InteractionManager, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Rect,
  Path,
  Line,
  G,
} from 'react-native-svg';

const { width: W, height: H } = Dimensions.get('window');

function makeArcPath(cx: number, cy: number, rx: number, ry: number, startDeg: number, endDeg: number, steps = 72): string {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const angle = ((startDeg + ((endDeg - startDeg) * i) / steps) * Math.PI) / 180;
    const x = cx + Math.cos(angle) * rx;
    const y = cy + Math.sin(angle) * ry;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

const glassRails = Array.from({ length: 8 }, (_, index) => {
  const x = W * -0.28 + index * W * 0.22;
  return {
    d: `M${x.toFixed(1)} -${(H * 0.08).toFixed(1)}L${(x + W * 0.28).toFixed(1)} ${(H * 1.08).toFixed(1)}`,
    opacity: index % 2 === 0 ? 0.088 : 0.04,
  };
});

const hashMarks = Array.from({ length: 18 }, (_, index) => {
  const y = H * 0.09 + index * H * 0.052;
  return {
    y,
    leftWidth: index % 3 === 0 ? 44 : 24,
    rightWidth: index % 4 === 0 ? 38 : 22,
    opacity: index % 2 === 0 ? 0.13 : 0.062,
  };
});

const stadiumArcs = [
  {
    d: makeArcPath(W * 0.5, H * 1.02, W * 0.95, H * 0.34, 198, 342),
    stroke: '#C0C8D0',
    opacity: 0.16,
    width: 1.2,
  },
  {
    d: makeArcPath(W * 0.5, H * 1.02, W * 0.74, H * 0.26, 202, 338),
    stroke: '#7A9DB8',
    opacity: 0.12,
    width: 1,
  },
  {
    d: makeArcPath(W * 0.5, H * 0.02, W * 0.88, H * 0.25, 18, 162),
    stroke: '#8B0A1F',
    opacity: 0.16,
    width: 1.15,
  },
  {
    d: makeArcPath(W * 0.5, H * 0.02, W * 0.63, H * 0.18, 24, 156),
    stroke: '#7A9DB8',
    opacity: 0.09,
    width: 0.9,
  },
];

function ClutchPicksBackground() {
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    const t = InteractionManager.runAfterInteractions(() => setShowDetail(true));
    return () => t.cancel();
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="none">
      <LinearGradient
        colors={['#010101', '#061119', '#07070B', '#010101']}
        locations={[0, 0.28, 0.66, 1]}
        style={StyleSheet.absoluteFill}
      />
      {showDetail ? (
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinearGradient id="blueSheet" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7A9DB8" stopOpacity={0.3} />
            <Stop offset="0.5" stopColor="#7A9DB8" stopOpacity={0.075} />
            <Stop offset="1" stopColor="#7A9DB8" stopOpacity={0} />
          </SvgLinearGradient>
          <SvgLinearGradient id="redSheet" x1="1" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#8B0A1F" stopOpacity={0.3} />
            <Stop offset="0.58" stopColor="#8B0A1F" stopOpacity={0.075} />
            <Stop offset="1" stopColor="#8B0A1F" stopOpacity={0} />
          </SvgLinearGradient>
          <SvgLinearGradient id="centerSheen" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#C0C8D0" stopOpacity={0} />
            <Stop offset="0.48" stopColor="#C0C8D0" stopOpacity={0.13} />
            <Stop offset="1" stopColor="#C0C8D0" stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>

        <Rect x="0" y="0" width={W} height={H} fill="#010101" opacity={0.4} />
        <Path
          d={`M${(-W * 0.25).toFixed(1)} ${(H * 0.1).toFixed(1)}L${(W * 0.18).toFixed(1)} 0L${(W * 0.83).toFixed(1)} ${H.toFixed(1)}L${(W * 0.35).toFixed(1)} ${(H * 1.08).toFixed(1)}Z`}
          fill="url(#blueSheet)"
        />
        <Path
          d={`M${(W * 0.68).toFixed(1)} -${(H * 0.04).toFixed(1)}L${(W * 1.22).toFixed(1)} ${(H * 0.08).toFixed(1)}L${(W * 0.82).toFixed(1)} ${(H * 1.05).toFixed(1)}L${(W * 0.45).toFixed(1)} ${(H * 0.96).toFixed(1)}Z`}
          fill="url(#redSheet)"
        />
        <Path
          d={`M${(W * 0.08).toFixed(1)} ${(H * 0.43).toFixed(1)}C${(W * 0.28).toFixed(1)} ${(H * 0.34).toFixed(1)} ${(W * 0.64).toFixed(1)} ${(H * 0.58).toFixed(1)} ${(W * 0.95).toFixed(1)} ${(H * 0.43).toFixed(1)}`}
          stroke="url(#centerSheen)"
          strokeWidth={2.2}
          strokeLinecap="round"
          fill="none"
        />

        <G>
          {glassRails.map((rail, index) => (
            <Path key={`rail${index}`} d={rail.d} stroke="#C0C8D0" strokeOpacity={rail.opacity} strokeWidth={1} fill="none" />
          ))}
        </G>

        <G>
          {stadiumArcs.map((arc, index) => (
            <Path key={`stadium-arc${index}`} d={arc.d} stroke={arc.stroke} strokeOpacity={arc.opacity} strokeWidth={arc.width} fill="none" />
          ))}
        </G>

        <G>
          {hashMarks.map((mark, index) => (
            <G key={`hash${index}`}>
              <Line
                x1={0}
                y1={mark.y}
                x2={mark.leftWidth}
                y2={mark.y}
                stroke={index % 3 === 0 ? '#7A9DB8' : '#C0C8D0'}
                strokeOpacity={mark.opacity}
                strokeWidth={1.2}
              />
              <Line
                x1={W - mark.rightWidth}
                y1={mark.y + 9}
                x2={W}
                y2={mark.y + 9}
                stroke={index % 4 === 0 ? '#8B0A1F' : '#C0C8D0'}
                strokeOpacity={mark.opacity}
                strokeWidth={1.2}
              />
            </G>
          ))}
        </G>

        <Path
          d={`M${(W * 0.05).toFixed(1)} ${(H * 0.22).toFixed(1)}C${(W * 0.24).toFixed(1)} ${(H * 0.12).toFixed(1)} ${(W * 0.45).toFixed(1)} ${(H * 0.25).toFixed(1)} ${(W * 0.62).toFixed(1)} ${(H * 0.16).toFixed(1)}S${(W * 0.9).toFixed(1)} ${(H * 0.07).toFixed(1)} ${(W * 1.06).toFixed(1)} ${(H * 0.18).toFixed(1)}`}
          stroke="#7A9DB8"
          strokeOpacity={0.15}
          strokeWidth={1.4}
          strokeDasharray="5 13"
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={`M${(-W * 0.04).toFixed(1)} ${(H * 0.72).toFixed(1)}C${(W * 0.23).toFixed(1)} ${(H * 0.63).toFixed(1)} ${(W * 0.48).toFixed(1)} ${(H * 0.83).toFixed(1)} ${(W * 0.73).toFixed(1)} ${(H * 0.7).toFixed(1)}S${(W * 1.06).toFixed(1)} ${(H * 0.56).toFixed(1)} ${(W * 1.13).toFixed(1)} ${(H * 0.66).toFixed(1)}`}
          stroke="#8B0A1F"
          strokeOpacity={0.145}
          strokeWidth={1.5}
          strokeDasharray="7 16"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      ) : null}

      <LinearGradient
        colors={['rgba(1,1,1,0.6)', 'rgba(1,1,1,0.08)', 'rgba(1,1,1,0.62)']}
        locations={[0, 0.34, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export default React.memo(ClutchPicksBackground);

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#010101',
    overflow: 'hidden',
  },
});
