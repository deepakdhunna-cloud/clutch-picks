import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Camera, Pencil } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api/api';
import { syncSubscriberInfo } from '@/lib/revenuecatClient';
import { FeedbackModal } from '@/components/FeedbackModal';
import { PhotoSourceModal } from '@/components/PhotoSourceModal';
import { ProfileAvatarImage } from '@/components/ProfileAvatarImage';
import { useProfilePhotoUpload } from '@/hooks/useProfilePhotoUpload';
import { guardedRouterReplace } from '@/lib/navigation-guard';

const BG = '#040608';
const CORAL = '#8B0A1F';
const TEAL = '#7A9DB8';

const LEAGUES = [
  { id: 'NBA', name: 'NBA' },
  { id: 'NFL', name: 'NFL' },
  { id: 'MLB', name: 'MLB' },
  { id: 'NHL', name: 'NHL' },
  { id: 'IPL', name: 'Cricket' },
  { id: 'TENNIS', name: 'Tennis' },
  { id: 'MLS', name: 'MLS' },
  { id: 'EPL', name: 'EPL' },
  { id: 'UCL', name: 'Champions League' },
  { id: 'WORLDCUP', name: 'World Cup' },
  { id: 'NCAAF', name: 'CFB' },
  { id: 'NCAAB', name: 'CBB' },
];

interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  bio: string | null;
}

