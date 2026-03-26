import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Alert, ScrollView, StyleSheet, Dimensions, TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import {
  getOfferings, purchasePackage, restorePurchases, isRevenueCatEnabled,
} from '@/lib/revenuecatClient';
import { useSubscription } from '@/lib/subscription-context';
import { useGames } from '@/hooks/useGames';
import { GameStatus } from '@/types/sports';
import type { PurchasesPackage } from 'react-native-purchases';

const { width: SCREEN_W } = Dimensions.get('window');
const BG = '#040608';
const CORAL = '#E8936A';
const TEAL = '#7A9DB8';

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
        colors={[CORAL, '#D07850', '#C46840']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        <Animated.View style={[{ position: 'absolute', width: 50, height: 120, backgroundColor: 'rgba(255,255,255,0.12)' }, shimmerStyle]} />
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
    { icon: '◆', label: 'AI Predictions', desc: '20 factors analyzed per game', accent: TEAL },
    { icon: '▶', label: 'Live Scores', desc: 'Real-time across 8 leagues', accent: CORAL },
    { icon: '▤', label: 'Box Scores & Stats', desc: 'Full game breakdowns', accent: TEAL },
    { icon: '◉', label: 'Where to Watch', desc: 'TV & streaming info', accent: CORAL },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* Background ambience */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <LinearGradient
          colors={[`${CORAL}08`, 'transparent', `${TEAL}05`]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      </View>

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Close button */}
        <Animated.View entering={FadeIn.delay(100)} style={{ position: 'absolute', top: 54, right: 16, zIndex: 20 }}>
          <Pressable onPress={() => router.back()} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }} hitSlop={12}>
            <X size={18} color="rgba(255,255,255,0.5)" />
          </Pressable>
        </Animated.View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

          {/* ═══ HERO ═══ */}
          <Animated.View entering={FadeInDown.duration(500)} style={{ paddingHorizontal: 24, paddingTop: 60, paddingBottom: 28 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <View style={{ width: 3, height: 16, borderRadius: 1.5, backgroundColor: CORAL }} />
              <Text style={{ fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 2 }}>CLUTCH PRO</Text>
            </View>
            <Text style={{ fontSize: 30, fontWeight: '900', color: '#FFF', letterSpacing: -0.5, lineHeight: 36 }}>
              See what others{'\n'}can't see.
            </Text>
            <Text style={{ fontSize: 15, color: 'rgba(255,255,255,0.4)', marginTop: 10, lineHeight: 22 }}>
              AI-powered predictions across every game, every league. The edge you've been missing.
            </Text>
          </Animated.View>

          {/* ═══ LOCKED PICKS PREVIEW ═══ */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={{ paddingHorizontal: 20, marginBottom: 28 }}>
            <View style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CORAL }} />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.5 }}>TONIGHT'S PICKS</Text>
                </View>
                <View style={{ backgroundColor: `${CORAL}15`, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: CORAL }}>LOCKED</Text>
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
                  paddingHorizontal: 16, paddingVertical: 13,
                  borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)',
                  opacity: i === 2 ? 0.4 : 1,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>{p.teams}</Text>
                    <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>{p.league} · {p.time}</Text>
                  </View>
                  {/* Blurred prediction placeholder */}
                  <View style={{ flexDirection: 'row', gap: 6, opacity: 0.12 }}>
                    <View style={{ width: 44, height: 14, borderRadius: 4, backgroundColor: CORAL }} />
                    <View style={{ width: 32, height: 14, borderRadius: 4, backgroundColor: TEAL }} />
                  </View>
                </View>
              ))}

              {/* Bottom hint */}
              {remainingCount > 0 ? (
                <View style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' }}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: 'rgba(255,255,255,0.15)', textAlign: 'center' }}>
                    +{remainingCount} more picks available
                  </Text>
                </View>
              ) : null}
            </View>
          </Animated.View>

          {/* ═══ FEATURES LIST ═══ */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ paddingHorizontal: 20, marginBottom: 28 }}>
            <View style={{ gap: 0 }}>
              {features.map((f, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  paddingVertical: 14,
                  borderBottomWidth: i < features.length - 1 ? 1 : 0,
                  borderBottomColor: 'rgba(255,255,255,0.04)',
                }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: `${f.accent}10`, borderWidth: 1, borderColor: `${f.accent}18`, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 14, color: f.accent }}>{f.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }}>{f.label}</Text>
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>{f.desc}</Text>
                  </View>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                    <Path d="M9 18l6-6-6-6" stroke="rgba(255,255,255,0.12)" strokeWidth={2} strokeLinecap="round" />
                  </Svg>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* ═══ STATS BAR ═══ */}
          <Animated.View entering={FadeInDown.delay(280).duration(400)} style={{ flexDirection: 'row', paddingHorizontal: 20, marginBottom: 28, gap: 8 }}>
            {[
              { value: '8', label: 'Leagues', color: '#FFF' },
              { value: '20', label: 'Factors', color: CORAL },
              { value: '24/7', label: 'Updates', color: TEAL },
            ].map((s, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 16, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' }}>
                <Text style={{ fontSize: 24, fontWeight: '900', color: s.color }}>{s.value}</Text>
                <Text style={{ fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.3)', letterSpacing: 1, marginTop: 4 }}>{s.label.toUpperCase()}</Text>
              </View>
            ))}
          </Animated.View>

          {/* ═══ PRICE + CTA ═══ */}
          <Animated.View entering={FadeInDown.delay(360).duration(400)} style={[{ paddingHorizontal: 20 }]}>
            <Animated.View style={[{ borderRadius: 20, overflow: 'hidden', borderWidth: 1.5, borderColor: `${CORAL}25`, shadowColor: CORAL, shadowOffset: { width: 0, height: 0 } }, ctaGlowStyle]}>
              <LinearGradient
                colors={[`${CORAL}0A`, `${CORAL}04`, BG]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={{ padding: 24 }}
              >
                {/* Price row */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                    <Text style={{ fontSize: 38, fontWeight: '900', color: '#FFF', letterSpacing: -1 }}>{priceString}</Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.35)' }}>/month</Text>
                  </View>
                </View>

                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', marginBottom: 16, lineHeight: 18 }}>
                  Every game. Every league. Every AI prediction.
                </Text>

                {/* Promo code */}
                {promoOpen ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <View style={{
                      flex: 1, flexDirection: 'row', alignItems: 'center',
                      backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10,
                      borderWidth: 1, borderColor: promoCode.length > 0 ? `${TEAL}30` : 'rgba(255,255,255,0.08)',
                      paddingHorizontal: 12, paddingVertical: 10,
                    }}>
                      <TextInput
                        style={{ flex: 1, fontSize: 13, fontWeight: '600', color: '#FFF', padding: 0, letterSpacing: 1 }}
                        placeholder="Enter promo code"
                        placeholderTextColor="rgba(255,255,255,0.2)"
                        value={promoCode}
                        onChangeText={(t) => setPromoCode(t.toUpperCase())}
                        autoCapitalize="characters"
                        autoCorrect={false}
                      />
                      {promoCode.length > 0 ? (
                        <Pressable onPress={() => setPromoCode('')} hitSlop={8}>
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>×</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => {
                        if (promoCode.trim()) {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          Alert.alert('Promo Code', `Code "${promoCode}" will be applied at checkout through your App Store account. Redeem it in Settings > Subscriptions > Redeem Code.`);
                        }
                      }}
                      style={{ backgroundColor: promoCode.trim() ? TEAL : `${TEAL}30`, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10 }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: promoCode.trim() ? BG : `${TEAL}60` }}>Apply</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => setPromoOpen(true)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, alignSelf: 'flex-start' }}
                  >
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M20 12H4M12 4v16" stroke={TEAL} strokeWidth={2} strokeLinecap="round" />
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

                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 10 }}>
                  Cancel anytime · No commitment
                </Text>
              </LinearGradient>
            </Animated.View>
          </Animated.View>

          {/* ═══ RESTORE + LEGAL ═══ */}
          <Animated.View entering={FadeIn.delay(440)} style={{ alignItems: 'center', paddingTop: 20 }}>
            <Pressable onPress={handleRestore} disabled={isRestoring} style={{ paddingVertical: 12 }}>
              {isRestoring ? (
                <ActivityIndicator color={CORAL} size="small" />
              ) : (
                <Text style={{ fontSize: 13, fontWeight: '700', color: TEAL }}>Restore Purchases</Text>
              )}
            </Pressable>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
              <Pressable onPress={() => router.push('/terms' as any)}>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textDecorationLine: 'underline' }}>Terms</Text>
              </Pressable>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)' }}>·</Text>
              <Pressable onPress={() => router.push('/privacy-policy' as any)}>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', textDecorationLine: 'underline' }}>Privacy</Text>
              </Pressable>
            </View>

            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 14, paddingHorizontal: 28, lineHeight: 16 }}>
              Payment charged to your App Store account. Subscription automatically renews unless canceled at least 24 hours before the end of the current period.
            </Text>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
