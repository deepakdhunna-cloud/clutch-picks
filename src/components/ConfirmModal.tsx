import React from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation modal for destructive actions.
 *
 * Built as a standalone Modal because Alert.alert was being silently
 * suppressed in production builds, blocking App Store compliance for
 * delete-account flows. This implementation is guaranteed to render
 * because it's a regular RN Modal, not a native UIAlertController.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.7)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
        }}
      >
        <View
          style={{
            backgroundColor: '#1A1A1A',
            borderRadius: 14,
            paddingVertical: 24,
            paddingHorizontal: 20,
            width: '100%',
            maxWidth: 340,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          <Text
            style={{
              color: '#FFFFFF',
              fontSize: 18,
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: 8,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              color: 'rgba(255,255,255,0.7)',
              fontSize: 14,
              lineHeight: 20,
              textAlign: 'center',
              marginBottom: 24,
            }}
          >
            {message}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onCancel();
              }}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: 'rgba(255,255,255,0.08)',
                paddingVertical: 12,
                borderRadius: 10,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 15,
                  fontWeight: '600',
                  textAlign: 'center',
                }}
              >
                {cancelLabel}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                Haptics.notificationAsync(
                  destructive
                    ? Haptics.NotificationFeedbackType.Warning
                    : Haptics.NotificationFeedbackType.Success
                );
                onConfirm();
              }}
              style={({ pressed }) => ({
                flex: 1,
                backgroundColor: destructive ? '#8B0A1F' : '#2563EB',
                paddingVertical: 12,
                borderRadius: 10,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 15,
                  fontWeight: '700',
                  textAlign: 'center',
                }}
              >
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
