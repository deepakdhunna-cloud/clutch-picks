import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, Pressable, Dimensions, StyleSheet, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSpring, Easing, interpolate, withSequence } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Rect, Text as SvgText, Circle, Line } from 'react-native-svg';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { getTeamColors } from '@/lib/team-colors';
import { Sport } from '@/types/sports';
import * as Haptics from 'expo-haptics';

const { width: W } = Dimensions.get('window');
const TEAL = '#7A9DB8';
const TEAL_DARK = '#5A7A8A';
const CORAL = '#E8936A';
const GREEN = '#4ADE80';
const BG = '#040608';

// ─── SLIDE 1: Live Score Card ────────────────────────────────
function LiveCardDemo() {
  const [homeScore, setHomeScore] = useState(104);
  const [awayScore, setAwayScore] = useState(98);
  const [flashTeam, setFlashTeam] = useState<'home' | 'away' | null>(null);
  const pulseAnim = useSharedValue(0.4);

  useEffect(() => {
    pulseAnim.value = withRepeat(withTiming(1, { duration: 1000 }), -1, true);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const who = Math.random() > 0.45 ? 'home' : 'away';
      const pts = Math.random() > 0.6 ? 3 : 2;
      if (who === 'home') setHomeScore(s => s + pts);
      else setAwayScore(s => s + pts);
      setFlashTeam(who);
      setTimeout(() => setFlashTeam(null), 600);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulseAnim.value }));
  const homeWinning = homeScore > awayScore;
  const awayWinning = awayScore > homeScore;
  const gswColors = getTeamColors('GSW', Sport.NBA);
  const lalColors = getTeamColors('LAL', Sport.NBA);
  const jerseyType = sportEnumToJersey('NBA');

  return (
    <View style={{ alignItems: 'center' }}>
      {/* Ambient glow */}
      <View style={{ position: 'absolute', top: -20, width: 200, height: 120, borderRadius: 100, backgroundColor: `${CORAL}12`, transform: [{ scaleX: 1.5 }] }} />

      <View style={{
        width: 260, borderRadius: 16, overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
      }}>
        <LinearGradient colors={['rgba(4,5,10,0.88)', 'rgba(4,5,10,0.92)']} style={StyleSheet.absoluteFillObject} />
        {/* Team color bleeds */}
        <LinearGradient colors={[`${gswColors.primary}99`, `${gswColors.primary}44`, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.8 }} style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={[`${lalColors.primary}99`, `${lalColors.primary}44`, 'transparent']} start={{ x: 1, y: 1 }} end={{ x: 0.3, y: 0.2 }} style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['transparent', 'rgba(2,3,8,0.72)', 'transparent']} style={StyleSheet.absoluteFillObject} />

        <View style={{ zIndex: 1 }}>
          {/* LIVE header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Animated.View style={[{ width: 5, height: 5, borderRadius: 3, backgroundColor: CORAL }, pulseStyle]} />
              <Text style={{ color: CORAL, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }}>LIVE</Text>
            </View>
            <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 8, fontWeight: '700' }}>NBA</Text>
            </View>
          </View>

          {/* Teams */}
          <View style={{ paddingHorizontal: 12, paddingVertical: 4, gap: 6 }}>
            {/* Warriors */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <JerseyIcon teamCode="GSW" primaryColor={gswColors.primary} secondaryColor={gswColors.secondary} size={26} sport={jerseyType} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: awayWinning ? '#FFF' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: awayWinning ? '800' : '600' }}>Warriors</Text>
                <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8 }}>36-28</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: '900', color: flashTeam === 'away' ? GREEN : awayWinning ? '#FFF' : 'rgba(255,255,255,0.35)' }}>{awayScore}</Text>
            </View>
            {/* Lakers */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <JerseyIcon teamCode="LAL" primaryColor={lalColors.primary} secondaryColor={lalColors.secondary} size={26} sport={jerseyType} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: homeWinning ? '#FFF' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: homeWinning ? '800' : '600' }}>Lakers</Text>
                <Text style={{ color: 'rgba(255,255,255,0.25)', fontSize: 8 }}>38-26</Text>
              </View>
              <Text style={{ fontSize: 18, fontWeight: '900', color: flashTeam === 'home' ? GREEN : homeWinning ? '#FFF' : 'rgba(255,255,255,0.35)' }}>{homeScore}</Text>
            </View>
          </View>

          {/* Bottom */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.06)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '700' }}>Q3</Text>
              </View>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700' }}>5:42</Text>
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 8 }}>ESPN</Text>
          </View>
        </View>
      </View>

      {/* Stacked card depth illusion */}
      <View style={{ position: 'absolute', top: 8, left: 20, right: 20, bottom: -6, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', zIndex: -1, transform: [{ scale: 0.95 }] }} />
    </View>
  );
}

