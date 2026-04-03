import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';

const BG = '#040608';
const MAROON = '#8B0A1F';
const TEAL = '#7A9DB8';
const TEXT_MUTED = '#6B7C94';

const TIERS = [
  {
    range: '50–54%',
    label: 'Considered a Lean',
    desc: 'The model detects a slight edge for one team, but the matchup is close. Factors are nearly even — this is a competitive game where small advantages matter.',
    accent: 'rgba(255,255,255,0.15)',
    filled: 2,
  },
  {
    range: '55–59%',
    label: 'Considered a Solid Pick',
    desc: 'A clear advantage has been identified across key prediction factors. The model has enough signal to make a confident lean, though some uncertainty remains.',
    accent: 'rgba(122,157,184,0.25)',
    filled: 4,
  },
  {
    range: '60–64%',
    label: 'Considered a Strong Pick',
    desc: 'Multiple prediction factors align in the same direction. The model sees a meaningful edge backed by data — recent form, matchup quality, and statistical trends agree.',
    accent: 'rgba(122,157,184,0.40)',
    filled: 6,
  },
  {
    range: '65–69%',
    label: 'Considered a High Confidence Pick',
    desc: 'Strong agreement across all three sub-models (composite, Elo, and recent form). The data depth is high and the edge is clear — this is one of the day\'s top predictions.',
    accent: 'rgba(139,10,31,0.30)',
    filled: 8,
  },
  {
    range: '70%+',
    label: 'Considered a Lock',
    desc: 'A dominant edge across nearly every factor the model tracks. All sub-models agree, data coverage is strong, and the statistical separation between the teams is significant.',
    accent: 'rgba(139,10,31,0.45)',
    filled: 10,
  },
];

export default function ConfidenceTiersScreen() {
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <LinearGradient
        colors={['rgba(139,10,31,0.15)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.5, y: 0.3 }}
        style={[StyleSheet.absoluteFill, { height: 250 }]}
      />
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20, gap: 12 }}>
          <Pressable
            onPress={() => router.back()}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <Path d="M15 18l-6-6 6-6" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </Pressable>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 }}>Confidence Tiers</Text>
            <Text style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 1 }}>How to read our prediction confidence</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {/* Intro */}
          <Animated.View entering={FadeInDown.duration(400)} style={{ marginBottom: 24 }}>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 20 }}>
              Every prediction is powered by 20+ data factors including Elo ratings, recent form, injuries, advanced metrics, and more. The confidence percentage reflects how strongly the model favors one team — the tier label tells you what that number means.
            </Text>
          </Animated.View>

          {/* Tier cards */}
          {TIERS.map((tier, i) => (
            <Animated.View key={i} entering={FadeInDown.delay(100 + i * 80).duration(400)} style={{ marginBottom: 12 }}>
              <View style={{
                backgroundColor: 'rgba(255,255,255,0.02)',
                borderRadius: 18,
                padding: 18,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.06)',
                overflow: 'hidden',
              }}>
                {/* Left accent */}
                <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: tier.accent, borderTopLeftRadius: 18, borderBottomLeftRadius: 18 }} />

                {/* Range + label row */}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ backgroundColor: tier.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginRight: 12 }}>
                    <Text style={{ fontSize: 13, fontWeight: '900', color: '#FFFFFF' }}>{tier.range}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: TEAL, opacity: 0.8 }} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: TEAL, letterSpacing: 0.3, flexShrink: 1 }} numberOfLines={1}>{tier.label}</Text>
                  </View>
                </View>

                {/* Segment bar preview */}
                <View style={{ flexDirection: 'row', gap: 3, height: 5, marginBottom: 12 }}>
                  {Array.from({ length: 10 }).map((_, j) => (
                    <View key={j} style={{ flex: 1, borderRadius: 2, overflow: 'hidden' }}>
                      {j < tier.filled ? (
                        <LinearGradient colors={[MAROON, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 2 }} />
                      ) : (
                        <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 2 }} />
                      )}
                    </View>
                  ))}
                </View>

                {/* Description */}
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 18 }}>{tier.desc}</Text>
              </View>
            </Animated.View>
          ))}

          {/* Disclaimer */}
          <Animated.View entering={FadeInDown.delay(600).duration(400)} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', lineHeight: 15 }}>
              Predictions are for entertainment purposes only. Not financial or gambling advice. Confidence reflects model certainty, not guaranteed outcomes.
            </Text>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
