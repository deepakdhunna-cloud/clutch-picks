import { View, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

interface ClutchHeaderProps {
  subtitle?: string;
}

// Field goal post to replace "U" - with football going through
function FieldGoalU({ color, size = 42 }: { color: string; size?: number }) {
  const isBlack = color === '#000000';
  return (
    <Svg width={size * 0.65} height={size} viewBox="0 0 26 40" fill="none">
      {/* Left upright */}
      <Path d="M4 0 L4 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      {/* Right upright */}
      <Path d="M22 0 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      {/* Crossbar */}
      <Path d="M4 30 L22 30" stroke={color} strokeWidth="5" strokeLinecap="round" />
      {/* Center post going down */}
      <Path d="M13 30 L13 40" stroke={color} strokeWidth="4" strokeLinecap="round" />
      {/* Football going through - pointed oval shape */}
      <Path
        d="M8 15 Q13 10 18 15 Q13 20 8 15"
        fill={color}
        transform="rotate(-35 13 15)"
      />
      {/* Football laces - vertical line */}
      <Path
        d="M13 13 L13 17"
        stroke={isBlack ? '#000000' : '#0D0D0D'}
        strokeWidth="1.2"
        strokeLinecap="round"
        transform="rotate(-35 13 15)"
      />
      {/* Football laces - horizontal lines */}
      <Path
        d="M11.5 14 L14.5 14"
        stroke={isBlack ? '#000000' : '#0D0D0D'}
        strokeWidth="0.8"
        transform="rotate(-35 13 15)"
      />
      <Path
        d="M11.5 16 L14.5 16"
        stroke={isBlack ? '#000000' : '#0D0D0D'}
        strokeWidth="0.8"
        transform="rotate(-35 13 15)"
      />
    </Svg>
  );
}

export function ClutchHeader({ subtitle }: ClutchHeaderProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400)}
      className="px-5 pt-5 pb-3"
    >
      <View
        className="flex-row items-center"
        style={{
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
        }}
      >
        {/* CLUTCH - Bold sporty text with 3D layered effect */}
        <View className="flex-row items-end">
          {/* CL part */}
          <View className="relative">
            {/* Shadow layer */}
            <Text
              className="absolute text-[42px] uppercase"
              style={{
                fontWeight: '900',
                letterSpacing: 2,
                color: '#000000',
                left: 3,
                top: 3,
              }}
            >
              CL
            </Text>
            {/* Mid layer - blue */}
            <Text
              className="absolute text-[42px] uppercase"
              style={{
                fontWeight: '900',
                letterSpacing: 2,
                color: '#7A9DB8',
                left: 1.5,
                top: 1.5,
              }}
            >
              CL
            </Text>
            {/* Main text */}
            <Text
              className="text-[42px] text-white uppercase"
              style={{
                fontWeight: '900',
                letterSpacing: 2,
              }}
            >
              CL
            </Text>
          </View>

          {/* Field Goal U - with 3D shadow effect */}
          <View style={{ marginBottom: 4, marginHorizontal: -1 }}>
            {/* Shadow layer */}
            <View style={{ position: 'absolute', left: 3, top: 3 }}>
              <FieldGoalU color="#000000" size={42} />
            </View>
            {/* Mid layer - blue */}
            <View style={{ position: 'absolute', left: 1.5, top: 1.5 }}>
              <FieldGoalU color="#7A9DB8" size={42} />
            </View>
            {/* Main */}
            <FieldGoalU color="#FFFFFF" size={42} />
          </View>

          {/* TCH part */}
          <View className="relative">
            {/* Shadow layer */}
            <Text
              className="absolute text-[42px] uppercase"
              style={{
                fontWeight: '900',
                letterSpacing: 2,
                color: '#000000',
                left: 3,
                top: 3,
              }}
            >
              TCH
            </Text>
            {/* Mid layer - blue */}
            <Text
              className="absolute text-[42px] uppercase"
              style={{
                fontWeight: '900',
                letterSpacing: 2,
                color: '#7A9DB8',
                left: 1.5,
                top: 1.5,
              }}
            >
              TCH
            </Text>
            {/* Main text */}
            <Text
              className="text-[42px] text-white uppercase"
              style={{
                fontWeight: '900',
                letterSpacing: 2,
              }}
            >
              TCH
            </Text>
          </View>
        </View>

        {/* PICKS Badge */}
        <View
          style={{
            marginLeft: 12,
            backgroundColor: 'rgba(90, 122, 138, 0.3)',
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: '#5A7A8A',
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.5,
            shadowRadius: 6,
            elevation: 6,
          }}
        >
          <Text
            className="text-xl uppercase"
            style={{
              fontWeight: '800',
              letterSpacing: 4,
              color: '#FFFFFF',
            }}
          >
            PICKS
          </Text>
        </View>
      </View>

      {/* Subtitle */}
      {subtitle ? (
        <Text className="text-zinc-500 text-sm mt-2">{subtitle}</Text>
      ) : null}
    </Animated.View>
  );
}
