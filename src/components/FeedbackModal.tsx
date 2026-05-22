import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

type FeedbackVariant = 'success' | 'error' | 'info';

interface FeedbackModalProps {
  visible: boolean;
  title: string;
  message: string;
  actionLabel?: string;
  variant?: FeedbackVariant;
  onDismiss: () => void;
}

const VARIANT_ACCENT: Record<FeedbackVariant, string> = {
  success: '#7A9DB8',
  error: '#EF4444',
  info: '#8B0A1F',
};

export function FeedbackModal({
  visible,
  title,
  message,
  actionLabel = 'OK',
  variant = 'info',
  onDismiss,
}: FeedbackModalProps) {
  const accent = VARIANT_ACCENT[variant];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.72)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 340,
            borderRadius: 16,
            backgroundColor: '#0A0E14',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            padding: 22,
            overflow: 'hidden',
          }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              backgroundColor: accent,
            }}
          />
          <Text style={{ color: '#FFFFFF', fontSize: 18, lineHeight: 23, fontWeight: '800', textAlign: 'center', marginBottom: 8 }}>
            {title}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.62)', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 22 }}>
            {message}
          </Text>
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onDismiss();
            }}
            style={({ pressed }) => ({
              height: 46,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: accent,
              opacity: pressed ? 0.82 : 1,
            })}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800' }}>{actionLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
