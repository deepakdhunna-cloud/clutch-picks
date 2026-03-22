import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Alert, ScrollView, StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import {
  getOfferings, purchasePackage, restorePurchases, isRevenueCatEnabled,
} from '@/lib/revenuecatClient';
import { useSubscription } from '@/lib/subscription-context';
import { useGames } from '@/hooks/useGames';
import { GameStatus } from '@/types/sports';
import type { PurchasesPackage } from 'react-native-purchases';

const BG = '#040608';
const CORAL = '#E8936A';
const TEAL = '#7A9DB8';
const GREEN = '#4ADE80';

// ─── SVG icons ───────────────────────────────────────────────────
function ScoreIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 3h18v18H3V3z" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M3 9h18M12 3v18" stroke={TEAL} strokeWidth="1.2" strokeOpacity="0.4" />
    </Svg>
  );
}
function StreamIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 3l14 9-14 9V3z" fill={CORAL} fillOpacity="0.8" />
    </Svg>
  );
}
function OddsIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 20V10M12 20V4M6 20v-6" stroke={GREEN} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}
function LiveIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="4" fill={CORAL} />
      <Path d="M4.93 4.93a10 10 0 000 14.14M19.07 4.93a10 10 0 010 14.14" stroke={CORAL} strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5" />
    </Svg>
  );
}

// ─── Lock badge ──────────────────────────────────────────────────
function LockBadge() {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: `${CORAL}20`, borderWidth: 1, borderColor: `${CORAL}35`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 8, fontWeight: '900', color: CORAL, letterSpacing: 0.5 }}>PRO</Text>
    </View>
  );
}

