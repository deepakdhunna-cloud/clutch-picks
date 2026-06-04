/**
 * InlineError — Shared inline error state for screens that fail to load.
 * Shows a calm message + optional retry button. No hype, no dumps.
 */
import { View, Text } from 'react-native';
import { HapticPressable } from '@/components/HapticPressable';

interface InlineErrorProps {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function InlineError({
  message = 'Unable to load data.',
  onRetry,
  retryLabel = 'Try Again',
}: InlineErrorProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        {message}
      </Text>
      {onRetry ? (
        <HapticPressable hapticStyle="light" onPress={onRetry} style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' }}>
          <Text style={{ color: '#7A9DB8', fontSize: 14, fontWeight: '700' }}>{retryLabel}</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}
