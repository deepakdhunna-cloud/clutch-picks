/**
 * RELEASE-CRITICAL PAYWALL SCREEN.
 *
 * Do not change purchase, restore, trial, price, or RevenueCat identifier
 * behavior without running `bun run verify:paywall` and paywall tests.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, ScrollView, StyleSheet, Dimensions, Linking, TextInput,
} from 'react-native';
import { api } from '@/lib/api/api';
import { router, useNavigationContainerRef } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, interpolate, cancelAnimation } from 'react-native-reanimated';
import { X } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';
import { haptics } from '@/lib/haptics';
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  isRevenueCatEnabled,
  getRevenueCatAppUserId,
  invalidateCustomerInfoCache,
  customerInfoHasPremium,
} from '@/lib/revenuecatClient';
import { useSubscription } from '@/lib/subscription-context';
import { useGames } from '@/hooks/useGames';
import { formatGameTimeLabel } from '@/lib/game-time';
import { GameStatus } from '@/types/sports';
import { isLiveGameLike } from '@/lib/game-status';
import type { PurchasesPackage } from 'react-native-purchases';
import {
  PRO_MONTHLY_HAS_THREE_DAY_TRIAL,
  resolvePaywallPriceString,
} from '@/lib/subscription-pricing';
import {
  PAYWALL_COPY,
  REVENUECAT_PACKAGE_IDS,
} from '@/lib/subscription-config';
import { FeedbackModal } from '@/components/FeedbackModal';
import { guardedRouterBack, guardedRouterPush, guardedRouterReplace, guardedResetTo } from '@/lib/navigation-guard';
import { PressableScale } from '@/components/shared/PressableScale';

import { BG, MAROON, TEAL } from '@/lib/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const MAROON_DIM = 'rgba(139,10,31,0.12)';
const TEAL_DIM = 'rgba(122,157,184,0.10)';

type FeedbackState = {
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'info';
  actionLabel?: string;
  secondaryActionLabel?: string;
  onActionPress?: () => void;
  onSecondaryPress?: () => void;
  onDismiss?: () => void;
};

const PRICE_PERIOD_PATTERN = /(?:\/\s*(?:mo|month|monthly|mth|wk|week|yr|year|annual))|\b(?:per|a)\s+(?:mo|month|week|year)\b/i;
const PURCHASE_CANCEL_MESSAGE = 'No charge was made. Sign in to your Apple Account and try again when you are ready.';
const SANDBOX_PURCHASE_CANCEL_MESSAGE = `${PURCHASE_CANCEL_MESSAGE} Development builds need a Sandbox Apple Account from App Store Connect, not your Clutch login.`;

function priceIncludesBillingPeriod(price: string): boolean {
  return PRICE_PERIOD_PATTERN.test(price);
}

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
function ShimmerButton({ onPress, loading, label, loadingLabel = 'Opening App Store...' }: {
  onPress?: () => void; loading: boolean; label: string; loadingLabel?: string;
}) {
  const shimmerX = useSharedValue(-80);
  useEffect(() => {
    if (loading) {
      cancelAnimation(shimmerX);
      shimmerX.value = -80;
      return;
    }

    shimmerX.value = -80;
    shimmerX.value = withRepeat(
      withTiming(SCREEN_W + 80, { duration: 3600, easing: Easing.inOut(Easing.ease) }), -1, false
    );
    return () => cancelAnimation(shimmerX);
  }, [loading, shimmerX]);
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value }, { rotate: '20deg' }],
  }));
  const visibleLabel = loading ? loadingLabel : label;
  const disabled = loading || !onPress;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={visibleLabel}
      accessibilityState={{ disabled, busy: loading }}
      style={({ pressed }) => ({
        opacity: pressed && !disabled ? 0.92 : 1,
        transform: [{ scale: pressed && !disabled ? 0.985 : 1 }],
      })}
    >
      <LinearGradient
        colors={loading ? ['#050505', '#0B0B0D'] : [MAROON, '#6A0818', '#5A0614']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          height: 56, borderRadius: 14,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          shadowColor: MAROON,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: loading ? 0.12 : 0.3,
          shadowRadius: loading ? 8 : 16,
          elevation: loading ? 3 : 8,
        }}
      >
        {!loading ? (
          <Animated.View style={[{ position: 'absolute', width: 56, height: 120, backgroundColor: 'rgba(255,255,255,0.08)' }, shimmerStyle]} />
        ) : null}
        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <ActivityIndicator color="#FFFFFF" size="small" />
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 }}>{visibleLabel}</Text>
          </View>
        ) : (
          <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFF', letterSpacing: 0.5 }}>{visibleLabel}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const isMonthlySubscription = (pkg: PurchasesPackage) => {
  return pkg.identifier === REVENUECAT_PACKAGE_IDS.monthly &&
    pkg.product.subscriptionPeriod === 'P1M';
};

const hasThreeDayFreeTrial = (pkg: PurchasesPackage) => {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0) return false;
  const periodUnit = intro.periodUnit?.toUpperCase?.() ?? '';
  return intro.period === 'P3D' ||
    (periodUnit === 'DAY' && intro.periodNumberOfUnits === 3);
};

const packageMetadataWarnings = (pkg: PurchasesPackage) => {
  const warnings: string[] = [];

  if (!isMonthlySubscription(pkg)) {
    warnings.push(`${REVENUECAT_PACKAGE_IDS.monthly} metadata expected monthly subscription; found period ${pkg.product.subscriptionPeriod || 'none'}.`);
  }

  if (!hasThreeDayFreeTrial(pkg)) {
    warnings.push(`${REVENUECAT_PACKAGE_IDS.monthly} metadata did not include the configured 3-day trial.`);
  }

  return warnings;
};

const shouldAdvertiseThreeDayTrial = (pkg: PurchasesPackage | null) => {
  if (pkg && hasThreeDayFreeTrial(pkg)) return true;

  return PRO_MONTHLY_HAS_THREE_DAY_TRIAL;
};

// ═════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════
export default function PaywallScreen() {
  const navigationRef = useNavigationContainerRef();
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [monthlyPackage, setMonthlyPackage] = useState<PurchasesPackage | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoLoading, setPromoLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const { checkSubscription, isPremium } = useSubscription();
  const didRedirectForPremiumRef = useRef(false);
  const purchaseInFlightRef = useRef(false);
  const restoreInFlightRef = useRef(false);
  const promoInFlightRef = useRef(false);
  const loadOfferingsInFlightRef = useRef(false);
  const { data: allGames } = useGames();

  const dismissFeedback = () => {
    const onDismiss = feedback?.onDismiss;
    setFeedback(null);
    onDismiss?.();
  };

  const openSupportEmail = async () => {
    const supportUrl = 'mailto:support@clutchpicksapp.com?subject=Restore%20Pro%20Access';
    try {
      await Linking.openURL(supportUrl);
    } catch {
      setFeedback({
        title: 'Email Support',
        message: 'Email us at support@clutchpicksapp.com and we will help recover your Pro access.',
        variant: 'info',
      });
    }
  };

  const previewPicks = useMemo(() => {
    if (!allGames || allGames.length === 0) return null;
    const withPred = allGames.filter(
      (g) => g.prediction && (g.status === GameStatus.SCHEDULED || isLiveGameLike(g))
    );
    return withPred.slice(0, 3).map((g) => ({
      teams: `${g.awayTeam.name} vs ${g.homeTeam.name}`,
      league: g.sport,
      time: isLiveGameLike(g)
        ? 'LIVE'
        : formatGameTimeLabel(g.gameTime),
    }));
  }, [allGames]);

  const remainingCount = useMemo(() => {
    if (!allGames) return 0;
    return Math.max(0, allGames.filter((g) => g.prediction && (g.status === GameStatus.SCHEDULED || isLiveGameLike(g))).length - 3);
  }, [allGames]);

  // Breathing glow on CTA
  const ctaGlow = useSharedValue(0);
  useEffect(() => {
    ctaGlow.value = withRepeat(
      withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
      -1, true
    );
    return () => cancelAnimation(ctaGlow);
  }, [ctaGlow]);
  const ctaGlowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(ctaGlow.value, [0, 1], [0.1, 0.3]),
  }));

  useEffect(() => { loadOfferings(); }, []);

  useEffect(() => {
    if (!isPremium || didRedirectForPremiumRef.current) return;
    didRedirectForPremiumRef.current = true;
    if (isPurchasing || isRestoring || promoLoading) {
      haptics.success();
    }
    // RevenueCat can deliver entitlement updates through its listener before
    // the purchase promise resolves, especially on the simulator App Store sheet.
    // Reset the stack so onboarding/welcome can't be back-swiped to from Home.
    guardedResetTo(router, '/(tabs)', { navigationRef });
  }, [isPremium, isPurchasing, isRestoring, promoLoading, navigationRef]);

  const loadOfferings = async (): Promise<PurchasesPackage | null> => {
    if (loadOfferingsInFlightRef.current) return monthlyPackage;
    loadOfferingsInFlightRef.current = true;
    setLoadError(false);

    const enabled = isRevenueCatEnabled();

    if (!enabled) {
      setIsLoading(false);
      setLoadError(true);
      loadOfferingsInFlightRef.current = false;
      return null;
    }

    try {
      const result = await getOfferings();

      if (!result.ok) {
        setLoadError(true);
        setIsLoading(false);
        loadOfferingsInFlightRef.current = false;
        return null;
      }

      if (!result.data.current) {
        setLoadError(true);
        setIsLoading(false);
        loadOfferingsInFlightRef.current = false;
        return null;
      }

      const packages = result.data.current.availablePackages;

      const monthly = packages.find((pkg) => pkg.identifier === REVENUECAT_PACKAGE_IDS.monthly);

      if (!monthly) {
        setLoadError(true);
        setIsLoading(false);
        loadOfferingsInFlightRef.current = false;
        return null;
      }

      const metadataWarnings = packageMetadataWarnings(monthly);
      void metadataWarnings;

      setMonthlyPackage(monthly);
      setLoadError(false);
      setIsLoading(false);
      loadOfferingsInFlightRef.current = false;
      return monthly;
    } catch {
      setLoadError(true);
    }
    setIsLoading(false);
    loadOfferingsInFlightRef.current = false;
    return null;
  };

  const handlePurchase = async () => {
    if (purchaseInFlightRef.current || isPurchasing || isRestoring || promoLoading) return;
    purchaseInFlightRef.current = true;
    let packageToPurchase = monthlyPackage;
    if (!packageToPurchase) {
      setIsLoading(true);
      packageToPurchase = await loadOfferings();
      if (!packageToPurchase) {
        setFeedback({
          title: 'Unable to Load',
          message: 'Could not load subscription. Check your connection and try again.',
          variant: 'error',
        });
        setIsLoading(false);
        purchaseInFlightRef.current = false;
        return;
      }
    }
    setIsPurchasing(true);
    haptics.confirm();
    try {
      const result = await purchasePackage(packageToPurchase);
      if (result.ok) {
        await checkSubscription();
        if (customerInfoHasPremium(result.data)) {
          haptics.success();
          // guardedResetTo (not router.back) — onboarding+paywall users would
          // otherwise pop back to onboarding and re-trigger the paywall, looping.
          guardedResetTo(router, '/(tabs)', { navigationRef });
        } else {
          setFeedback({
            title: 'Purchase Pending',
            message: 'Your purchase is still being confirmed. If Pro does not unlock, tap Restore Purchases.',
            variant: 'info',
          });
        }
      } else if (result.reason === 'sdk_error') {
        const error = result.error as any;
        if (error?.userCancelled) {
          setFeedback({
            title: 'Purchase Not Completed',
            message: __DEV__ ? SANDBOX_PURCHASE_CANCEL_MESSAGE : PURCHASE_CANCEL_MESSAGE,
            variant: 'info',
          });
        } else {
          setFeedback({
            title: 'Purchase Failed',
            message: 'Please try again later.',
            variant: 'error',
          });
        }
      } else {
        setFeedback({
          title: 'Purchase Unavailable',
          message: 'Subscriptions are not available on this device right now.',
          variant: 'error',
        });
      }
    } finally {
      purchaseInFlightRef.current = false;
      setIsPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (restoreInFlightRef.current || isRestoring || isPurchasing || promoLoading) return;
    restoreInFlightRef.current = true;
    setIsRestoring(true);
    haptics.tap();
    try {
      const result = await restorePurchases();
      if (result.ok) {
        await checkSubscription({ restored: true });
        const hasActive = customerInfoHasPremium(result.data);
        if (hasActive) {
          haptics.success();
          setFeedback({
            title: 'Restored',
            message: 'Your subscription has been restored.',
            variant: 'success',
            onDismiss: () => guardedResetTo(router, '/(tabs)', { navigationRef }),
          });
        } else {
          setFeedback({
            title: 'No Subscription Found',
            message: 'No App Store subscription was found for this account. If you already had Pro, contact support and we will help recover access.',
            variant: 'info',
            actionLabel: 'Contact Support',
            secondaryActionLabel: 'OK',
            onActionPress: () => { void openSupportEmail(); },
          });
        }
      } else {
        setFeedback({
          title: 'Restore Failed',
          message: 'Please try again later.',
          variant: 'error',
        });
      }
    } finally {
      restoreInFlightRef.current = false;
      setIsRestoring(false);
    }
  };

  const storePriceString = monthlyPackage?.product?.priceString?.trim();
  const useRevenueCatTestStore = process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE === 'true';
  const priceString = resolvePaywallPriceString(storePriceString, { useRevenueCatTestStore });
  const priceHasBillingPeriod = priceIncludesBillingPeriod(priceString);
  const priceWithMonthlyPeriod = priceHasBillingPeriod ? priceString : `${priceString}/month`;
  const priceWithShortPeriod = priceHasBillingPeriod ? priceString : `${priceString}/mo`;

  const monthlyPackageHasTrial = shouldAdvertiseThreeDayTrial(monthlyPackage);
  const trialDisclosure = monthlyPackageHasTrial
    ? PAYWALL_COPY.trialDisclosure(priceWithMonthlyPeriod)
    : PAYWALL_COPY.recurringDisclosure(priceWithMonthlyPeriod);
  const purchaseCtaLabel = monthlyPackageHasTrial
    ? PAYWALL_COPY.primaryTrialCta
    : `Start Pro for ${priceWithShortPeriod}`;
  const sandboxPurchaseHint = __DEV__
    ? 'Development builds use Apple Sandbox, not your Clutch login. Use a Sandbox Apple Account from App Store Connect to test purchases.'
    : null;

  const features = [
    { IconComponent: IconPredictions, label: 'AI Predictions', desc: 'Multi-factor analysis per game', accent: MAROON, bgColor: MAROON_DIM, borderColor: 'rgba(139,10,31,0.15)' },
    { IconComponent: IconLiveScores, label: 'Live Scores', desc: 'Real-time across 11 leagues', accent: TEAL, bgColor: TEAL_DIM, borderColor: 'rgba(122,157,184,0.12)' },
    { IconComponent: IconBoxScores, label: 'Box Scores & Stats', desc: 'Full game breakdowns', accent: MAROON, bgColor: MAROON_DIM, borderColor: 'rgba(139,10,31,0.15)' },
    { IconComponent: IconWatch, label: 'Where to Watch', desc: 'TV & streaming info', accent: TEAL, bgColor: TEAL_DIM, borderColor: 'rgba(122,157,184,0.12)' },
  ] as const;

  const handleApplyPromoCode = async () => {
    const code = promoCode.trim();
    if (!code || promoLoading || promoInFlightRef.current) return;
    promoInFlightRef.current = true;
    setPromoLoading(true);
    haptics.tap();
    try {
      const rcAppUserId = await getRevenueCatAppUserId();
      const rcUserId = rcAppUserId.ok ? rcAppUserId.data : undefined;
      const result = await api.post<{ success: boolean; message: string }>('/api/promo/redeem', { code, rcUserId });
      await invalidateCustomerInfoCache();
      await checkSubscription();
      haptics.success();
      setFeedback({
        title: 'Code Applied',
        message: result.message,
        variant: 'success',
        onDismiss: () => guardedResetTo(router, '/(tabs)', { navigationRef }),
      });
    } catch (error: any) {
      haptics.error();
      setFeedback({
        title: 'Invalid Code',
        message: error?.message || 'This code could not be applied.',
        variant: 'error',
      });
    } finally {
      promoInFlightRef.current = false;
      setPromoLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <FeedbackModal
        visible={!!feedback}
        title={feedback?.title ?? ''}
        message={feedback?.message ?? ''}
        actionLabel={feedback?.actionLabel}
        secondaryActionLabel={feedback?.secondaryActionLabel}
        variant={feedback?.variant}
        onActionPress={feedback?.onActionPress}
        onSecondaryPress={feedback?.onSecondaryPress}
        onDismiss={dismissFeedback}
      />
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
          <PressableScale accessibilityRole="button" accessibilityLabel="Close paywall" onPress={() => guardedRouterBack(router, { fallback: '/(tabs)' })} style={{
            width: 44, height: 44, borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
            alignItems: 'center', justifyContent: 'center',
          }} hitSlop={12}>
            <X size={18} color="rgba(255,255,255,0.4)" />
          </PressableScale>
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
              Clutch Picks Pro{'\n'}
              <Text style={{ color: TEAL }}>built for the full board.</Text>
            </Text>
            <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.35)', marginTop: 12, lineHeight: 22 }}>
              Unified predictions, projections, simulations, live scores, and matchup context across every supported league.
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
                { teams: '— vs —', league: 'Tennis', time: 'Today' },
              ]).map((p, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  paddingHorizontal: 16, paddingVertical: 14,
                  borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.025)',
                  opacity: i === 2 ? 0.35 : 1,
                }}>
                  <View style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFF' }} numberOfLines={1}>{p.teams}</Text>
                    <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', marginTop: 2 }} numberOfLines={1}>{p.league} · {p.time}</Text>
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
              { value: '11', label: 'Leagues', color: '#FFF' },
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
              shadowColor: MAROON,
              shadowOffset: { width: 0, height: 0 },
              shadowRadius: 17,
            }, ctaGlowStyle]}>
              <LinearGradient
                colors={['rgba(224,234,240,0.44)', 'rgba(122,157,184,0.40)', 'rgba(139,10,31,0.48)', 'rgba(224,234,240,0.22)']}
                locations={[0, 0.34, 0.74, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 1.35, borderRadius: 22 }}
              >
              <View style={{ borderRadius: 20.65, overflow: 'hidden' }}>
              <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill]} />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,14,0.7)' }]} />
              <LinearGradient
                colors={['rgba(139,10,31,0.08)', 'transparent', 'rgba(122,157,184,0.04)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[StyleSheet.absoluteFill]}
              />
              <View style={{ padding: 24 }}>
                {/* Price row */}
                <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 6 }}>
                  <Text style={{ fontSize: 40, fontWeight: '900', color: '#FFF', letterSpacing: -1 }}>{priceString}</Text>
                  {!priceHasBillingPeriod ? (
                    <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>/month</Text>
                  ) : null}
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
                        accessibilityLabel="Promo code"
                        style={{ flex: 1, fontSize: 13, fontWeight: '600', color: '#FFF', padding: 0, letterSpacing: 1 }}
                        placeholder="Enter promo code"
                        placeholderTextColor="rgba(255,255,255,0.15)"
                        value={promoCode}
                        onChangeText={(t) => setPromoCode(t.toUpperCase())}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        returnKeyType="done"
                      />
                      {promoCode.length > 0 ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Clear promo code"
                          onPress={() => setPromoCode('')}
                          style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -12 }}
                        >
                          <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>×</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Apply promo code"
                      accessibilityState={{ disabled: !promoCode.trim() || promoLoading, busy: promoLoading }}
                      onPress={handleApplyPromoCode}
                      disabled={!promoCode.trim() || promoLoading}
                      style={{
                        backgroundColor: promoCode.trim() ? TEAL : 'rgba(122,157,184,0.2)',
                        minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10,
                        alignItems: 'center', justifyContent: 'center',
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
                    accessibilityRole="button"
                    accessibilityLabel="Enter promo code"
                    onPress={() => setPromoOpen(true)}
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16, alignSelf: 'flex-start' }}
                  >
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                      <Path d="M12 4v16M4 12h16" stroke={TEAL} strokeWidth={2} strokeLinecap="round" />
                    </Svg>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: TEAL }}>Have a promo code?</Text>
                  </Pressable>
                )}

                {/* CTA button */}
                {isLoading ? (
                  <ShimmerButton loading={true} label="Loading..." />
                ) : loadError ? (
                  <ShimmerButton onPress={loadOfferings} loading={false} label="Tap to Retry" />
                ) : (
                  <ShimmerButton onPress={handlePurchase} loading={isPurchasing} label={purchaseCtaLabel} loadingLabel="Opening App Store..." />
                )}

                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: 10 }}>
                  {trialDisclosure}
                </Text>
                {sandboxPurchaseHint ? (
                  <Text style={{ fontSize: 10, color: 'rgba(122,157,184,0.65)', textAlign: 'center', marginTop: 8, lineHeight: 15 }}>
                    {sandboxPurchaseHint}
                  </Text>
                ) : null}
                <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', marginTop: 6, lineHeight: 15 }}>
                  Subscription provides access to AI-generated predictions for entertainment purposes only.
                </Text>
              </View>
              </View>
              </LinearGradient>
            </Animated.View>
          </Animated.View>

          {/* ═══ RESTORE + LEGAL ═══ */}
          <Animated.View entering={FadeIn.delay(440)} style={{ alignItems: 'center', paddingTop: 20 }}>
            <Pressable
              onPress={handleRestore}
              disabled={isRestoring}
              accessibilityRole="button"
              accessibilityLabel="Restore purchases"
              accessibilityState={{ disabled: isRestoring, busy: isRestoring }}
              style={{ minHeight: 44, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}>
              {isRestoring ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color={TEAL} size="small" />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: TEAL }}>Restoring...</Text>
                </View>
              ) : (
                <Text style={{ fontSize: 13, fontWeight: '700', color: TEAL }}>Restore Purchases</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => { void Linking.openURL('https://apps.apple.com/account/subscriptions'); }}
              accessibilityRole="button"
              accessibilityLabel="Manage subscription"
              style={{ minHeight: 44, marginTop: 6, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: TEAL, textDecorationLine: 'underline' }}>Manage Subscription</Text>
            </Pressable>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
              <Pressable
                onPress={() => guardedRouterPush(router, '/terms' as any)}
                accessibilityRole="button"
                accessibilityLabel="Terms of service"
                style={{ minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecorationLine: 'underline' }}>Terms</Text>
              </Pressable>
              <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.15)' }}>·</Text>
              <Pressable
                onPress={() => guardedRouterPush(router, '/privacy-policy' as any)}
                accessibilityRole="button"
                accessibilityLabel="Privacy policy"
                style={{ minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
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
