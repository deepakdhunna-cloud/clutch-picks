import React, { useCallback, useEffect, useRef } from 'react';
import { InteractionManager, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Image as ImageIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

interface PhotoSourceModalProps {
  visible: boolean;
  title?: string;
  onTakePhoto: () => void;
  onChooseLibrary: () => void;
  onCancel: () => void;
}

export function PhotoSourceModal({
  visible,
  title = 'Profile Photo',
  onTakePhoto,
  onChooseLibrary,
  onCancel,
}: PhotoSourceModalProps) {
  const pendingActionRef = useRef<(() => void) | null>(null);

  const runPendingAction = useCallback(() => {
    if (!pendingActionRef.current) return;

    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    InteractionManager.runAfterInteractions(action);
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios' || visible) return;
    runPendingAction();
  }, [runPendingAction, visible]);

  const press = (action: () => void) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    action();
  };

  const dismissAndRun = (action: () => void) => {
    pendingActionRef.current = action;
    onCancel();
  };

  const cancel = () => {
    pendingActionRef.current = null;
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onDismiss={runPendingAction} onRequestClose={cancel}>
      <View style={styles.backdropRoot}>
        <Pressable accessible={false} onPress={cancel} style={StyleSheet.absoluteFill} />
        <View
          accessible={false}
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 420,
            borderRadius: 22,
            backgroundColor: '#0A0E14',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            padding: 16,
            paddingBottom: 12,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginBottom: 4 }}
          >
            {title}
          </Text>
          <Text style={{ color: '#6B7C94', fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
            Add a photo from your camera or library.
          </Text>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Take Photo"
            accessibilityHint="Opens the camera"
            onPress={() => press(() => dismissAndRun(onTakePhoto))}
            style={[styles.actionButton, styles.cameraButton]}
          >
            {({ pressed }) => (
              <View style={[styles.actionContent, pressed ? styles.pressedAction : null]}>
                <Camera size={19} color="#7A9DB8" />
                <Text style={styles.actionText}>Take Photo</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Choose from Library"
            accessibilityHint="Opens your photo library"
            onPress={() => press(() => dismissAndRun(onChooseLibrary))}
            style={[styles.actionButton, styles.libraryButton]}
          >
            {({ pressed }) => (
              <View style={[styles.actionContent, pressed ? styles.pressedAction : null]}>
                <ImageIcon size={19} color="#8B0A1F" />
                <Text style={styles.actionText}>Choose from Library</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            accessibilityHint="Closes photo options"
            onPress={cancel}
            style={styles.cancelButton}
          >
            {({ pressed }) => (
              <View style={[styles.cancelContent, pressed ? styles.pressedAction : null]}>
                <Text style={styles.cancelText}>Cancel</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdropRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: 18,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 54,
    width: '100%',
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 0,
    marginBottom: 9,
    overflow: 'hidden',
  },
  cameraButton: {
    backgroundColor: 'rgba(122,157,184,0.11)',
    borderColor: 'rgba(122,157,184,0.16)',
  },
  libraryButton: {
    backgroundColor: 'rgba(139,10,31,0.12)',
    borderColor: 'rgba(139,10,31,0.18)',
    marginBottom: 12,
  },
  cancelButton: {
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  actionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 12,
  },
  cancelContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: '#A1B3C9',
    fontSize: 14,
    fontWeight: '700',
  },
  pressedAction: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
});
