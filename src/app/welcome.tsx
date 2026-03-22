import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle, Line, Rect, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';

const { width: W } = Dimensions.get('window');

const BG = '#040608';
const TEAL = '#7A9DB8';
const TEAL_DARK = '#5A7A8A';
const CORAL = '#E8936A';
const GREEN = '#4ADE80';

function TargetIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Circle cx={16} cy={16} r={14} stroke={CORAL} strokeWidth={2} fill="none" />
      <Circle cx={16} cy={16} r={10} stroke={CORAL} strokeWidth={1.2} fill="none" opacity={0.35} />
      <Circle cx={16} cy={16} r={6} stroke={CORAL} strokeWidth={1.5} fill="none" opacity={0.55} />
      <Circle cx={16} cy={16} r={2.5} fill={CORAL} />
      <Line x1={16} y1={2} x2={16} y2={7} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Line x1={16} y1={25} x2={16} y2={30} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Line x1={2} y1={16} x2={7} y2={16} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Line x1={25} y1={16} x2={30} y2={16} stroke={TEAL} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

function ChartIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <SvgGrad id="chart-bar" x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={TEAL} stopOpacity={0.2} />
          <Stop offset="1" stopColor={CORAL} stopOpacity={0.8} />
        </SvgGrad>
      </Defs>
      <Rect x={4} y={18} width={5} height={10} rx={2} fill="url(#chart-bar)" />
      <Rect x={11} y={13} width={5} height={15} rx={2} fill="url(#chart-bar)" />
      <Rect x={18} y={8} width={5} height={20} rx={2} fill="url(#chart-bar)" />
      <Rect x={25} y={4} width={5} height={24} rx={2} fill="url(#chart-bar)" />
      <Path d="M6 17 L13 12 L20 7 L27 3" stroke={CORAL} strokeWidth={1.5} strokeLinecap="round" fill="none" opacity={0.7} />
      <Circle cx={27} cy={3} r={2} fill={CORAL} />
    </Svg>
  );
}

function BoltIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Defs>
        <SvgGrad id="bolt-g" x1="0.5" y1="0" x2="0.5" y2="1">
          <Stop offset="0" stopColor={CORAL} stopOpacity={1} />
          <Stop offset="1" stopColor={CORAL} stopOpacity={0.5} />
        </SvgGrad>
      </Defs>
      <Path d="M18 2 L8 16 L14 16 L12 30 L24 14 L17 14 Z" fill="url(#bolt-g)" />
      <Path d="M17 4 L10 15 L14.5 15 L13 27 L22 15 L17.5 15 Z" fill="white" fillOpacity={0.12} />
    </Svg>
  );
}

function FieldGoalU({ color, size = 42 }: { color: string; size?: number }) {
  return (
    <Svg width={size * 0.65} height={size} viewBox="0 0 26 40" fill="none">
      <Path d="M4 0 L4 30" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <Path d="M22 0 L22 30" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <Path d="M4 30 L22 30" stroke={color} strokeWidth={5} strokeLinecap="round" />
      <Path d="M13 30 L13 40" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <Path d="M8 15 Q13 10 18 15 Q13 20 8 15" fill={color} transform="rotate(-35 13 15)" />
      <Path d="M13 13 L13 17" stroke={color === '#000000' ? '#000000' : '#0D0D0D'} strokeWidth={1.2} strokeLinecap="round" transform="rotate(-35 13 15)" />
      <Path d="M11.5 14 L14.5 14" stroke={color === '#000000' ? '#000000' : '#0D0D0D'} strokeWidth={0.8} transform="rotate(-35 13 15)" />
      <Path d="M11.5 16 L14.5 16" stroke={color === '#000000' ? '#000000' : '#0D0D0D'} strokeWidth={0.8} transform="rotate(-35 13 15)" />
    </Svg>
  );
}

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'MLS', 'EPL', 'NCAAF', 'NCAAB'];

