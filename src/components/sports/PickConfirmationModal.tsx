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
  action?: 'pick' | 'remove';
  onConfirm: () => Promise<boolean | void> | boolean | void;
  onCancel: () => void;
};

export const PickConfirmationModal = memo(function PickConfirmationModal({
  visible,
  team,
  teamColors,
  teamColor,
  sport,
  isChanging = false,
  action = 'pick',
  onConfirm,
  onCancel,
}: PickConfirmationModalProps) {
  const { width } = useWindowDimensions();
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
      setErrorMessage(null);
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

  const handleConfirm = useCallback(async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    setShowSuccess(false);
    setErrorMessage(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    jerseyScale.value = withSequence(
      withTiming(1.12, { duration: 260, easing: Easing.out(Easing.ease) }),
      withSpring(1, { damping: 12, stiffness: 180 })
    );

    try {
      const [result] = await Promise.all([
        Promise.resolve(onConfirm()),
        new Promise((resolve) => setTimeout(resolve, 260)),
      ]);
      if (result === false) {
        throw new Error('Pick save failed');
      }
      setShowSuccess(true);
      successScale.value = withSpring(1, { damping: 12, stiffness: 180 });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        onCancel();
      }, 560);
    } catch {
      setIsConfirming(false);
      setShowSuccess(false);
      successScale.value = 0;
      setErrorMessage('Pick not saved. Check your connection and try again.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [isConfirming, jerseyScale, onCancel, onConfirm, successScale]);

  if (!team) return null;

  const cardWidth = Math.min(width - 38, 360);
  const isRemoving = action === 'remove';
  const titleText = showSuccess
    ? isRemoving ? 'Pick Removed' : 'Pick Locked'
    : errorMessage
      ? 'Pick Not Saved'
      : isRemoving
        ? 'Remove this pick?'
        : isChanging
        ? 'Switch your pick?'
        : 'Lock in your pick?';
  const bodyText = showSuccess
    ? isRemoving ? 'Cleared from your board.' : 'Saved to your board.'
    : errorMessage ?? (isRemoving
      ? 'This clears the pick from your board. You can choose again before the game starts.'
      : isChanging
      ? 'This replaces your current selection and keeps the game on your board.'
      : 'This saves the pick to your board so you can track it through the game.');
  const primaryLabel = errorMessage ? 'Try Again' : isRemoving ? 'Remove Pick' : isChanging ? 'Switch Pick' : 'Lock It In';
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

              <View style={styles.copyBlock}>
                <Text style={styles.title}>{titleText}</Text>
                <Text style={styles.teamName} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}>{team.name}</Text>
                <View style={styles.recordPill}>
                  <Text style={styles.recordText}>{recordText}</Text>
                </View>
                <Text style={[styles.body, errorMessage ? styles.errorBody : null]}>{bodyText}</Text>
              </View>

              {!showSuccess && !errorMessage ? (
                <View style={styles.promiseRow}>
                  <View style={styles.promiseChip}>
                    <Check size={13} color="rgba(218,238,251,0.84)" strokeWidth={3} />
                    <Text style={styles.promiseText}>{isRemoving ? 'Board clears' : 'Board save'}</Text>
                  </View>
                  <View style={styles.promiseChip}>
                    <Sparkles size={13} color="rgba(218,238,251,0.84)" strokeWidth={2.4} />
                    <Text style={styles.promiseText}>{isRemoving ? 'Pick again' : 'Track live'}</Text>
                  </View>
                </View>
              ) : null}

              {!isConfirming ? (
                <View style={[styles.actionsStack, !showSuccess && !errorMessage ? styles.actionsAfterPromise : null]}>
                  <Pressable
                    onPress={handleConfirm}
                    style={({ pressed }) => [styles.lockButtonWrap, pressed ? styles.pressed : null]}
                  >
                    <LinearGradient
                      colors={['#8B0A1F', resolvedColors.primary, '#7A9DB8']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.lockButton}
                    >
                      <View style={styles.lockContent}>
                        {isRemoving ? (
                          <X size={19} color="#FFFFFF" strokeWidth={2.8} />
                        ) : (
                          <ShieldCheck size={19} color="#FFFFFF" strokeWidth={2.8} />
                        )}
                        <Text style={styles.lockText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>{primaryLabel}</Text>
                      </View>
                    </LinearGradient>
                  </Pressable>
                  <Pressable
                    onPress={onCancel}
                    style={({ pressed }) => [styles.cancelButton, pressed ? styles.pressed : null]}
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.lockedState}>
                  {isRemoving ? (
                    <X size={18} color="#DAEEFB" strokeWidth={2.6} />
                  ) : (
                    <ShieldCheck size={18} color="#DAEEFB" strokeWidth={2.6} />
                  )}
                  <Text style={styles.lockedText}>{showSuccess ? (isRemoving ? 'Removed' : 'Locked In') : (isRemoving ? 'Removing Pick' : 'Saving Pick')}</Text>
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
    paddingBottom: 20,
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
    height: 138,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
    marginBottom: 12,
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
  copyBlock: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  title: {
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '900',
    color: 'rgba(218,238,251,0.76)',
    textAlign: 'center',
    letterSpacing: 0,
    marginBottom: 6,
  },
  teamName: {
    fontSize: 30,
    lineHeight: 35,
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
    marginBottom: 0,
    color: 'rgba(226,240,249,0.58)',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0,
  },
  errorBody: {
    color: '#FCA5A5',
  },
  promiseRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    marginBottom: 14,
  },
  promiseChip: {
    flex: 1,
    minHeight: 38,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(218,238,251,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(218,238,251,0.10)',
  },
  promiseText: {
    color: 'rgba(218,238,251,0.72)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  actionsStack: {
    width: '100%',
    gap: 10,
    marginTop: 18,
  },
  actionsAfterPromise: {
    marginTop: 0,
  },
  cancelButton: {
    width: '100%',
    minHeight: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.09)',
  },
  cancelText: {
    color: 'rgba(226,240,249,0.70)',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lockButtonWrap: {
    width: '100%',
    minHeight: 60,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#8B0A1F',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.34,
    shadowRadius: 18,
  },
  lockButton: {
    flex: 1,
    minHeight: 60,
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  lockContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  lockText: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 22,
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
