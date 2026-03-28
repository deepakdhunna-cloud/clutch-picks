import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Alert, ScrollView, StyleSheet, Dimensions, Linking, TextInput,
} from 'react-native';
import { api } from '@/lib/api/api';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import Purchases from 'react-native-purchases';
import {
  getOfferings, purchasePackage, restorePurchases, isRevenueCatEnabled, getCustomerInfo,
} from '@/lib/revenuecatClient';
import { useSubscription } from '@/lib/subscription-context';
import { useGames } from '@/hooks/useGames';
import { GameStatus } from '@/types/sports';
import type { PurchasesPackage } from 'react-native-purchases';

const { width: SCREEN_W } = Dimensions.get('window');
const BG = '#040608';
const MAROON = '#8B0A1F';
const MAROON_DIM = 'rgba(139,10,31,0.12)';
const MAROON_GLOW = 'rgba(139,10,31,0.25)';
const TEAL = '#7A9DB8';
const TEAL_DIM = 'rgba(122,157,184,0.10)';

// ─── Feature Icon Components ────────────────────────────────────
function IconPredictions({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M3 3v18h18" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M7 14l4-4 4 4 5-5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconLiveScores({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.8} />
      <Path d="M12 7v5l3 3" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function IconBoxScores({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={18} height={18} rx={3} stroke={color} strokeWidth={1.8} />
      <Line x1={3} y1={9} x2={21} y2={9} stroke={color} strokeWidth={1.5} />
      <Line x1={9} y1={9} x2={9} y2={21} stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

function IconWatch({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Rect x={2} y={7} width={20} height={14} rx={2} stroke={color} strokeWidth={1.8} />
      <Path d="M17 2l-5 5-5-5" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ─── Shimmer CTA button ─────────────────────────────────────────
function ShimmerButton({ onPress, loading, label }: {
  onPress: () => void; loading: boolean; label: string;
}) {
  const shimmerX = useSharedValue(-60);
  useEffect(() => {
    shimmerX.value = withRepeat(
      withTiming(SCREEN_W + 60, { duration: 2400, easing: Easing.linear }), -1, false
    );
  }, []);
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value }, { rotate: '20deg' }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => ({
        opacity: loading ? 0.6 : pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <LinearGradient
        colors={[MAROON, '#6A0818', '#5A0614']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          height: 56, borderRadius: 14,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          shadowColor: MAROON,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 16,
          elevation: 8,
        }}
      >
        <Animated.View style={[{ position: 'absolute', width: 50, height: 120, backgroundColor: 'rgba(255,255,255,0.10)' }, shimmerStyle]} />
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFF', letterSpacing: 0.5 }}>{label}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

// ═════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════
export default function PaywallScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [promoCode, setPromoCode] = useState('');
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);
  const { checkSubscription } = useSubscription();
  const { data: allGames } = useGames();

  const previewPicks = useMemo(() => {
    if (!allGames || allGames.length === 0) return null;
    const withPred = allGames.filter(
      (g) => g.prediction && (g.status === GameStatus.SCHEDULED || g.status === GameStatus.LIVE)
    );
    return withPred.slice(0, 3).map((g) => ({
      teams: `${g.awayTeam.abbreviation} vs ${g.homeTeam.abbreviation}`,
      league: g.sport,
      time: g.status === GameStatus.LIVE
        ? 'LIVE'
        : new Date(g.gameTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    }));
  }, [allGames]);

  const remainingCount = useMemo(() => {
    if (!allGames) return 0;
    return Math.max(0, allGames.filter((g) => g.prediction && (g.status === GameStatus.SCHEDULED || g.status === GameStatus.LIVE)).length - 3);
  }, [allGames]);

  // Breathing glow on CTA
  const ctaGlow = useSharedValue(0);
  useEffect(() => {
    ctaGlow.value = withRepeat(
      withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
      -1, true
    );
  }, []);
  const ctaGlowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(ctaGlow.value, [0, 1], [0.1, 0.3]),
    shadowRadius: interpolate(ctaGlow.value, [0, 1], [10, 25]),
  }));

  useEffect(() => { loadOfferings(); }, []);

  const loadOfferings = async () => {
    setLoadError(false);
    setErrorDetail('');

    const enabled = isRevenueCatEnabled();
    if (__DEV__) console.log('[Paywall] isRevenueCatEnabled:', enabled);

    if (!enabled) {
      if (__DEV__) console.log('[Paywall] RevenueCat not enabled');
      setIsLoading(false);
      setLoadError(true);
      setErrorDetail('SDK not enabled - key missing');
      return;
    }

    try {
      if (__DEV__) console.log('[Paywall] Calling getOfferings...');
      const result = await getOfferings();
      if (__DEV__) console.log('[Paywall] Result ok:', result.ok);

      if (!result.ok) {
        if (__DEV__) console.log('[Paywall] Failed reason:', result.reason, 'error:', result.error);
        setLoadError(true);
        setErrorDetail(`Offerings failed: ${result.reason} ${result.error || ''}`);
        setIsLoading(false);
        return;
      }

      if (__DEV__) console.log('[Paywall] Has current offering:', !!result.data.current);

      if (!result.data.current) {
        if (__DEV__) console.log('[Paywall] No current offering found');
        setLoadError(true);
        setErrorDetail('No current offering in RevenueCat');
        setIsLoading(false);
        return;
      }

      const packages = result.data.current.availablePackages;
      if (__DEV__) console.log('[Paywall] Available packages:', packages.map(p => p.identifier));

      const monthly = packages.find((pkg) => pkg.identifier === '$rc_monthly');
      if (__DEV__) console.log('[Paywall] Found $rc_monthly:', !!monthly);

      if (!monthly) {
        setLoadError(true);
        setErrorDetail(`No $rc_monthly package. Found: ${packages.map(p => p.identifier).join(', ') || 'none'}`);
        setIsLoading(false);
        return;
      }

      setMonthlyPackage(monthly);
      setLoadError(false);
    } catch (error: any) {
      if (__DEV__) console.log('[Paywall] Exception:', error?.message || error);
      setLoadError(true);
      setErrorDetail(`Exception: ${error?.message || String(error)}`);
    }
    setIsLoading(false);
  };

  const handlePurchase = async () => {
    if (!monthlyPackage) {
      setIsLoading(true);
      await loadOfferings();
      if (!monthlyPackage) {
        Alert.alert('Unable to Load', 'Could not load subscription. Check your connection and try again.');
      }
      return;
    }
    setIsPurchasing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await purchasePackage(monthlyPackage);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await checkSubscription();
      router.back();
    } else if (result.reason === 'sdk_error') {
      const error = result.error as any;
      if (!error?.userCancelled) {
        Alert.alert('Purchase Failed', 'Please try again later.');
      }
    }
    setIsPurchasing(false);
  };

  const handleRestore = async () => {
    setIsRestoring(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await restorePurchases();
    if (result.ok) {
      await checkSubscription();
      const hasActive = Object.keys(result.data.entitlements.active || {}).length > 0;
      if (hasActive) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Restored!', 'Your subscription has been restored.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('No Subscription Found', 'No previous subscription was found for this account.');
      }
    } else {
      Alert.alert('Restore Failed', 'Please try again later.');
    }
    setIsRestoring(false);
  };

  const priceString = monthlyPackage?.product?.priceString || '$4.99';

  const features = [
    { IconComponent: IconPredictions, label: 'AI Predictions', desc: 'Multi-factor analysis per game', accent: MAROON, bgColor: MAROON_DIM, borderColor: 'rgba(139,10,31,0.15)' },
    { IconComponent: IconLiveScores, label: 'Live Scores', desc: 'Real-time across 8 leagues', accent: TEAL, bgColor: TEAL_DIM, borderColor: 'rgba(122,157,184,0.12)' },
    { IconComponent: IconBoxScores, label: 'Box Scores & Stats', desc: 'Full game breakdowns', accent: MAROON, bgColor: MAROON_DIM, borderColor: 'rgba(139,10,31,0.15)' },
    { IconComponent: IconWatch, label: 'Where to Watch', desc: 'TV & streaming info', accent: TEAL, bgColor: TEAL_DIM, borderColor: 'rgba(122,157,184,0.12)' },
  ] as const;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Background ambience — maroon top, teal mid, maroon bottom */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {/* Maroon orb top */}
        <LinearGradient
          colors={['rgba(139,10,31,0.06)', 'transparent']}
          start={{ x: 0.3, y: 0 }}
          end={{ x: 0.7, y: 0.4 }}
          style={[StyleSheet.absoluteFillObject, { opacity: 1 }]}
        />
        {/* Teal orb mid-right */}
        <View style={{
          position: 'absolute', top: '40%', right: -20, width: 200, height: 200,
          borderRadius: 100, backgroundColor: 'rgba(122,157,184,0.03)',
        }} />
        {/* Grain texture */}
        <View style={[StyleSheet.absoluteFillObject, { opacity: 0.015, backgroundColor: 'transparent' }]} />
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Close button */}
        <Animated.View entering={FadeIn.delay(100)} style={{ position: 'absolute', top: 54, right: 16, zIndex: 20 }}>
          <Pressable onPress={() => router.back()} style={{
            width: 34, height: 34, borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
            alignItems: 'center', justifyContent: 'center',
          }} hitSlop={12}>
            <X size={18} color="rgba(255,255,255,0.4)" />
          </Pressable>
        </Animated.View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

          {/* ═══ HERO ═══ */}
          <Animated.View entering={FadeInDown.duration(500)} style={{ paddingHorizontal: 28, paddingTop: 52, paddingBottom: 28 }}>
            {/* CLUTCH PRO badge with gradient bar */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <LinearGradient
                colors={[MAROON, TEAL]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{ width: 3, height: 18, borderRadius: 2 }}
              />
              <Text style={{ fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 2.5 }}>CLUTCH PRO</Text>
            </View>

            {/* Title — "AI-analyzed" in teal */}
            <Text style={{ fontSize: 32, fontWeight: '900', color: '#FFF', letterSpacing: -0.5, lineHeight: 38 }}>
              Every game.{'\n'}Every stat.{'\n'}
              <Text style={{ color: TEAL }}>AI-analyzed.</Text>
            </Text>
            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', marginTop: 12, lineHeight: 22 }}>
              Multi-factor predictions across every game, every league. The analysis behind the edge.
            </Text>
          </Animated.View>

          {/* ═══ LOCKED PICKS PREVIEW ═══ */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ paddingHorizontal: 20, marginBottom: 28 }}>
            <View style={{
              borderRadius: 18, borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.06)',
              overflow: 'hidden',
              backgroundColor: 'rgba(8,8,12,0.6)',
            }}>
              {/* Header */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingHorizontal: 16, paddingVertical: 12,
                backgroundColor: 'rgba(255,255,255,0.015)',
                borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: MAROON }} />
                  <Text style={{ fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5 }}>TONIGHT'S PICKS</Text>
                </View>
                <View style={{ backgroundColor: MAROON_DIM, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 8, fontWeight: '800', color: MAROON, letterSpacing: 1 }}>LOCKED</Text>
                </View>
              </View>

              {/* Pick rows */}
              {(previewPicks ?? [
                { teams: '— vs —', league: 'NBA', time: 'Tonight' },
                { teams: '— vs —', league: 'NFL', time: 'Sunday' },
                { teams: '— vs —', league: 'MLB', time: 'Tonight' },
              ]).map((p, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, paddingVertical: 14,
                  borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.025)',
                  opacity: i === 2 ? 0.35 : 1,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>{p.teams}</Text>
                    <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }}>{p.league} · {p.time}</Text>
                  </View>
                  {/* Blurred prediction bars — maroon + teal */}
                  <View style={{ flexDirection: 'row', gap: 6, opacity: 0.10 }}>
                    <View style={{ width: 44, height: 12, borderRadius: 4, backgroundColor: MAROON }} />
                    <View style={{ width: 32, height: 12, borderRadius: 4, backgroundColor: TEAL }} />
                  </View>
                </View>
              ))}

              {/* Bottom hint */}
              {remainingCount > 0 ? (
                <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.025)' }}>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.12)', textAlign: 'center' }}>
                    +{remainingCount} more picks available
                  </Text>
                </View>
              ) : null}
            </View>
          </Animated.View>

          {/* ═══ FEATURES LIST — SVG icons, alternating maroon/teal ═══ */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ paddingHorizontal: 24, marginBottom: 28 }}>
            {features.map((f, i) => (
              <View key={i} style={{
                flexDirection: 'row', alignItems: 'center', gap: 14,
                paddingVertical: 16,
                borderBottomWidth: i < features.length - 1 ? 1 : 0,
                borderBottomColor: 'rgba(255,255,255,0.025)',
              }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  backgroundColor: f.bgColor,
                  borderWidth: 1, borderColor: f.borderColor,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <f.IconComponent color={f.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>{f.label}</Text>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{f.desc}</Text>
                </View>
              </View>
            ))}
          </Animated.View>

          {/* ═══ STATS BAR — maroon for factors, teal for updates ═══ */}
          <Animated.View entering={FadeInDown.delay(280).duration(400)} style={{ flexDirection: 'row', paddingHorizontal: 20, marginBottom: 28, gap: 8 }}>
            {[
              { value: '8', label: 'Leagues', color: '#FFF' },
              { value: '20', label: 'Factors', color: MAROON },
              { value: '24/7', label: 'Updates', color: TEAL },
            ].map((s, i) => (
              <View key={i} style={{
                flex: 1, alignItems: 'center', paddingVertical: 16,
                borderRadius: 14,
                backgroundColor: 'rgba(255,255,255,0.015)',
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)',
              }}>
                <Text style={{ fontSize: 24, fontWeight: '900', color: s.color }}>{s.value}</Text>
                <Text style={{ fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.2)', letterSpacing: 1.5, marginTop: 4 }}>{s.label.toUpperCase()}</Text>
              </View>
            ))}
          </Animated.View>

          {/* ═══ PRICE + CTA — maroon border + breathing glow ═══ */}
          <Animated.View entering={FadeInDown.delay(360).duration(400)} style={{ paddingHorizontal: 20 }}>
            <Animated.View style={[{
              borderRadius: 22, overflow: 'hidden',
              borderWidth: 1.5, borderColor: 'rgba(139,10,31,0.15)',
              shadowColor: MAROON,
              shadowOffset: { width: 0, height: 0 },
            }, ctaGlowStyle]}>
              <LinearGradient
                colors={['rgba(139,10,31,0.06)', 'rgba(139,10,31,0.02)', BG]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={{ padding: 24 }}
              >
                {/* Price row */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 6 }}>
                  <Text style={{ fontSize: 40, fontWeight: '900', color: '#FFF', letterSpacing: -1 }}>{priceString}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>/month</Text>
                </View>

                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', marginBottom: 16, lineHeight: 18 }}>
                  Every game. Every league. Every AI prediction.
                </Text>

                {/* Promo code */}
                {promoOpen ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <View style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center',
                      backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10,
                      borderWidth: 1, borderColor: promoCode.length > 0 ? 'rgba(122,157,184,0.25)' : 'rgba(255,255,255,0.06)',
                      paddingHorizontal: 12, paddingVertical: 10,
                    }}>
                      <TextInput
                        style={{ flex: 1, fontSize: 13, fontWeight: '600', color: '#FFF', padding: 0, letterSpacing: 1 }}
                        placeholder="Enter promo code"
                        placeholderTextColor="rgba(255,255,255,0.15)"
                        value={promoCode}
                        onChangeText={(t) => setPromoCode(t.toUpperCase())}
                        autoCapitalize="characters"
                        autoCorrect={false}
                      />
                      {promoCode.length > 0 ? (
                        <Pressable onPress={() => setPromoCode('')} hitSlop={8}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>×</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={async () => {
                        if (!promoCode.trim() || promoLoading) return;
                        setPromoLoading(true);
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        try {
                          const rcInfo = await getCustomerInfo();
                          const rcUserId = rcInfo.ok ? rcInfo.data.originalAppUserId : undefined;
                          const result = await api.post<{ success: boolean; message: string }>('/api/promo/redeem', { code: promoCode.trim(), rcUserId });
                          await checkSubscription();
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          Alert.alert('Code Applied!', result.message, [{ text: 'OK', onPress: () => router.back() }]);
                        } catch (error: any) {
                          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                          Alert.alert('Invalid Code', error?.message || 'This code could not be applied.');
                        } finally {
                          setPromoLoading(false);
                        }
                      }}
                      disabled={!promoCode.trim() || promoLoading}
                      style={{
                        backgroundColor: promoCode.trim() ? TEAL : 'rgba(122,157,184,0.2)',
                        paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10,
                        opacity: promoLoading ? 0.6 : 1,
                      }}
                    >
                      {promoLoading ? (
                        <ActivityIndicator color={BG} size="small" />
                      ) : (
                        <Text style={{ fontSize: 12, fontWeight: '700', color: promoCode.trim() ? BG : 'rgba(122,157,184,0.5)' }}>Apply</Text>
                      )}
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setPromoOpen(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, alignSelf: 'flex-start' }}
                  >
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 4v16M4 12h16" stroke={TEAL} strokeWidth={2} strokeLinecap="round" />
                    </Svg>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: TEAL }}>Have a promo code?</Text>
                  </Pressable>
                )}

                {/* CTA button */}
                {isLoading ? (
                  <ShimmerButton onPress={() => {}} loading={true} label="Loading..." />
                ) : loadError ? (
                  <ShimmerButton onPress={loadOfferings} loading={false} label="Tap to Retry" />
                ) : (
                  <ShimmerButton onPress={handlePurchase} loading={isPurchasing} label="Unlock All Picks" />
                )}

                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 10 }}>
                  Free for 3 days, then {priceString}/month. Cancel anytime.
                </Text>
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', marginTop: 6, lineHeight: 15 }}>
                  Subscription provides access to AI-generated predictions for entertainment purposes only.
                </Text>
              </LinearGradient>
            </Animated.View>
          </Animated.View>

          {/* ═══ RESTORE + LEGAL ═══ */}
          <Animated.View entering={FadeIn.delay(440)} style={{ alignItems: 'center', paddingTop: 20 }}>
            <Pressable onPress={handleRestore} disabled={isRestoring} style={{ paddingVertical: 12 }}>
              {isRestoring ? (
                <ActivityIndicator color={TEAL} size="small" />
              ) : (
                <Text style={{ fontSize: 13, fontWeight: '700', color: TEAL }}>Restore Purchases</Text>
              )}
            </Pressable>

            <Pressable onPress={() => Linking.openURL('https://apps.apple.com/account/subscriptions')} style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: TEAL, textDecorationLine: 'underline' }}>Manage Subscription</Text>
            </Pressable>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
              <Pressable onPress={() => router.push('/terms' as any)}>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecorationLine: 'underline' }}>Terms</Text>
              </Pressable>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.15)' }}>·</Text>
              <Pressable onPress={() => router.push('/privacy-policy' as any)}>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecorationLine: 'underline' }}>Privacy</Text>
              </Pressable>
            </View>

            <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', marginTop: 14, paddingHorizontal: 28, lineHeight: 16 }}>
              Payment charged to your App Store account. Subscription automatically renews unless canceled at least 24 hours before the end of the current period. Cancel in Settings {'>'} Subscriptions.
            </Text>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
