import { View, Text } from 'react-native';
import { memo } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { cn } from '@/lib/cn';
import { getConfidenceTier } from '@/lib/display-confidence';

interface PredictionBadgeProps {
  confidence: number;
  predictedWinner: string;
  size?: 'small' | 'medium' | 'large';
  showBar?: boolean;
  isTossUp?: boolean;
}

export const PredictionBadge = memo(function PredictionBadge({
  confidence,
  predictedWinner,
  size = 'medium',
  showBar = true,
  isTossUp = false,
}: PredictionBadgeProps) {
  const tier = getConfidenceTier(confidence, isTossUp);
  const pickLabel = isTossUp ? 'Toss-Up' : predictedWinner;

  const sizeStyles = {
    small: { container: 'px-3 py-1.5', label: 13 as const, sub: 10 as const },
    medium: { container: 'px-4 py-2', label: 15 as const, sub: 11 as const },
    large: { container: 'px-5 py-3', label: 18 as const, sub: 12 as const },
  };
  const s = sizeStyles[size];

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      className={cn('rounded-xl', s.container)}
      style={{
        borderWidth: 1,
        borderColor: `${tier.color}40`,
        backgroundColor: `${tier.color}12`,
      }}
    >
      <View className="flex-row items-center gap-2">
        <View className="items-center">
          <Text style={{ fontSize: s.label, fontWeight: '800', color: tier.color, letterSpacing: 0.3 }}>
            {tier.label}
          </Text>
        </View>

        {showBar && size !== 'small' ? (
          <View className="flex-1 ml-2">
            <View className="h-2 bg-zinc-700/50 rounded-full overflow-hidden">
              <View
                style={{
                  width: `${confidence}%`,
                  backgroundColor: `${tier.color}B3`,
                  height: '100%',
                  borderRadius: 999,
                }}
              />
            </View>
            <Text style={{ fontSize: s.sub, color: 'rgba(255,255,255,0.4)', marginTop: 4 }} numberOfLines={1}>
              Pick: {pickLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});