// ─── SLIDE 2: Jersey Pick ────────────────────────────────────
function JerseyPickDemo() {
  const [picked, setPicked] = useState<'home' | 'away' | null>(null);
  const homeScale = useSharedValue(1);
  const awayScale = useSharedValue(1);
  const [cycle, setCycle] = useState(0);

  const detColors = getTeamColors('DET', Sport.NBA);
  const phiColors = getTeamColors('PHI', Sport.NBA);
  const jerseyType = sportEnumToJersey('NBA');

  const doPick = useCallback((team: 'home' | 'away') => {
    setPicked(team);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const target = team === 'home' ? homeScale : awayScale;
    const other = team === 'home' ? awayScale : homeScale;
    target.value = withSequence(withSpring(0.88, { damping: 15 }), withSpring(1.05, { damping: 12 }), withSpring(1, { damping: 10 }));
    other.value = withSpring(0.9, { damping: 12 });
  }, []);

  useEffect(() => {
    const t: ReturnType<typeof setTimeout>[] = [];
    t.push(setTimeout(() => doPick('home'), 1500));
    t.push(setTimeout(() => doPick('away'), 4000));
    t.push(setTimeout(() => doPick('home'), 6500));
    t.push(setTimeout(() => { homeScale.value = withSpring(1); awayScale.value = withSpring(1); setPicked(null); setCycle(c => c + 1); }, 9000));
    return () => t.forEach(clearTimeout);
  }, [cycle]);

  const homeStyle = useAnimatedStyle(() => ({ transform: [{ scale: homeScale.value }] }));
  const awayStyle = useAnimatedStyle(() => ({ transform: [{ scale: awayScale.value }] }));

  return (
    <View style={{ width: 290, overflow: 'visible' }}>
      {/* Spotlight glows */}
      <View style={{ position: 'absolute', top: -30, left: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: picked === 'home' ? `${CORAL}18` : `${detColors.primary}08`, zIndex: -1 }} pointerEvents="none" />
      <View style={{ position: 'absolute', top: -30, right: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: picked === 'away' ? `${CORAL}18` : `${phiColors.primary}08`, zIndex: -1 }} pointerEvents="none" />

      {/* Team names */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 4 }}>
        <View style={{ opacity: picked === 'away' ? 0.4 : 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF' }}>Detroit</Text>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>46-18</Text>
        </View>
        <View style={{ alignItems: 'flex-end', opacity: picked === 'home' ? 0.4 : 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '900', color: '#FFF' }}>Philadelphia</Text>
          <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>35-30</Text>
        </View>
      </View>

      {/* Jerseys + score */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <Pressable onPress={() => doPick('home')}>
          <Animated.View style={[homeStyle, { alignItems: 'center', opacity: picked === 'away' ? 0.5 : 1 }]}>
            <View style={picked === 'home' ? { shadowColor: CORAL, shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
              <JerseyIcon teamCode="DET" primaryColor={detColors.primary} secondaryColor={detColors.secondary} size={76} sport={jerseyType} />
            </View>
            {picked === 'home' ? (
              <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: BG }}>
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#000' }}>✓</Text>
              </View>
            ) : null}
          </Animated.View>
        </Pressable>

        <View style={{ alignItems: 'center', paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
            <Text style={{ fontSize: 28, fontWeight: '900', color: '#FFF' }}>0</Text>
            <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>–</Text>
            <Text style={{ fontSize: 28, fontWeight: '900', color: 'rgba(255,255,255,0.6)' }}>0</Text>
          </View>
          <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: '700', letterSpacing: 1.5 }}>TONIGHT 7:00</Text>
        </View>

        <Pressable onPress={() => doPick('away')}>
          <Animated.View style={[awayStyle, { alignItems: 'center', opacity: picked === 'home' ? 0.5 : 1 }]}>
            <View style={picked === 'away' ? { shadowColor: CORAL, shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 0 } } : { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
              <JerseyIcon teamCode="PHI" primaryColor={phiColors.primary} secondaryColor={phiColors.secondary} size={76} sport={jerseyType} />
            </View>
            {picked === 'away' ? (
              <View style={{ position: 'absolute', bottom: -3, right: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: CORAL, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: BG }}>
                <Text style={{ fontSize: 12, fontWeight: '900', color: '#000' }}>✓</Text>
              </View>
            ) : null}
          </Animated.View>
        </Pressable>
      </View>

      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 8 }}>
        {picked ? 'Tap the other jersey to switch' : 'Tap a jersey to pick the winner'}
      </Text>
    </View>
  );
}

// ─── SLIDE 3: AI Analysis ────────────────────────────────────
function AIDemo() {
  const [visible, setVisible] = useState(0);
  const [cycle, setCycle] = useState(0);
  const factors = [
    { name: 'Home Court', home: 0.7, away: 0.3, edge: 'home' as const },
    { name: 'Recent Form', home: 0.4, away: 0.8, edge: 'away' as const },
    { name: 'Head to Head', home: 0.6, away: 0.5, edge: 'home' as const },
    { name: 'Rest Days', home: 0.5, away: 0.7, edge: 'away' as const },
    { name: 'Momentum', home: 0.8, away: 0.4, edge: 'home' as const },
  ];

  useEffect(() => {
    setVisible(0);
    const t: ReturnType<typeof setTimeout>[] = [];
    factors.forEach((_, i) => t.push(setTimeout(() => setVisible(i + 1), 600 + i * 450)));
    t.push(setTimeout(() => setCycle(c => c + 1), 600 + factors.length * 450 + 2000));
    return () => t.forEach(clearTimeout);
  }, [cycle]);

  const confPct = Math.round((visible / factors.length) * 73 + 27);

  return (
    <View style={{ width: 260 }}>
      {/* Confidence meter */}
      <View style={{ marginBottom: 14, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.3)', letterSpacing: 2 }}>CONFIDENCE</Text>
          <Text style={{ fontSize: 18, fontWeight: '900', color: CORAL }}>{confPct}%</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 2 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < Math.round((confPct / 100) * 12) ? CORAL : 'rgba(255,255,255,0.06)' }} />
          ))}
        </View>
      </View>

      {factors.map((f, i) => (
        <View key={f.name} style={{
          opacity: i < visible ? 1 : 0.1,
          padding: 8, paddingHorizontal: 10, borderRadius: 10,
          backgroundColor: i < visible ? 'rgba(255,255,255,0.03)' : 'transparent',
          borderWidth: 1, borderColor: i < visible ? 'rgba(255,255,255,0.06)' : 'transparent',
          marginBottom: 4,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#FFF' }}>{f.name}</Text>
            {i < visible ? (
              <View style={{ backgroundColor: f.edge === 'home' ? `${TEAL}15` : `${CORAL}15`, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 }}>
                <Text style={{ fontSize: 8, fontWeight: '800', color: f.edge === 'home' ? TEAL : CORAL }}>{f.edge === 'home' ? 'HOME' : 'AWAY'}</Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 2, height: 3 }}>
            <View style={{ flex: f.home, height: 3, borderRadius: 2, backgroundColor: i < visible ? TEAL : 'rgba(255,255,255,0.04)' }} />
            <View style={{ flex: f.away, height: 3, borderRadius: 2, backgroundColor: i < visible ? CORAL : 'rgba(255,255,255,0.03)' }} />
          </View>
        </View>
      ))}
      <Text style={{ fontSize: 9, color: 'rgba(255,255,255,0.12)', textAlign: 'center', marginTop: 6 }}>19 factors analyzed per game with Pro</Text>
    </View>
  );
}

