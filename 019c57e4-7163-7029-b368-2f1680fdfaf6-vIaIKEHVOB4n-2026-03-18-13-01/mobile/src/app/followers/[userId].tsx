import { View, Text, Pressable, FlatList, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, User, UserPlus, UserMinus } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useState, useEffect } from 'react';
import { useSession } from '@/lib/auth/use-session';
import {
  useFollowers,
  useFollowing,
  useFollowUser,
  useUnfollowUser,
  useIsFollowing,
  SocialUser,
} from '@/hooks/useSocial';
import { theme } from '@/lib/theme';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';

type TabType = 'followers' | 'following';

interface UserItemProps {
  user: SocialUser;
  currentUserId: string | undefined;
  onNavigateToProfile: (userId: string) => void;
}

function UserItem({ user, currentUserId, onNavigateToProfile }: UserItemProps) {
  const isOwnProfile = currentUserId === user.id;
  const { data: isFollowing, isLoading: isFollowingLoading } = useIsFollowing(
    isOwnProfile ? undefined : user.id
  );
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();

  const isFollowLoading = followMutation.isPending || unfollowMutation.isPending || isFollowingLoading;

  const handleFollowToggle = () => {
    if (isFollowing) {
      unfollowMutation.mutate(user.id);
    } else {
      followMutation.mutate(user.id);
    }
  };

  return (
    <Pressable
      onPress={() => onNavigateToProfile(user.id)}
      className="active:opacity-80"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255, 255, 255, 0.05)',
      }}
    >
      {/* Avatar */}
      <View
        style={{
          width: 50,
          height: 50,
          borderRadius: 25,
          overflow: 'hidden',
          borderWidth: 2,
          borderColor: theme.colors.primary,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {user.image ? (
          <Image
            source={{ uri: user.image }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <User size={24} color="#FFFFFF" />
        )}
      </View>

      {/* User Info */}
      <View className="flex-1 ml-3">
        <Text className="text-white font-semibold text-base">
          {user.name || 'User'}
        </Text>
        {user.bio ? (
          <Text className="text-zinc-500 text-sm mt-0.5" numberOfLines={1}>
            {user.bio}
          </Text>
        ) : null}
      </View>

      {/* Follow Button */}
      {!isOwnProfile ? (
        <Pressable
          onPress={handleFollowToggle}
          disabled={isFollowLoading}
          className="active:opacity-80"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: isFollowing
              ? 'rgba(255, 255, 255, 0.1)'
              : theme.colors.primary,
            borderWidth: isFollowing ? 1 : 0,
            borderColor: 'rgba(255, 255, 255, 0.2)',
            minWidth: 90,
          }}
        >
          {isFollowLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              {isFollowing ? (
                <UserMinus size={14} color="#FFFFFF" />
              ) : (
                <UserPlus size={14} color="#FFFFFF" />
              )}
              <Text className="text-white font-medium text-sm ml-1">
                {isFollowing ? 'Unfollow' : 'Follow'}
              </Text>
            </>
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export default function FollowersScreen() {
  const router = useRouter();
  const { userId, tab } = useLocalSearchParams<{ userId: string; tab?: string }>();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;

  const [activeTab, setActiveTab] = useState<TabType>((tab as TabType) || 'followers');

  // Update tab when URL param changes
  useEffect(() => {
    if (tab && (tab === 'followers' || tab === 'following')) {
      setActiveTab(tab);
    }
  }, [tab]);

  const { data: followers, isLoading: followersLoading } = useFollowers(userId);
  const { data: following, isLoading: followingLoading } = useFollowing(userId);

  // Fetch user name for header
  const { data: profile } = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => api.get<{ name: string }>(`/api/profile/${userId}`),
    enabled: !!userId,
  });

  const isLoading = activeTab === 'followers' ? followersLoading : followingLoading;
  const data = activeTab === 'followers' ? followers : following;

  const handleNavigateToProfile = (id: string) => {
    if (id === currentUserId) {
      router.push('/(tabs)/profile' as any);
    } else {
      router.push(`/user/${id}` as any);
    }
  };

  const renderEmptyState = () => (
    <View className="flex-1 items-center justify-center py-20">
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <User size={32} color={theme.colors.text.muted} />
      </View>
      <Text className="text-white text-lg font-semibold">
        {activeTab === 'followers' ? 'No Followers Yet' : 'Not Following Anyone'}
      </Text>
      <Text className="text-zinc-500 text-center mt-2 px-8">
        {activeTab === 'followers'
          ? 'When people follow this account, they will appear here.'
          : 'When this account follows people, they will appear here.'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-[#0A1628]" edges={['top']}>
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        className="px-5 pt-4 pb-3 flex-row items-center"
      >
        <Pressable
          onPress={() => router.back()}
          className="active:opacity-70"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ArrowLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text className="text-white text-xl font-bold ml-4" numberOfLines={1}>
          {profile?.name || 'User'}
        </Text>
      </Animated.View>

      {/* Tab Bar */}
      <Animated.View
        entering={FadeInDown.delay(100).duration(400)}
        className="px-5 pb-4"
      >
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: 12,
            padding: 4,
          }}
        >
          <Pressable
            onPress={() => setActiveTab('followers')}
            className="flex-1"
            style={{
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor:
                activeTab === 'followers' ? theme.colors.primary : 'transparent',
            }}
          >
            <Text
              className="text-center font-semibold"
              style={{
                color:
                  activeTab === 'followers' ? '#FFFFFF' : theme.colors.text.muted,
              }}
            >
              Followers
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('following')}
            className="flex-1"
            style={{
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor:
                activeTab === 'following' ? theme.colors.primary : 'transparent',
            }}
          >
            <Text
              className="text-center font-semibold"
              style={{
                color:
                  activeTab === 'following' ? '#FFFFFF' : theme.colors.text.muted,
              }}
            >
              Following
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      {/* List */}
      <View
        className="flex-1 mx-5"
        style={{
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.1)',
        }}
      >
        <BlurView intensity={10} tint="dark" style={{ flex: 1 }}>
          <LinearGradient
            colors={[theme.colors.surface, theme.colors.background]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />

          {isLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <FlatList
              data={data || []}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <UserItem
                  user={item}
                  currentUserId={currentUserId}
                  onNavigateToProfile={handleNavigateToProfile}
                />
              )}
              ListEmptyComponent={renderEmptyState}
              contentContainerStyle={{
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </BlurView>
      </View>

      {/* Bottom Spacer */}
      <View style={{ height: 20 }} />
    </SafeAreaView>
  );
}