export default function WelcomeScreen() {
  const router = useRouter();

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={[BG, '#060A10', BG]} style={StyleSheet.absoluteFill} />
      <View style={[s.glow, { top: -80, left: W * 0.2, backgroundColor: `${TEAL}18` }]} />
      <View style={[s.glow, { bottom: -60, left: -40, backgroundColor: `${CORAL}08`, width: 200, height: 200 }]} />
      <View style={[s.glow, { bottom: -60, right: -40, backgroundColor: `${CORAL}06`, width: 180, height: 180 }]} />

      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.content}>
          <View style={s.liveBadge}>
            <View style={s.greenDot} />
            <Text style={s.liveText}>LIVE PREDICTIONS</Text>
          </View>

          <View style={{ height: 32 }} />

          <View style={s.logoContainer}>
            <View style={s.logoRow}>
              <View style={{ position: 'relative' }}>
                <Text style={[s.logoLetter, { position: 'absolute', left: 3, top: 3, color: '#000' }]}>CL</Text>
                <Text style={[s.logoLetter, { position: 'absolute', left: 1.5, top: 1.5, color: TEAL_DARK }]}>CL</Text>
                <Text style={s.logoLetter}>CL</Text>
              </View>
              <View style={{ marginBottom: 4, marginHorizontal: -2 }}>
                <View style={{ position: 'absolute', left: 3, top: 3 }}><FieldGoalU color="#000000" size={40} /></View>
                <View style={{ position: 'absolute', left: 1.5, top: 1.5 }}><FieldGoalU color={TEAL_DARK} size={40} /></View>
                <FieldGoalU color="#FFFFFF" size={40} />
              </View>
              <View style={{ position: 'relative' }}>
                <Text style={[s.logoLetter, { position: 'absolute', left: 3, top: 3, color: '#000' }]}>TCH</Text>
                <Text style={[s.logoLetter, { position: 'absolute', left: 1.5, top: 1.5, color: TEAL_DARK }]}>TCH</Text>
                <Text style={s.logoLetter}>TCH</Text>
              </View>
            </View>
            <View style={s.picksBadge}>
              <Text style={s.picksText}>PICKS</Text>
            </View>
          </View>

          <View style={{ height: 24 }} />
          <Text style={s.headline}>AI-Powered Sports Predictions</Text>
          <View style={{ height: 8 }} />
          <Text style={s.subtitle}>Pick winners across 8 leagues.{'\n'}Track your record. Build your streak.</Text>

          <View style={{ height: 24 }} />

          <View style={s.sportsRow}>
            {SPORTS.map((sport) => (
              <View key={sport} style={s.sportItem}>
                <View style={s.coralDot} />
                <Text style={s.sportText}>{sport}</Text>
              </View>
            ))}
          </View>

          <View style={{ height: 28 }} />

          {/* Everything in one place */}
          <View style={{ width: '100%' }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.15)', letterSpacing: 2, textAlign: 'center', marginBottom: 12 }}>EVERYTHING IN ONE PLACE</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {[
                { label: 'Live Scores', desc: 'Real-time updates', color: TEAL },
                { label: 'Where to Watch', desc: 'TV & streaming', color: CORAL },
                { label: 'Box Scores', desc: 'Full game stats', color: TEAL },
                { label: 'AI Predictions', desc: '19-factor analysis', color: CORAL },
                { label: 'Pick Tracking', desc: 'Build your record', color: GREEN },
                { label: '8 Leagues', desc: 'NFL to EPL', color: TEAL },
              ].map((f, i) => (
                <View key={i} style={{
                  width: '47%',
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.06)',
                }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: f.color, marginBottom: 8, opacity: 0.6 }} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>{f.label}</Text>
                  <Text style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{f.desc}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={{ flex: 1, minHeight: 20 }} />

          <TouchableOpacity onPress={() => router.replace('/sign-in')} activeOpacity={0.85} style={s.ctaOuter}>
            <LinearGradient colors={[TEAL_DARK, TEAL]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.ctaGradient}>
              <LinearGradient colors={['rgba(255,255,255,0.12)', 'transparent']} style={s.ctaSheen} />
              <Text style={s.ctaText}>Get Started</Text>
            </LinearGradient>
          </TouchableOpacity>

          <View style={{ height: 16 }} />

          <TouchableOpacity onPress={() => router.push('/sign-in')} activeOpacity={0.7}>
            <Text style={s.signInLink}>
              Already have an account? <Text style={{ color: CORAL, fontWeight: '600' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>

          <View style={{ height: 12 }} />

          <Text style={s.terms}>
            By continuing, you agree to our{' '}
            <Text style={s.termsLink} onPress={() => router.push('/terms' as any)}>Terms</Text>
            {' & '}
            <Text style={s.termsLink} onPress={() => router.push('/privacy-policy' as any)}>Privacy Policy</Text>
          </Text>

          <View style={{ height: 36 }} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  safe: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, alignItems: 'center' },
  glow: { position: 'absolute', width: 260, height: 260, borderRadius: 130 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  liveText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)', letterSpacing: 2 },
  logoContainer: { alignItems: 'center', gap: 8 },
  logoRow: { flexDirection: 'row', alignItems: 'flex-end' },
  logoLetter: { fontSize: 40, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2, lineHeight: 44 },
  picksBadge: { backgroundColor: 'rgba(90,122,138,0.35)', borderWidth: 2, borderColor: TEAL_DARK, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 8 },
  picksText: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', letterSpacing: 5 },
  headline: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', lineHeight: 25 },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', lineHeight: 20 },
  pillRow: { flexDirection: 'row', gap: 8, width: '100%' },
  pill: { flex: 1, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 12, backgroundColor: `${CORAL}0A`, borderWidth: 1, borderColor: `${CORAL}1A`, alignItems: 'center', gap: 6 },
  pillLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  sportsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  sportItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coralDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: CORAL },
  sportText: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 },
  ctaOuter: { width: '100%', height: 54, borderRadius: 14, overflow: 'hidden' },
  ctaGradient: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  ctaSheen: { position: 'absolute', top: 0, left: 0, right: 0, height: '50%', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  signInLink: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
  terms: { fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center' },
  termsLink: { color: `${TEAL}90`, textDecorationLine: 'underline' as const },
});