// ─── SLIDE 4: Profile Card ───────────────────────────────────
function ProfileDemo() {
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [streak, setStreak] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    setWins(0); setLosses(0); setStreak(0);
    const picks = [true, true, false, true, true, true, false, true];
    const t: ReturnType<typeof setTimeout>[] = [];
    let w = 0, l = 0, s = 0;
    picks.forEach((win, i) => {
      t.push(setTimeout(() => {
        if (win) { w++; s++; } else { l++; s = 0; }
        setWins(w); setLosses(l); setStreak(s);
      }, 800 + i * 600));
    });
    t.push(setTimeout(() => setCycle(c => c + 1), 800 + picks.length * 600 + 2000));
    return () => t.forEach(clearTimeout);
  }, [cycle]);

  const total = wins + losses;
  const pct = total > 0 ? Math.round((wins / total) * 100) : 0;
  const tier = pct >= 75 ? 'GOAT' : pct >= 65 ? 'MVP' : pct >= 55 ? 'ALL-STAR' : pct >= 45 ? 'STARTER' : 'ROOKIE';
  const tierColor = pct >= 75 ? '#D4B896' : pct >= 65 ? CORAL : pct >= 55 ? CORAL : pct >= 45 ? TEAL : '#8A8A90';

  return (
    <View style={{ width: 240 }}>
      <View style={{ position: 'absolute', top: '30%', alignSelf: 'center', width: 160, height: 100, borderRadius: 80, backgroundColor: `${tierColor}15`, transform: [{ scaleX: 1.3 }] }} />
      <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: `${tierColor}50`, backgroundColor: 'rgba(8,6,16,0.95)', padding: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 5, backgroundColor: `${tierColor}20`, borderWidth: 1, borderColor: `${tierColor}30` }}>
            <Text style={{ fontSize: 7, fontWeight: '900', color: tierColor, letterSpacing: 2 }}>{tier}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: tierColor }}>{pct}</Text>
            <Text style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', marginLeft: 2 }}>OVR</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${tierColor}20`, borderWidth: 2, borderColor: `${tierColor}40`, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '900', color: tierColor }}>Y</Text>
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#FFF', textTransform: 'uppercase' }}>YOU</Text>
            <Text style={{ fontSize: 9, fontStyle: 'italic', color: 'rgba(255,255,255,0.2)' }}>"Sports enthusiast"</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10 }}>
          {[
            { l: 'PK', v: String(total), c: '#FFF' },
            { l: 'W', v: String(wins), c: TEAL },
            { l: 'L', v: String(losses), c: CORAL },
            { l: 'PCT', v: `${pct}%`, c: '#FFF' },
            { l: 'STK', v: streak > 0 ? `W${streak}` : '—', c: GREEN },
          ].map(s => (
            <View key={s.l} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 6, fontWeight: '700', color: 'rgba(255,255,255,0.2)', letterSpacing: 1, marginBottom: 3 }}>{s.l}</Text>
              <Text style={{ fontSize: 13, fontWeight: '900', color: s.c }}>{s.v}</Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 10 }}>Your card levels up as you win</Text>
    </View>
  );
}

