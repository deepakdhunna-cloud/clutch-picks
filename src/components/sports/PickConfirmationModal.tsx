import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
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
  const { width, height } = useWindowDimensions();
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cardScale = useSharedValue(0.96);
  const cardOpacity = useSharedValue(0);
  const jerseyScale = useSharedValue(1);
  const sweepProgress = useSharedValue(0);
  const stagePulse = useSharedValue(0);
  const successScale = useSharedValue(0);

  const resolvedColors = useMemo<TeamColors>(() => {
    if (teamColors) return teamColors;
    if (!team) return { primary: '#7A9DB8', secondary: '#0C1018' };
    return getTeamColors(team.abbreviation, sport, team.color ?? teamColor ?? undefined);
  }, [sport, team, teamColor, teamColors]);

  useEffect(() => {
    if (visible) {
      cardOpacity.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.ease) });
      cardScale.value = withSpring(1, { damping: 19, stiffness: 210 });
      jerseyScale.value = withSequence(
        withTiming(1.06, { duration: 210, easing: Easing.out(Easing.cubic) }),
        withSpring(1, { damping: 13, stiffness: 210 })
      );
      sweepProgress.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 500, easing: Easing.out(Easing.ease) })
        ),
        -1,
        false
      );
      stagePulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1250, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 1250, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      successScale.value = 0;
      setIsConfirming(false);
      setShowSuccess(false);
      setErrorMessage(null);
    } else {
      // Cancel the infinite loops before zeroing — otherwise the repeat stays
      // scheduled and would keep ticking if the modal is ever kept mounted
      // (visible={false}) instead of unmounted.
      cancelAnimation(sweepProgress);
      cancelAnimation(stagePulse);
      cardOpacity.value = 0;
      cardScale.value = 0.96;
      jerseyScale.value = 1;
      sweepProgress.value = 0;
      stagePulse.value = 0;
      successScale.value = 0;
    }
    return () => {
      cancelAnimation(sweepProgress);
      cancelAnimation(stagePulse);
    };
  }, [visible, cardOpacity, cardScale, jerseyScale, stagePulse, successScale, sweepProgress]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [
      { scale: cardScale.value },
      { translateY: interpolate(cardScale.value, [0.96, 1], [10, 0]) },
    ],
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sweepProgress.value, [0, 0.48, 1], [0, 0.34, 0]),
    transform: [
      { translateX: interpolate(sweepProgress.value, [0, 1], [-58, 206]) },
      { rotate: '-10deg' },
    ],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(stagePulse.value, [0, 1], [0.42, 0.82]),
    transform: [{ scale: interpolate(stagePulse.value, [0, 1], [0.96, 1.04]) }],
  }));

  const jerseyStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: jerseyScale.value },
      { translateY: isConfirming ? -3 : interpolate(jerseyScale.value, [1, 1.08], [0, -3]) },
    ],
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

  const cardWidth = Math.min(width - 44, 340);
  const isCompactHeight = height < 760;
  const jerseySize = isCompactHeight ? 82 : 94;
  const isRemoving = action === 'remove';
  const titleText = showSuccess
    ? isRemoving ? 'Pick Unselected' : 'Pick Selected'
    : errorMessage
      ? 'Pick Not Saved'
      : isRemoving
        ? 'Unselect this pick?'
        : 'Select this pick?';
  const bodyText = showSuccess
    ? isRemoving ? 'Cleared from your board.' : 'Saved to your board.'
    : errorMessage ?? (isRemoving
      ? 'This clears this jersey from your board. You can choose again before the game starts.'
      : isChanging
      ? 'This selects this jersey and updates your board for the game.'
      : 'This saves this jersey to your board so you can track it through the game.');
  const primaryLabel = errorMessage ? 'Try Again' : isRemoving ? 'Unselect Pick' : 'Select Pick';
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
        <Pressable
          accessible={false}
          accessibilityRole="button"
          accessibilityLabel="Dismiss pick confirmation"
          accessibilityState={{ disabled: isConfirming }}
          disabled={isConfirming}
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
        />

        <Animated.View accessibilityViewIsModal style={[cardStyle, { width: cardWidth }]}>
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
              style={[styles.card, isCompactHeight ? styles.cardCompact : null]}
            >
              <View style={styles.topRow}>
                <View style={styles.eyebrowPill}>
                  <Sparkles size={12} color="rgba(218,238,251,0.88)" strokeWidth={2.3} />
                  <Text style={styles.eyebrowText}>Pick Moment</Text>
                </View>
                <Pressable
                  onPress={onCancel}
                  disabled={isConfirming}
                  accessibilityRole="button"
                  accessibilityLabel="Close pick confirmation"
                  accessibilityState={{ disabled: isConfirming }}
                  hitSlop={10}
                  style={({ pressed }) => [styles.closeButton, pressed && !isConfirming ? styles.pressed : null]}
                >
                  <X size={18} color="rgba(226,240,249,0.78)" strokeWidth={2.8} />
                </Pressable>
              </View>

              <View style={[styles.jerseyStage, isCompactHeight ? styles.jerseyStageCompact : null]}>
                <Animated.View style={[styles.luxeHalo, haloStyle, { borderColor: `${resolvedColors.primary}46`, backgroundColor: `${resolvedColors.primary}10` }]} />
                <View style={[styles.luxePlinth, { borderColor: `${resolvedColors.primary}22` }]}>
                  <LinearGradient
                    colors={['rgba(216,192,140,0.10)', `${resolvedColors.primary}24`, 'rgba(218,238,251,0.07)']}
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
                <Animated.View style={jerseyStyle}>
                  <JerseyIcon
                    teamCode={team.abbreviation}
                    teamName={team.name}
                    primaryColor={resolvedColors.primary}
                    secondaryColor={resolvedColors.secondary}
                    size={jerseySize}
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

              {!isConfirming ? (
                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={handleConfirm}
                    accessibilityRole="button"
                    accessibilityLabel={primaryLabel}
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
    paddingHorizontal: 22,
    paddingVertical: 28,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  cardBorder: {
    borderRadius: 26,
    padding: 1.4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.55,
    shadowRadius: 36,
    elevation: 30,
  },
  card: {
    borderRadius: 25,
    padding: 17,
    paddingBottom: 17,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.10)',
  },
  cardCompact: {
    padding: 15,
    paddingBottom: 15,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.10)',
  },
  jerseyStage: {
    height: 118,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    marginBottom: 8,
  },
  jerseyStageCompact: {
    height: 104,
    marginBottom: 5,
  },
  luxeHalo: {
    position: 'absolute',
    width: 134,
    height: 134,
    borderRadius: 67,
    borderWidth: 1,
  },
  luxePlinth: {
    position: 'absolute',
    bottom: 14,
    width: 184,
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  luxeSweep: {
    position: 'absolute',
    top: -26,
    bottom: -26,
    width: 36,
  },
  successBadge: {
    position: 'absolute',
    left: '50%',
    bottom: 9,
    marginLeft: 26,
    width: 32,
    height: 32,
    borderRadius: 16,
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
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    color: 'rgba(218,238,251,0.76)',
    textAlign: 'center',
    letterSpacing: 0,
    marginBottom: 5,
  },
  teamName: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0,
  },
  recordPill: {
    alignSelf: 'center',
    minHeight: 24,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(226,240,249,0.10)',
  },
  recordText: {
    color: 'rgba(226,240,249,0.62)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  body: {
    marginTop: 11,
    marginBottom: 0,
    color: 'rgba(226,240,249,0.58)',
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0,
  },
  errorBody: {
    color: '#FCA5A5',
  },
  actionsRow: {
    width: '100%',
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  lockButtonWrap: {
    alignSelf: 'center',
    width: '72%',
    minWidth: 216,
    maxWidth: 280,
    height: 58,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#8B0A1F',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.34,
    shadowRadius: 18,
  },
  lockButton: {
    height: 58,
    paddingHorizontal: 13,
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
    gap: 8,
  },
  lockText: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lockedState: {
    height: 52,
    borderRadius: 16,
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
