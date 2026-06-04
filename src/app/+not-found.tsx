import { Stack, useRouter } from 'expo-router';
import { View, Text } from 'react-native';
import { HapticPressable } from '@/components/HapticPressable';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: 'Not Found', headerShown: false }} />
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.4 }}>
            Page not found
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            This page doesn't exist or may have been moved.
          </Text>
          <HapticPressable
            hapticStyle="light"
            onPress={() => router.replace('/(tabs)')}
            style={{ marginTop: 24, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>Go home</Text>
          </HapticPressable>
        </SafeAreaView>
      </View>
    </>
  );
}