// ─── SLIDE CONFIG ────────────────────────────────────────────
const SLIDES = [
  { Demo: LiveCardDemo, title: 'Every Game. One Place.', body: 'Live scores, box scores, and where to watch — across NBA, NFL, MLB, NHL, MLS, EPL, NCAAF, and NCAAB.', accent: TEAL },
  { Demo: JerseyPickDemo, title: 'Pick Your Winners', body: 'Tap a jersey to pick who wins. Change your mind anytime before the game starts.', accent: CORAL },
  { Demo: AIDemo, title: 'AI Predictions', body: '19 factors analyzed per game — momentum, matchups, form, and more. Upgrade to Pro to unlock every prediction.', accent: TEAL },
  { Demo: ProfileDemo, title: 'Build Your Record', body: 'Track your wins, losses, and streaks. Your profile card levels up as your record improves.', accent: GREEN },
];

// ─── DOTS ────────────────────────────────────────────────────
function Dots({ current }: { current: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
      {SLIDES.map((_, i) => (
        <View key={i} style={{
          width: i === current ? 28 : 8, height: 8, borderRadius: 4,
          backgroundColor: i === current ? CORAL : 'rgba(255,255,255,0.12)',
        }} />
      ))}
    </View>
  );
}

// ─── MAIN ────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleNext = useCallback(() => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      completeOnboarding();
    }
  }, [currentIndex]);

  const completeOnboarding = async () => {
    try {
      await AsyncStorage.setItem('clutch_onboarding_complete', 'true');
    } catch {} // Don't block navigation if storage fails
    router.replace('/(tabs)');
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setCurrentIndex(viewableItems[0].index ?? 0);
    }
  }).current;

  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Skip */}
        {!isLast ? (
          <Pressable onPress={completeOnboarding} style={{ position: 'absolute', top: 16, right: 20, zIndex: 10, padding: 8 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.3)' }}>Skip</Text>
          </Pressable>
        ) : null}

        {/* Slides */}
        <FlatList
          ref={flatListRef}
          data={SLIDES}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          decelerationRate="fast"
          snapToInterval={W}
          snapToAlignment="start"
          getItemLayout={(_, index) => ({ length: W, offset: W * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => (
            <View style={{ width: W, flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 }}>
              <View style={{ marginBottom: 24 }}>
                <item.Demo />
              </View>
              <Text style={{ fontSize: 24, fontWeight: '900', color: '#FFF', textAlign: 'center', letterSpacing: -0.5, marginBottom: 10, lineHeight: 30 }}>{item.title}</Text>
              <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', textAlign: 'center', lineHeight: 20, maxWidth: 280 }}>{item.body}</Text>
            </View>
          )}
        />

        {/* Bottom */}
        <View style={{ paddingHorizontal: 28, paddingBottom: 20, gap: 18 }}>
          <Dots current={currentIndex} />
          <Pressable onPress={handleNext} style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <LinearGradient
              colors={isLast ? [CORAL, '#D07850'] : [TEAL, TEAL_DARK]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFF', letterSpacing: 0.5 }}>{isLast ? "Let's Go" : 'Next'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
