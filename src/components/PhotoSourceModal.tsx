import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
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
  const press = (action: () => void) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    action();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.72)',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: 18,
        }}
      >
        <Pressable
          onPress={() => {}}
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
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
            {title}
          </Text>
          <Text style={{ color: '#6B7C94', fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
            Add a photo from your camera or library.
          </Text>
          <Pressable
            onPress={() => press(onTakePhoto)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 54,
              borderRadius: 15,
              backgroundColor: 'rgba(122,157,184,0.11)',
              borderWidth: 1,
              borderColor: 'rgba(122,157,184,0.16)',
              paddingHorizontal: 14,
              marginBottom: 9,
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <Camera size={19} color="#7A9DB8" />
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginLeft: 12 }}>Take Photo</Text>
          </Pressable>
          <Pressable
            onPress={() => press(onChooseLibrary)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              minHeight: 54,
              borderRadius: 15,
              backgroundColor: 'rgba(139,10,31,0.12)',
              borderWidth: 1,
              borderColor: 'rgba(139,10,31,0.18)',
              paddingHorizontal: 14,
              marginBottom: 12,
              opacity: pressed ? 0.78 : 1,
            })}
          >
            <ImageIcon size={19} color="#8B0A1F" />
            <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginLeft: 12 }}>Choose from Library</Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            style={({ pressed }) => ({
              height: 46,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(255,255,255,0.05)',
              opacity: pressed ? 0.72 : 1,
            })}
          >
            <Text style={{ color: '#A1B3C9', fontSize: 14, fontWeight: '700' }}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
