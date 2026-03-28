import { View, Text } from 'react-native';
import { memo } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { cn } from '@/lib/cn';

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
  // Toss-up gets muted neutral styling
  const getTossUpColors = () => ({
    bg: 'bg-[#4B5563]/20',
    text: 'rgba(255,255,255,0.4)',
    bar: 'rgba(255,255,255,0.2)',
    glow: 'rgba(255,255,255,0.1)',
  });

  // Color coding: maroon for high confidence, teal for medium, muted for low
  const getConfidenceColor = () => {
    if (isTossUp) return getTossUpColors();
    // High confidence (75%+): Maroon text on maroon bg
    if (confidence >= 75) return { bg: 'bg-[#8B0A1F]/25', text: '#8B0A1F', bar: '#8B0A1F', glow: '#8B0A1F' };
    // Good confidence (65-74%): Maroon
    if (confidence >= 65) return { bg: 'bg-[#8B0A1F]/20', text: '#8B0A1F', bar: '#8B0A1F', glow: '#8B0A1F' };
    // Medium confidence (55-64%): Maroon lighter
    if (confidence >= 55) return { bg: 'bg-[#8B0A1F]/15', text: '#8B0A1F', bar: '#8B0A1F', glow: '#8B0A1F' };
    // Lower confidence (<55%): Muted maroon
    return { bg: 'bg-[#8B0A1F]/10', text: '#6B4450', bar: '#6B4450', glow: '#6B4450' };
  };

  const colors = getConfidenceColor();

  const sizeClasses = {
    small: {
      container: 'px-3 py-1.5',
      text: 'text-xs',
      confidence: 'text-base font-black',
    },
    medium: {
      container: 'px-4 py-2',
      text: 'text-xs',
      confidence: 'text-lg font-black',
    },
    large: {
      container: 'px-5 py-3',
      text: 'text-sm',
      confidence: 'text-2xl font-black',
    },
  };

  const styles = sizeClasses[size];

  // Label text: toss-up shows "Toss-Up", otherwise the team abbreviation
  const pickLabel = isTossUp ? 'Toss-Up' : predictedWinner;
  // Confidence display: gray for toss-up
  const confidenceTextColor = isTossUp ? 'rgba(255,255,255,0.4)' : colors.text;
  const barColor = isTossUp ? 'rgba(255,255,255,0.2)' : colors.bar;
  const borderColor = isTossUp ? 'rgba(255,255,255,0.1)' : colors.bar + '40';

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      className={cn('rounded-xl', colors.bg, styles.container)}
      style={{
        borderWidth: 1,
        borderColor,
      }}
    >
      <View className="flex-row items-center gap-2">
        <View className="items-center">
          <Text style={{ color: '#FFFFFF' }} className={styles.confidence}>
            {confidence}%
          </Text>
          {size !== 'small' ? (
            <Text className={cn('text-zinc-500 uppercase tracking-wider', styles.text)}>
              {isTossUp ? 'toss-up' : 'confidence'}
            </Text>
          ) : null}
        </View>

        {showBar ? (
          <View className="flex-1 ml-2">
            <View className="h-2 bg-zinc-700/50 rounded-full overflow-hidden">
              <View
                style={{
                  width: `${confidence}%`,
                  backgroundColor: barColor,
                  height: '100%',
                  borderRadius: 999,
                }}
              />
            </View>
            <Text className={cn('text-zinc-400 mt-1', styles.text)} numberOfLines={1}>
              Pick: {pickLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
});
