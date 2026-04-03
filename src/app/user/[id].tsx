import { View, Text, Pressable, ScrollView, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { User, ArrowLeft, Lock, UserPlus, UserMinus, Trophy, Target, Flame, CheckCircle2, XCircle, Activity } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/lib/auth/use-session';
import { useUserProfile, useIsFollowing, useFollowUser, useUnfollowUser, useUserPickStats } from '@/hooks/useSocial';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import * as Haptics from 'expo-haptics';

const GLASS_BG = 'rgba(4,5,10,0.97)';
const GLASS_BORDER = 'rgba(255,255,255,0.13)';
const AMBER = '#8B0A1F';
const TEAL = '#7A9DB8';
const WIN_COLOR = '#7A9DB8';
const LOSS_COLOR = '#EF4444';

interface Pick {
  id: string;
  homeTeam?: string;
  awayTeam?: string;
  pickedTeam?: string;
  result?: string;
  sport?: string;
}

function PublicPickItem({ pick, index }: { pick: Pick; index: number }) {
  const isWin = pick.result === 'win';
  const isLoss = pick.result === 'loss';
  const isPending = !pick.result || pick.result === 'pending';
  const resultColor = isWin ? WIN_COLOR : isLoss ? LOSS_COLOR : '#6B7280';

  return (
    <Animated.View entering={FadeInDown.delay(400 + index * 50).duration(400)}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: GLASS_BG,
          borderRadius: 12,
          marginBottom: 8,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: GLASS_BORDER,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.35,
          shadowRadius: 6,
        }}
      >
        <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: resultColor }} />
        <LinearGradient
          colors={['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.01)', 'transparent']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 3, right: 0, height: '55%' }}
        />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, paddingLeft: 12 }}>
          <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.07)', marginRight: 10 }}>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: '800' }}>{pick.sport || 'PICK'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600' }}>
              {pick.awayTeam && pick.homeTeam ? `${pick.awayTeam} @ ${pick.homeTeam}` : 'Game Pick'}
            </Text>
            {pick.pickedTeam ? (
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
                Picked: <Text style={{ color: resultColor, fontWeight: '700' }}>{pick.pickedTeam === 'home' ? (pick.homeTeam ?? pick.pickedTeam) : (pick.awayTeam ?? pick.pickedTeam)}</Text>
              </Text>
            ) : null}
          </View>
          <View
            style={{
              width: 26, height: 26, borderRadius: 13,
              backgroundColor: isPending ? 'rgba(107,114,128,0.15)' : isWin ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            {isPending ? <Activity size={13} color="#6B7280" /> : isWin ? <CheckCircle2 size={15} color={WIN_COLOR} /> : <XCircle size={15} color={LOSS_COLOR} />}
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

export default function UserProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const { data: profile, isLoading: profileLoading } = useUserProfile(id);
  const { data: isFollowing, isLoading: isFollowingLoading } = useIsFollowing(id);
  const { data: pickStats } = useUserPickStats(id);
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();

  const isOwnProfile = currentUserId === id;
  const canViewContent = !profile?.isPrivate || isFollowing || isOwnProfile;
  const isFollowLoading = followMutation.isPending || unfollowMutation.isPending;

  // Fetch public picks
  const { data: publicPicks } = useQuery({
    queryKey: ['user-picks', id],
    queryFn: () => api.get<Pick[]>(`/api/picks/user/${id}`),
    enabled: !!id && canViewContent,
  });

  const handleFollowToggle = () => {
    if (!id) return;
    if (isFollowing) { unfollowMutation.mutate(id); } else { followMutation.mutate(id); }
  };

  const handleNavigateToFollowers = () => { router.push(`/followers/${id}?tab=followers` as any); };
  const handleNavigateToFollowing = () => { router.push(`/followers/${id}?tab=following` as any); };

  if (profileLoading || isFollowingLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={TEAL} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <SafeAreaView edges={['top']}>
          <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
            <Pressable
              onPress={() => router.back()}
              style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: GLASS_BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GLASS_BORDER }}
            >
              <ArrowLeft size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <User size={56} color="rgba(255,255,255,0.15)" />
          <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginTop: 16 }}>User Not Found</Text>
          <Text style={{ color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 8 }}>
            This user does not exist or has been removed.
          </Text>
        </View>
      </View>
    );
  }

  const displayInitials = (profile.name || 'U').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#000000' }}>
        <Animated.View entering={FadeInDown.duration(350)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 }}>
            <Pressable
              onPress={() => router.back()}
              style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: GLASS_BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: GLASS_BORDER, marginRight: 12 }}
            >
              <ArrowLeft size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
            <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: -0.5 }}>Profile</Text>
          </View>
        </Animated.View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        {/* Hero Card */}
        <Animated.View entering={FadeInDown.delay(80).duration(500)} style={{ paddingHorizontal: 16, marginTop: 4 }}>
          <View
            style={{
              borderRadius: 22,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: GLASS_BORDER,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.6,
              shadowRadius: 22,
              elevation: 18,
            }}
          >
            <LinearGradient
              colors={[GLASS_BG, 'rgba(6,8,14,0.98)', 'rgba(2,3,6,1)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <LinearGradient
              colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.025)', 'transparent']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '48%' }}
            />

            <View style={{ padding: 20 }}>
              {/* Avatar row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <View
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    backgroundColor: 'rgba(20,21,28,1)',
                    borderWidth: 2,
                    borderColor: 'rgba(78,205,196,0.15)',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {profile.image ? (
                    <Image source={{ uri: profile.image }} style={{ width: 80, height: 80, borderRadius: 40 }} />
                  ) : (
                    <Text style={{ color: '#FFFFFF', fontSize: 26, fontWeight: '800' }}>{displayInitials}</Text>
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 }}>{profile.name || 'Clutch User'}</Text>
                  {profile.bio ? (
                    <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 4, lineHeight: 18 }} numberOfLines={2}>{profile.bio}</Text>
                  ) : null}
                  {profile.isPrivate ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 5 }}>
                      <Lock size={12} color="rgba(255,255,255,0.35)" />
                      <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>Private Account</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Follower stats */}
              <View style={{ flexDirection: 'row', marginTop: 18, alignItems: 'center' }}>
                <Pressable onPress={handleNavigateToFollowers} style={{ alignItems: 'center', paddingRight: 24 }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{profile.followersCount ?? 0}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, marginTop: 1, fontWeight: '500' }}>Followers</Text>
                </Pressable>
                <View style={{ width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.09)' }} />
                <Pressable onPress={handleNavigateToFollowing} style={{ alignItems: 'center', paddingHorizontal: 24 }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{profile.followingCount ?? 0}</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.38)', fontSize: 11, marginTop: 1, fontWeight: '500' }}>Following</Text>
                </Pressable>
              </View>

              {/* Action buttons */}
              {!isOwnProfile ? (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                  <Pressable
                    onPress={handleFollowToggle}
                    disabled={isFollowLoading}
                    style={{
                      flex: 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 10,
                      borderRadius: 11,
                      backgroundColor: isFollowing ? 'rgba(255,255,255,0.06)' : AMBER,
                      borderWidth: 1,
                      borderColor: isFollowing ? 'rgba(255,255,255,0.14)' : 'rgba(139,10,31,0.5)',
                      gap: 6,
                    }}
                  >
                    {isFollowLoading ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        {isFollowing ? <UserMinus size={14} color="rgba(255,255,255,0.7)" /> : <UserPlus size={14} color="#FFFFFF" />}
                        <Text style={{ color: isFollowing ? 'rgba(255,255,255,0.7)' : '#FFFFFF', fontSize: 13, fontWeight: '700' }}>
                          {isFollowing ? 'Unfollow' : 'Follow'}
                        </Text>
                      </>
                    )}
                  </Pressable>


                </View>
              ) : null}
            </View>
          </View>
        </Animated.View>

        {/* Content */}
        {canViewContent ? (
          <>
            {/* Stats */}
            <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ paddingHorizontal: 16, marginTop: 16 }}>
              <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 }}>STATS</Text>
              <View
                style={{
                  backgroundColor: GLASS_BG,
                  borderRadius: 16,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: GLASS_BORDER,
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.4,
                  shadowRadius: 10,
                }}
              >
                <LinearGradient
                  colors={['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.01)', 'transparent']}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '50%' }}
                />
                <View style={{ flexDirection: 'row', padding: 16 }}>
                  {/* Picks */}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                      <Target size={20} color="rgba(255,255,255,0.5)" />
                    </View>
                    <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{pickStats?.picksMade ?? 0}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>Picks</Text>
                  </View>
                  {/* Win Rate */}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(34,197,94,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                      <Trophy size={20} color={WIN_COLOR} />
                    </View>
                    <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{Math.round(pickStats?.winRate ?? 0)}%</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>Win Rate</Text>
                  </View>
                  {/* Streak */}
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(139,10,31,0.1)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                      <Flame size={20} color={AMBER} />
                    </View>
                    <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>{pickStats?.currentStreak ?? 0}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>Streak</Text>
                  </View>
                </View>
                {/* W-L record */}
                <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: WIN_COLOR }} />
                    <Text style={{ color: WIN_COLOR, fontSize: 18, fontWeight: '800' }}>{pickStats?.wins ?? 0}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Wins</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: LOSS_COLOR }} />
                    <Text style={{ color: LOSS_COLOR, fontSize: 18, fontWeight: '800' }}>{pickStats?.losses ?? 0}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Losses</Text>
                  </View>
                </View>
              </View>
            </Animated.View>

            {/* Recent Picks */}
            {publicPicks && publicPicks.length > 0 ? (
              <Animated.View entering={FadeInDown.delay(320).duration(500)} style={{ paddingHorizontal: 16, marginTop: 20 }}>
                <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 }}>RECENT PICKS</Text>
                {publicPicks.slice(0, 5).map((pick: Pick, index: number) => (
                  <PublicPickItem key={pick.id} pick={pick} index={index} />
                ))}
              </Animated.View>
            ) : null}
          </>
        ) : (
          /* Private */
          <Animated.View entering={FadeInDown.delay(200).duration(500)} style={{ paddingHorizontal: 16, marginTop: 24 }}>
            <View
              style={{
                backgroundColor: GLASS_BG,
                borderRadius: 18,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: GLASS_BORDER,
                alignItems: 'center',
                paddingVertical: 48,
                paddingHorizontal: 24,
              }}
            >
              <LinearGradient
                colors={['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.01)', 'transparent']}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '45%' }}
              />
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Lock size={28} color="rgba(255,255,255,0.3)" />
              </View>
              <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>This Profile is Private</Text>
              <Text style={{ color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
                Follow this user to see their picks and stats.
              </Text>
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}