// ─── Blurred pick row ────────────────────────────────────────────
function BlurredPick({ teams, league, time, faded }: {
  teams: string; league: string; time: string; faded?: boolean;
}) {
  return (
    <View style={[st.pickRow, faded && { opacity: 0.45, borderColor: 'rgba(255,255,255,0.03)' }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: '#FFF' }}>{teams}</Text>
        <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{league} · {time}</Text>
      </View>
      <View style={{ position: 'relative' }}>
        <View style={{ opacity: 0.12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 48, height: 16, borderRadius: 4, backgroundColor: CORAL }} />
            <View style={{ width: 36, height: 16, borderRadius: 4, backgroundColor: GREEN }} />
          </View>
        </View>
        {!faded ? (
          <View style={StyleSheet.absoluteFill}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <LockBadge />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ─── Shimmer button ──────────────────────────────────────────────
function ShimmerButton({ onPress, loading, label }: {
  onPress: () => void; loading: boolean; label: string;
}) {
  const shimmerX = useSharedValue(-60);
  useEffect(() => {
    shimmerX.value = withRepeat(
      withTiming(340, { duration: 2400, easing: Easing.linear }), -1, false
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
        style={st.ctaGradient}
      >
        <Animated.View style={[st.shimmerBeam, shimmerStyle]} />
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={st.ctaText}>{label}</Text>
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

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Close */}
        <Animated.View entering={FadeIn.delay(100)} style={st.closeWrap}>
          <Pressable onPress={() => router.back()} style={st.closeBtn} hitSlop={12}>
            <X size={20} color="rgba(255,255,255,0.5)" />
          </Pressable>
        </Animated.View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {/* ═══ PICKS HAPPENING NOW ═══ */}
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <View style={st.picksHeader}>
              <View style={st.liveDot} />
              <Text style={st.picksHeaderText}>PICKS HAPPENING NOW</Text>
            </View>

            <View style={{ paddingHorizontal: 20 }}>
              {previewPicks ? previewPicks.map((p, i) => (
                <BlurredPick key={i} {...p} faded={i === 2} />
              )) : (
                <>
                  <BlurredPick teams="— vs —" league="NBA" time="Tonight" />
                  <BlurredPick teams="— vs —" league="NFL" time="Sunday" />
                  <BlurredPick teams="— vs —" league="MLB" time="Tonight" faded />
                </>
              )}
              <Text style={st.moreText}>Picks updated daily across 8 leagues</Text>
            </View>

            <LinearGradient colors={['transparent', BG]} style={{ height: 24 }} />
          </Animated.View>

          {/* ═══ HEADLINE ═══ */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <Text style={st.headline}>You're picking blind.</Text>
            <Text style={st.subline}>
              Every game tonight has an AI breakdown waiting. 19 factors analyzed. Confidence rated. You're just not seeing it yet.
            </Text>
          </Animated.View>

          {/* ═══ ALL-IN-ONE VALUE ═══ */}
          <Animated.View entering={FadeInDown.delay(280).duration(400)} style={{ paddingHorizontal: 20, marginBottom: 24 }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.2)', letterSpacing: 2, marginBottom: 10 }}>YOUR SPORTS HUB</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[
                { Icon: LiveIcon, label: 'Live Scores', desc: 'Real-time updates' },
                { Icon: StreamIcon, label: 'Where to Watch', desc: 'TV & streaming' },
                { Icon: ScoreIcon, label: 'Box Scores', desc: 'Full game stats' },
                { Icon: OddsIcon, label: 'AI Predictions', desc: '19-factor analysis' },
              ].map((item, i) => (
                <View key={i} style={{
                  width: '48%',
                  padding: 16,
                  borderRadius: 16,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.06)',
                }}>
                  <item.Icon size={20} />
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF', marginTop: 10 }}>{item.label}</Text>
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{item.desc}</Text>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* ═══ AI DEPTH STATS ═══ */}
          <Animated.View entering={FadeInDown.delay(340).duration(400)} style={st.statRow}>
            <View style={st.statTile}>
              <Text style={[st.statValue, { color: '#FFF' }]}>8</Text>
              <Text style={st.statLabel}>LEAGUES</Text>
            </View>
            <View style={st.statTile}>
              <Text style={[st.statValue, { color: CORAL }]}>19</Text>
              <Text style={st.statLabel}>FACTORS / GAME</Text>
            </View>
            <View style={st.statTile}>
              <Text style={[st.statValue, { color: TEAL }]}>24/7</Text>
              <Text style={st.statLabel}>ANALYSIS</Text>
            </View>
          </Animated.View>

          {/* ═══ PRICE + CTA ═══ */}
          <Animated.View entering={FadeInDown.delay(420).duration(400)} style={{ paddingHorizontal: 20 }}>
            <View style={st.priceCard}>
              <View style={st.priceTop}>
                <View>
                  <Text style={st.proLabel}>CLUTCH PRO</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                    <Text style={st.priceMain}>{priceString}</Text>
                    <Text style={st.pricePer}>/month</Text>
                  </View>
                </View>
              </View>

              <View style={{ paddingHorizontal: 22 }}>
                <Text style={st.comparisonNote}>
                  One subscription. Every game. Every league. Every AI prediction — all in your pocket.
                </Text>
              </View>

              <View style={st.ctaZone}>
                {isLoading ? (
                  <ShimmerButton onPress={() => {}} loading={true} label="Loading..." />
                ) : loadError ? (
                  <>
                    <ShimmerButton onPress={loadOfferings} loading={false} label="Tap to Retry" />
                  </>
                ) : (
                  <ShimmerButton onPress={handlePurchase} loading={isPurchasing} label="Unlock All Picks" />
                )}
                <Text style={st.cancelNote}>Cancel anytime · No commitment</Text>
              </View>
            </View>
          </Animated.View>

          {/* ═══ RESTORE + LEGAL ═══ */}
          <Animated.View entering={FadeIn.delay(500)} style={{ alignItems: 'center', paddingTop: 16 }}>
            <Pressable onPress={handleRestore} disabled={isRestoring} style={{ paddingVertical: 12 }}>
              {isRestoring ? (
                <ActivityIndicator color={CORAL} size="small" />
              ) : (
                <Text style={st.restoreText}>Restore Purchases</Text>
              )}
            </Pressable>

            <View style={st.legalRow}>
              <Pressable onPress={() => router.push('/terms' as any)}>
                <Text style={st.legalLink}>Terms</Text>
              </Pressable>
              <Text style={st.legalDot}>·</Text>
              <Pressable onPress={() => router.push('/privacy-policy' as any)}>
                <Text style={st.legalLink}>Privacy</Text>
              </Pressable>
            </View>

            <Text style={st.disclosureText}>
              Payment charged to your App Store account. Subscription automatically renews unless canceled at least 24 hours before the end of the current period.
            </Text>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  closeWrap: { position: 'absolute', top: 54, right: 16, zIndex: 20 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },

  picksHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CORAL },
  picksHeaderText: { fontSize: 11, fontWeight: '800', color: CORAL, letterSpacing: 2 },

  pickRow: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 8 },
  moreText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.2)', textAlign: 'center', paddingTop: 10, paddingBottom: 4 },

  headline: { fontSize: 26, fontWeight: '900', color: '#FFF', letterSpacing: -0.5, lineHeight: 32 },
  subline: { fontSize: 15, color: 'rgba(255,255,255,0.4)', marginTop: 8, lineHeight: 22 },

  statRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 24 },
  statTile: { flex: 1, padding: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.25)', letterSpacing: 0.5, marginTop: 4 },

  priceCard: { borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: `${CORAL}20` },
  priceTop: { backgroundColor: `${CORAL}0D`, padding: 22, paddingBottom: 14 },
  proLabel: { fontSize: 11, fontWeight: '800', color: CORAL, letterSpacing: 2, marginBottom: 6 },
  priceMain: { fontSize: 40, fontWeight: '900', color: '#FFF', letterSpacing: -1 },
  pricePer: { fontSize: 14, color: 'rgba(255,255,255,0.3)' },

  comparisonNote: { fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 19, paddingBottom: 4 },

  ctaZone: { padding: 22, paddingTop: 12, backgroundColor: `${CORAL}08` },
  ctaGradient: { height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  shimmerBeam: { position: 'absolute', width: 60, height: 120, backgroundColor: 'rgba(255,255,255,0.12)' },
  ctaText: { fontSize: 17, fontWeight: '800', color: '#FFF', letterSpacing: 0.5 },
  cancelNote: { fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 10 },

  restoreText: { fontSize: 13, fontWeight: '700', color: CORAL },
  legalRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 10 },
  legalLink: { fontSize: 11, color: 'rgba(255,255,255,0.25)', textDecorationLine: 'underline' },
  legalDot: { fontSize: 11, color: 'rgba(255,255,255,0.12)' },
  disclosureText: { fontSize: 10, color: 'rgba(255,255,255,0.12)', textAlign: 'center', marginTop: 12, paddingHorizontal: 28, lineHeight: 15 },
});
