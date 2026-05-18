import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Check, ShieldCheck, Sparkles, X } from 'lucide-react-native';
import { JerseyIcon, sportEnumToJersey } from '@/components/JerseyIcon';
import { getTeamColors } from '@/lib/team-colors';
import { Sport } from '@/types/sports';

type PickConfirmationTeam = {
  abbreviation: string;
  name: string;
  record?: string | null;
  color?: string | null;
};

type TeamColors = {
  primary: string;
  secondary: string;
};

type PickConfirmationModalProps = {
  visible: boolean;
  team: PickConfirmationTeam | null;
  teamColors?: TeamColors;
  teamColor?: string | null;
  sport: Sport;
  isChanging?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export const PickConfirmationModal = memo(function PickConfirmationModal({
  visible,
  team,
  teamColors,
  teamColor,
  sport,
  isChanging = false,
  onConfirm,
  onCancel,
}: PickConfirmationModalProps) {
  const { width } = useWindowDimensions();
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const cardScale = useSharedValue(0.92);
  const cardOpacity = useSharedValue(0);
  const jerseyScale = useSharedValue(1);
  const sweepProgress = useSharedValue(0);
  const haloRotate = useSharedValue(0);
  const successScale = useSharedValue(0);

  const resolvedColors = useMemo<TeamColors>(() => {
    if (teamColors) return teamColors;
    if (!team) return { primary: '#7A9DB8', secondary: '#0C1018' };
    return getTeamColors(team.abbreviation, sport, team.color ?? teamColor ?? undefined);
  }, [sport, team, teamColor, teamColors]);

  useEffect(() => {
    if (visible) {
      cardOpacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.ease) });
      cardScale.value = withSpring(1, { damping: 17, stiffness: 180 });
      jerseyScale.value = 1;
      sweepProgress.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 2100, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      haloRotate.value = withRepeat(
        withTiming(360, { duration: 9000, easing: Easing.linear }),
        -1,
        false
      );
      successScale.value = 0;
      setIsConfirming(false);
      setShowSuccess(false);
    } else {
      cardOpacity.value = 0;
      cardScale.value = 0.92;
      jerseyScale.value = 1;
      sweepProgress.value = 0;
      haloRotate.value = 0;
      successScale.value = 0;
    }
  }, [visible, cardOpacity, cardScale, haloRotate, jerseyScale, successScale, sweepProgress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [
      { scale: cardScale.value },
      { translateY: interpolate(cardScale.value, [0.92, 1], [18, 0]) },
    ],
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sweepProgress.value, [0, 0.5, 1], [0.08, 0.42, 0.08]),
    transform: [
      { translateX: interpolate(sweepProgress.value, [0, 1], [-92, 92]) },
      { rotate: '-18deg' },
    ],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${haloRotate.value}deg` }],
  }));

  const jerseyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: jerseyScale.value }, { translateY: isConfirming ? -4 : 0 }],
  }));

  const successStyle = useAnimatedStyle(() => ({
    opacity: successScale.value,
    transform: [{ scale: successScale.value }],
  }));

  const handleConfirm = useCallback(() => {
    if (isConfirming) return;
    setIsConfirming(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    jerseyScale.value = withSequence(
      withTiming(1.12, { duration: 260, easing: Easing.out(Easing.ease) }),
      withSpring(1, { damping: 12, stiffness: 180 })
    );

    setTimeout(() => {
      setShowSuccess(true);
      successScale.value = withSpring(1, { damping: 12, stiffness: 180 });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, 260);

    setTimeout(() => {
      onConfirm();
    }, 1150);
  }, [isConfirming, jerseyScale, onConfirm, successScale]);

  if (!team) return null;

  const cardWidth = Math.min(width - 38, 360);
  const titleText = showSuccess
    ? 'Pick Locked'
    : isChanging
      ? 'Switch your pick?'
      : 'Lock in your pick?';
  const bodyText = showSuccess ? 'Saved to your game board.' : 'Confirm this selection before it goes on your board.';
  const recordText = team.record?.trim() ? team.record.trim() : 'Season record';

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <LinearGradient
          colors={[
            'rgba(0,0,0,0.94)',
            `${resolvedColors.primary}24`,
            'rgba(0,0,0,0.92)',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={isConfirming ? undefined : onCancel} />

        <Animated.View style={[cardStyle, { width: cardWidth }]}>
          <LinearGradient
            colors={[`${resolvedColors.primary}A8`, 'rgba(216,192,140,0.62)', 'rgba(218,238,251,0.18)', `${resolvedColors.secondary}88`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardBorder}
          >
            <LinearGradient
              colors={['#121821', '#070A0F', '#10151D']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.card}
            >
              <View style={styles.topRow}>
                <View style={styles.eyebrowPill}>
                  <Sparkles size={12} color="rgba(218,238,251,0.88)" strokeWidth={2.3} />
                  <Text style={styles.eyebrowText}>Pick Moment</Text>
                </View>
                <Pressable
                  onPress={isConfirming ? undefined : onCancel}
                  hitSlop={10}
                  style={({ pressed }) => [styles.closeButton, pressed && !isConfirming ? styles.pressed : null]}
                >
                  <X size={18} color="rgba(226,240,249,0.78)" strokeWidth={2.8} />
                </Pressable>
              </View>

              <View style={styles.jerseyStage}>
                <Animated.View style={[styles.luxeHalo, haloStyle, { borderColor: `${resolvedColors.primary}55` }]}>
                  <View style={[styles.haloTick, styles.haloTickTop, { backgroundColor: '#D8C08C' }]} />
                  <View style={[styles.haloTick, styles.haloTickBottom, { backgroundColor: resolvedColors.primary }]} />
                </Animated.View>
                <View style={styles.luxePlinth}>
                  <LinearGradient
                    colors={['rgba(216,192,140,0.16)', `${resolvedColors.primary}28`, 'rgba(218,238,251,0.08)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Animated.View style={[styles.luxeSweep, sweepStyle]}>
                    <LinearGradient
                      colors={['transparent', 'rgba(255,255,255,0.46)', 'transparent']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>
                </View>
                <View style={[styles.stageLine, styles.stageLineTop, { backgroundColor: `${resolvedColors.primary}42` }]} />
                <View style={[styles.stageLine, styles.stageLineBottom, { backgroundColor: 'rgba(216,192,140,0.28)' }]} />
                <Animated.View style={jerseyStyle}>
                  <JerseyIcon
                    teamCode={team.abbreviation}
                    teamName={team.name}
                    primaryColor={resolvedColors.primary}
                    secondaryColor={resolvedColors.secondary}
                    size={108}
                    sport={sportEnumToJersey(sport)}
                  />
                </Animated.View>
                {showSuccess ? (
                  <Animated.View style={[styles.successBadge, successStyle]}>
                    <Check size={18} color="#041016" strokeWidth={3.4} />
                  </Animated.View>
                ) : null}
              </View>

              <Text style={styles.title}>{titleText}</Text>
              <Text style={styles.teamName} numberOfLines={2}>{team.name}</Text>
              <View style={styles.recordPill}>
                <Text style={styles.recordText}>{recordText}</Text>
              </View>
              <Text style={styles.body}>{bodyText}</Text>

              {!isConfirming ? (
                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={onCancel}
                    style={({ pressed }) => [styles.cancelButton, pressed ? styles.pressed : null]}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleConfirm}
                    style={({ pressed }) => [styles.lockButtonWrap, pressed ? styles.pressed : null]}
                  >
                    <LinearGradient
                      colors={[resolvedColors.primary, '#0F62B8', '#D8C08C']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.lockButton}
                    >
                      <ShieldCheck size={18} color="#FFFFFF" strokeWidth={2.6} />
                      <Text style={styles.lockText}>Lock It In</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.lockedState}>
                  <ShieldCheck size={18} color="#DAEEFB" strokeWidth={2.6} />
                  <Text style={styles.lockedText}>{showSuccess ? 'Locked In' : 'Locking Pick'}</Text>
                </View>
              )}
            </LinearGradient>
          </LinearGradient>
        </Animated.View>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  cardBorder: {
    borderRadius: 30,
    padding: 1.4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.55,
    shadowRadius: 36,
    elevation: 30,
  },
  card: {
    borderRadius: 29,
    padding: 20,
    paddingBottom: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.10)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  eyebrowPill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: 'rgba(218,238,251,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.12)',
  },
  eyebrowText: {
    fontSize: 11,
    fontWeight: '900',
    color: 'rgba(218,238,251,0.84)',
    letterSpacing: 0,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.10)',
  },
  jerseyStage: {
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
    marginBottom: 10,
  },
  luxeHalo: {
    position: 'absolute',
    width: 174,
    height: 104,
    borderRadius: 52,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.018)',
    transform: [{ rotate: '-12deg' }],
  },
  haloTick: {
    position: 'absolute',
    width: 36,
    height: 2,
    borderRadius: 1,
  },
  haloTickTop: {
    top: 7,
    right: 20,
  },
  haloTickBottom: {
    bottom: 7,
    left: 20,
  },
  luxePlinth: {
    position: 'absolute',
    width: 214,
    height: 86,
    borderRadius: 43,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(216,192,140,0.16)',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  luxeSweep: {
    position: 'absolute',
    top: -42,
    bottom: -42,
    width: 42,
  },
  stageLine: {
    position: 'absolute',
    height: 1,
    width: 174,
    opacity: 0.72,
  },
  stageLineTop: {
    top: 31,
    transform: [{ rotate: '-5deg' }],
  },
  stageLineBottom: {
    bottom: 24,
    transform: [{ rotate: '5deg' }],
  },
  successBadge: {
    position: 'absolute',
    right: 95,
    bottom: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DAEEFB',
    borderWidth: 3,
    borderColor: '#091018',
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    color: 'rgba(218,238,251,0.72)',
    textAlign: 'center',
    letterSpacing: 0,
    marginBottom: 5,
  },
  teamName: {
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0,
  },
  recordPill: {
    alignSelf: 'center',
    minHeight: 26,
    justifyContent: 'center',
    marginTop: 10,
    paddingHorizontal: 13,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.10)',
  },
  recordText: {
    color: 'rgba(226,240,249,0.62)',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  body: {
    marginTop: 13,
    marginBottom: 22,
    color: 'rgba(226,240,249,0.58)',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0,
  },
  actionsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    height: 56,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.085)',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.16)',
  },
  cancelText: {
    color: 'rgba(226,240,249,0.82)',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lockButtonWrap: {
    flex: 1.18,
    height: 56,
    borderRadius: 17,
    overflow: 'hidden',
    shadowColor: '#D8C08C',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
  },
  lockButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  lockText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lockedState: {
    height: 56,
    borderRadius: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(122,157,184,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.16)',
  },
  lockedText: {
    color: '#DAEEFB',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
});