export default function ProfileSetupScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; message: string; variant?: 'success' | 'error' | 'info' } | null>(null);
  const saveInFlightRef = useRef(false);

  const hasDisplayName = displayName.trim().length > 0;

  const profilePhotoUpload = useProfilePhotoUpload({
    onUploaded: (imageUrl) => setProfileImage(imageUrl),
    onFeedback: setFeedback,
  });

  const isUploading = profilePhotoUpload.isBusy;

  const handlePhotoPress = () => {
    if (isUploading) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    profilePhotoUpload.openPhotoSource();
  };

  const toggleLeague = (leagueId: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedLeagues((prev) =>
      prev.includes(leagueId)
        ? prev.filter((id) => id !== leagueId)
        : [...prev, leagueId]
    );
  };

  const handleContinue = async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setIsSaving(true);

    try {
      // Save display name if entered
      if (hasDisplayName) {
        const name = displayName.trim();
        await api.put<UserProfile>('/api/profile', { name });
        await syncSubscriberInfo({ displayName: name });
      }

      // Save selected leagues to AsyncStorage
      if (selectedLeagues.length > 0) {
        await AsyncStorage.setItem('clutch_favorite_leagues', JSON.stringify(selectedLeagues));
      }

      // Mark onboarding complete
      await AsyncStorage.setItem('clutch_onboarding_complete', 'true');

      // Navigate to home
      guardedRouterReplace(router, '/(tabs)');
    } catch {
      setFeedback({
        title: 'Profile Not Saved',
        message: 'Please check your connection and try again before continuing.',
        variant: 'error',
      });
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <PhotoSourceModal
          visible={profilePhotoUpload.photoSourceVisible}
          title="Profile Photo"
          onTakePhoto={profilePhotoUpload.takePhoto}
          onChooseLibrary={profilePhotoUpload.chooseLibrary}
          onCancel={profilePhotoUpload.closePhotoSource}
        />
        <FeedbackModal
          visible={!!feedback}
          title={feedback?.title ?? ''}
          message={feedback?.message ?? ''}
          variant={feedback?.variant}
          onDismiss={() => setFeedback(null)}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Header */}
          <Animated.View
            entering={FadeInDown.delay(0).duration(500)}
            style={{ alignItems: 'center', paddingTop: 36, marginBottom: 30 }}
          >
            <Text
              style={{
                color: '#FFFFFF',
                fontSize: 24,
                fontWeight: '900',
                marginBottom: 8,
              }}
            >
              Set Up Your Profile
            </Text>
            <Text
              style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: 14,
              }}
            >
              This is how other users will see you
            </Text>
          </Animated.View>

          {/* Profile Photo */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(500)}
            style={{ alignItems: 'center', marginBottom: 28 }}
          >
            <Pressable
              onPress={handlePhotoPress}
              disabled={isUploading}
              accessibilityRole="button"
              accessibilityLabel={profileImage ? "Change profile photo" : "Add profile photo"}
              accessibilityState={{ disabled: isUploading, busy: isUploading }}
              hitSlop={8}
            >
              <View
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 50,
                  backgroundColor: '#0A0E12',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {isUploading ? (
                  <View style={{ alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="large" color={TEAL} />
                    {profilePhotoUpload.uploadProgressLabel ? (
                      <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: '700' }}>
                        {profilePhotoUpload.uploadProgressLabel}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <>
                    <ProfileAvatarImage
                      uri={profileImage}
                      style={{ width: 100, height: 100, borderRadius: 50 }}
                    >
                      <Camera size={32} color={TEAL} />
                    </ProfileAvatarImage>
                    {/* Edit pencil overlay */}
                    {profileImage ? (
                      <View
                        style={{
                          position: 'absolute',
                          bottom: 4,
                          right: 4,
                          width: 28,
                          height: 28,
                          borderRadius: 14,
                          backgroundColor: CORAL,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 2,
                          borderColor: BG,
                        }}
                      >
                        <Pencil size={14} color="#FFFFFF" />
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            </Pressable>
            {!profileImage && (
              <Pressable
                onPress={handlePhotoPress}
                disabled={isUploading}
                accessibilityRole="button"
                accessibilityLabel="Add profile photo"
                accessibilityState={{ disabled: isUploading, busy: isUploading }}
                style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text
                  style={{
                    color: TEAL,
                    fontSize: 12,
                    fontWeight: '600',
                    marginTop: 12,
                  }}
                >
                  Add Photo
                </Text>
              </Pressable>
            )}
          </Animated.View>

          {/* Display Name */}
          <Animated.View
            entering={FadeInDown.delay(200).duration(500)}
            style={{ marginBottom: 28 }}
          >
            <Text
              style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 2,
                marginBottom: 10,
              }}
            >
              DISPLAY NAME
            </Text>
            <View
              style={{
                backgroundColor: 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
                borderRadius: 14,
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 16,
                height: 54,
              }}
            >
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                accessibilityLabel="Display name"
                placeholder="Enter your name"
                placeholderTextColor="rgba(255,255,255,0.25)"
                maxLength={20}
                style={{
                  flex: 1,
                  color: '#FFFFFF',
                  fontSize: 16,
                }}
                autoCapitalize="words"
                returnKeyType="done"
              />
              <Text
                style={{
                  color: 'rgba(255,255,255,0.2)',
                  fontSize: 12,
                }}
              >
                {displayName.length}/20
              </Text>
            </View>
          </Animated.View>

          {/* Favorite Leagues */}
          <Animated.View
            entering={FadeInDown.delay(300).duration(500)}
          >
            <Text
              style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: 10,
                fontWeight: '800',
                letterSpacing: 2,
                marginBottom: 4,
              }}
            >
              PICK YOUR LEAGUES
            </Text>
            <Text
              style={{
                color: 'rgba(255,255,255,0.2)',
                fontSize: 11,
                marginBottom: 16,
              }}
            >
              Optional — helps personalize your feed
            </Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {LEAGUES.map((league) => {
                const isSelected = selectedLeagues.includes(league.id);
                return (
                  <Pressable
                    key={league.id}
                    onPress={() => toggleLeague(league.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Toggle ${league.name}`}
                    accessibilityState={{ selected: isSelected }}
                    style={{
                      width: '30.6%',
                      minHeight: 48,
                      backgroundColor: isSelected
                        ? 'rgba(139,10,31,0.12)'
                        : 'rgba(255,255,255,0.04)',
                      borderWidth: 1,
                      borderColor: isSelected
                        ? 'rgba(139,10,31,0.3)'
                        : 'rgba(255,255,255,0.08)',
                      borderRadius: 12,
                      padding: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        color: isSelected ? CORAL : 'rgba(255,255,255,0.4)',
                        fontSize: 13,
                        fontWeight: '800',
                        textAlign: 'center',
                      }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {league.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        </ScrollView>

        {/* Continue Button - Fixed at bottom */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(500)}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingHorizontal: 20,
            paddingBottom: 34,
            paddingTop: 16,
            backgroundColor: BG,
          }}
        >
          <SafeAreaView edges={['bottom']} style={{ paddingBottom: 0 }}>
            <Pressable
              onPress={handleContinue}
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel={hasDisplayName ? "Let's Go" : "Skip for Now"}
              accessibilityState={{ disabled: isSaving, busy: isSaving }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              {hasDisplayName ? (
                <LinearGradient
                  colors={[CORAL, '#6A0818']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    height: 56,
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text
                      style={{
                        color: '#FFFFFF',
                        fontSize: 16,
                        fontWeight: '800',
                      }}
                    >
                      Let's Go
                    </Text>
                  )}
                </LinearGradient>
              ) : (
                <View
                  style={{
                    height: 56,
                    borderRadius: 16,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color="rgba(255,255,255,0.4)" />
                  ) : (
                    <Text
                      style={{
                        color: 'rgba(255,255,255,0.4)',
                        fontSize: 16,
                        fontWeight: '800',
                      }}
                    >
                      Skip for Now
                    </Text>
                  )}
                </View>
              )}
            </Pressable>
          </SafeAreaView>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}
