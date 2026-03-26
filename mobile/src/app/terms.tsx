import { View, Text, ScrollView, Pressable } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ChevronLeft } from 'lucide-react-native';

export default function TermsScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <LinearGradient
        colors={['#0D0D0D', '#1A1A2E', '#16213E', '#0D0D0D']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1 }}
      >
        <SafeAreaView className="flex-1" edges={['top']}>
          {/* Header */}
          <Animated.View
            entering={FadeInDown.duration(400)}
            className="px-5 pt-4 pb-4"
          >
            <View className="flex-row items-center">
              <Pressable
                onPress={() => router.back()}
                className="mr-4 p-2 -ml-2 active:opacity-60"
              >
                <ChevronLeft size={28} color="#fff" />
              </Pressable>
              <Text className="text-white text-xl font-bold">Terms & Conditions</Text>
            </View>
          </Animated.View>

          <ScrollView
            className="flex-1 px-5"
            contentContainerStyle={{ paddingBottom: 50 }}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInDown.delay(100).duration(500)}>
              {/* Terms Card with Glass Effect */}
              <View
                style={{
                  borderRadius: 22,
                  padding: 2,
                  overflow: 'hidden',
                  marginBottom: 20,
                }}
              >
                {/* Silver gradient border */}
                <LinearGradient
                  colors={['#E8E8E8', '#B8B8B8', '#D0D0D0', '#A0A0A0', '#C8C8C8', '#909090']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 22,
                  }}
                />
                {/* Inner card */}
                <View
                  style={{
                    borderRadius: 20,
                    overflow: 'hidden',
                    shadowColor: '#C0C0C0',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.5,
                    shadowRadius: 10,
                    elevation: 10,
                  }}
                >
                  <BlurView
                    intensity={70}
                    tint="dark"
                    style={{
                      padding: 20,
                    }}
                  >
                    {/* NFL dark blue gradient */}
                    <LinearGradient
                      colors={['rgba(46, 74, 94, 0.85)', 'rgba(30, 58, 78, 0.9)', 'rgba(14, 42, 62, 0.95)', 'rgba(6, 26, 46, 1)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                      }}
                    />
                    {/* Glass shine */}
                    <LinearGradient
                      colors={['rgba(255, 255, 255, 0.15)', 'rgba(255, 255, 255, 0.05)', 'transparent']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '50%',
                      }}
                    />

                    <Text className="text-white text-lg font-bold mb-4">
                      Terms and Conditions
                    </Text>
                    <Text className="text-white/70 text-xs mb-2">
                      Last Updated: March 2026
                    </Text>

                    <View style={{ marginTop: 16 }}>
                      <Text className="text-white font-semibold text-base mb-2">
                        1. Acceptance of Terms
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        By downloading, installing, or using the Clutch Picks application ("App"), you agree to be bound by these Terms and Conditions. If you do not agree to these terms, please do not use the App.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        2. Entertainment Purpose Only
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        This App is intended for entertainment and informational purposes only. All predictions, picks, and analysis provided are opinions generated by AI and statistical models. They should not be relied upon as advice of any kind. Clutch Picks does not facilitate, encourage, or enable gambling or wagering of any kind.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        3. No Guarantee of Accuracy
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        We make no guarantees regarding the accuracy, reliability, or completeness of any predictions, analysis, or information provided. Sports outcomes are inherently unpredictable. Past results do not guarantee future performance.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        4. User Responsibility
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        Users are solely responsible for their own decisions and actions. You must comply with all applicable laws in your jurisdiction. This App does not facilitate or encourage illegal activities.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        5. No Liability
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE APP, ITS CREATORS, OWNERS, OPERATORS, AND AFFILIATES SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE APP OR ANY INFORMATION PROVIDED BY THE APP.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        6. Age Requirement
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        You must be at least 13 years of age to use this App. By using this App, you confirm that you meet this requirement.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        7. Subscription Terms
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        Clutch Picks offers an optional auto-renewable subscription (Clutch Pro) that provides access to AI predictions, confidence ratings, and detailed game analysis.{'\n\n'}Payment is charged to your Apple ID account at confirmation of purchase. The subscription automatically renews unless canceled at least 24 hours before the end of the current billing period. Your account will be charged for renewal within 24 hours prior to the end of the current period at the same price.{'\n\n'}You can manage and cancel your subscription in your device Settings under your Apple ID, then Subscriptions. Cancellation takes effect at the end of the current billing period. No refunds are provided for partial billing periods.{'\n\n'}Current pricing: $4.99 per month. Prices may vary by region and are subject to change.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        8. Indemnification
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        You agree to indemnify and hold harmless the App, its owners, developers, employees, and affiliates from any claims, damages, losses, or expenses arising from your use of the App or violation of these Terms.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        9. Changes to Terms
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        We reserve the right to modify these Terms at any time. Continued use of the App after changes constitutes acceptance of the modified Terms.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        10. Governing Law
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        These Terms shall be governed by and construed in accordance with the laws of the State of Mississippi, without regard to conflict of law principles.
                      </Text>

                      <Text className="text-white font-semibold text-base mb-2">
                        11. Contact
                      </Text>
                      <Text className="text-white/80 text-sm leading-5 mb-4">
                        If you have questions about these Terms, contact us at support@clutchpicksapp.com.
                      </Text>

                      <View
                        style={{
                          marginTop: 16,
                          padding: 16,
                          backgroundColor: 'rgba(239, 68, 68, 0.15)',
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: 'rgba(239, 68, 68, 0.3)',
                        }}
                      >
                        <Text className="text-red-400 font-bold text-sm mb-2">
                          DISCLAIMER
                        </Text>
                        <Text className="text-red-300/80 text-xs leading-5">
                          By using Clutch Picks, you acknowledge that all predictions and analysis are for entertainment purposes only. You accept full responsibility for your own decisions. The App bears no liability for any outcomes resulting from your use of this service.
                        </Text>
                      </View>
                    </View>
                  </BlurView>
                </View>
              </View>
            </Animated.View>
          </ScrollView>
        </SafeAreaView>
      </LinearGradient>
    </>
  );
}
