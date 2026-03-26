import { View, Text, Pressable, ScrollView, TextInput, Image, ActivityIndicator, Alert, ActionSheetIOS, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, User, Camera, Check, Lock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useSession, useInvalidateSession } from '@/lib/auth/use-session';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { pickImage, takePhoto } from '@/lib/file-picker';
import { uploadFile } from '@/lib/upload';
import { theme } from '@/lib/theme';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  bio: string | null;
  isPrivate?: boolean;
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const invalidateSession = useInvalidateSession();

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const user = session?.user;

  // Fetch profile data
  const { data: profileData, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<UserProfile>('/api/profile'),
    enabled: !!user,
  });

  // Initialize form values when profile data loads
  useEffect(() => {
    if (profileData) {
      setName(profileData.name || '');
      setBio(profileData.bio || '');
      setIsPrivate(profileData.isPrivate ?? false);
      setProfileImage(profileData.image);
    }
  }, [profileData]);

  // Mutation for updating profile
  const updateProfileMutation = useMutation({
    mutationFn: async (data: { name?: string; bio?: string; isPrivate?: boolean }) => {
      return api.put<UserProfile>('/api/profile', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      invalidateSession();
      router.back();
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    },
  });

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }
    updateProfileMutation.mutate({
      name: name.trim(),
      bio: bio.trim(),
      isPrivate,
    });
  };

  const handleImageUpload = async (pickedFile: { uri: string; filename: string; mimeType: string } | null) => {
    if (!pickedFile) return;

    setIsUploading(true);
    try {
      const uploadResult = await uploadFile(pickedFile.uri, pickedFile.filename, pickedFile.mimeType);
      await api.put<UserProfile>('/api/profile/image', { imageUrl: uploadResult.url });
      setProfileImage(uploadResult.url);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      await invalidateSession();
    } catch (error) {
      Alert.alert('Upload Failed', 'There was an error uploading your photo. Please try again.');
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAvatarPress = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Library'],
          cancelButtonIndex: 0,
        },
        async (buttonIndex) => {
          if (buttonIndex === 1) {
            const photo = await takePhoto();
            handleImageUpload(photo);
          } else if (buttonIndex === 2) {
            const image = await pickImage();
            handleImageUpload(image);
          }
        }
      );
    } else {
      Alert.alert(
        'Change Profile Photo',
        'Choose an option',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Take Photo',
            onPress: async () => {
              const photo = await takePhoto();
              handleImageUpload(photo);
            },
          },
          {
            text: 'Choose from Library',
            onPress: async () => {
              const image = await pickImage();
              handleImageUpload(image);
            },
          },
        ]
      );
    }
  };

  const displayImage = profileImage || user?.image || null;

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-[#0A1628]" edges={['top']}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-[#0A1628]" edges={['top']}>
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        className="px-5 pt-4 pb-3 flex-row items-center justify-between"
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
        <Text className="text-white text-xl font-bold">Edit Profile</Text>
        <Pressable
          onPress={handleSave}
          disabled={updateProfileMutation.isPending}
          className="active:opacity-70"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: updateProfileMutation.isPending
              ? 'rgba(23, 64, 139, 0.5)'
              : theme.colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {updateProfileMutation.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Check size={24} color="#FFFFFF" />
          )}
        </Pressable>
      </Animated.View>

      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Profile Photo Section */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          className="items-center py-8"
        >
          <Pressable onPress={handleAvatarPress} disabled={isUploading}>
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 3,
                borderColor: theme.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {isUploading ? (
                <ActivityIndicator size="large" color="#FFFFFF" />
              ) : displayImage ? (
                <Image
                  source={{ uri: displayImage }}
                  style={{ width: 120, height: 120, borderRadius: 60 }}
                />
              ) : (
                <User size={56} color="#FFFFFF" />
              )}
            </View>
            {/* Camera icon overlay */}
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: theme.colors.background,
              }}
            >
              <Camera size={18} color="#FFFFFF" />
            </View>
          </Pressable>
          <Pressable onPress={handleAvatarPress} className="mt-3 active:opacity-70">
            <Text style={{ color: theme.colors.primary }} className="font-semibold">
              Change Photo
            </Text>
          </Pressable>
        </Animated.View>

        {/* Form Section */}
        <Animated.View
          entering={FadeInDown.delay(200).duration(500)}
        >
          <View
            style={{
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }}
          >
            <BlurView intensity={40} tint="dark" style={{ padding: 0 }}>
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

              {/* Name Input */}
              <View
                style={{
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: 'rgba(255, 255, 255, 0.05)',
                }}
              >
                <Text className="text-zinc-400 text-sm font-semibold mb-2">Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter your name"
                  placeholderTextColor={theme.colors.text.muted}
                  style={{
                    color: '#FFFFFF',
                    fontSize: 16,
                    paddingVertical: 8,
                  }}
                  maxLength={50}
                  autoCapitalize="words"
                />
                <Text className="text-zinc-600 text-xs mt-2">{name.length}/50 characters</Text>
              </View>

              {/* Bio Input */}
              <View
                style={{
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: 'rgba(255, 255, 255, 0.05)',
                }}
              >
                <Text className="text-zinc-400 text-sm font-semibold mb-2">Bio</Text>
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Tell us about yourself..."
                  placeholderTextColor={theme.colors.text.muted}
                  style={{
                    color: '#FFFFFF',
                    fontSize: 16,
                    paddingVertical: 8,
                    minHeight: 80,
                    textAlignVertical: 'top',
                  }}
                  multiline
                  maxLength={150}
                  numberOfLines={4}
                />
                <Text className="text-zinc-600 text-xs mt-2">{bio.length}/150 characters</Text>
              </View>

              {/* Email (Read-only) */}
              <View
                style={{
                  padding: 16,
                }}
              >
                <Text className="text-zinc-400 text-sm font-semibold mb-2">Email</Text>
                <Text className="text-zinc-500 text-base">
                  {user?.email || 'No email'}
                </Text>
                <Text className="text-zinc-600 text-xs mt-2">
                  Email cannot be changed
                </Text>
              </View>
            </BlurView>
          </View>
        </Animated.View>

        {/* Privacy Section */}
        <Animated.View
          entering={FadeInDown.delay(300).duration(500)}
          className="mt-6"
        >
          <Text className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3">
            Privacy
          </Text>
          <View
            style={{
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(255, 255, 255, 0.1)',
            }}
          >
            <BlurView intensity={40} tint="dark" style={{ padding: 0 }}>
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

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  padding: 16,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Lock size={22} color={theme.colors.text.muted} />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-semibold">Private Account</Text>
                  <Text className="text-zinc-500 text-sm mt-0.5">
                    Only followers can see your picks and stats
                  </Text>
                </View>
                <Switch
                  value={isPrivate}
                  onValueChange={setIsPrivate}
                  trackColor={{
                    false: 'rgba(255, 255, 255, 0.2)',
                    true: theme.colors.primary,
                  }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </BlurView>
          </View>
        </Animated.View>

        {/* Info Card */}
        <Animated.View
          entering={FadeInDown.delay(400).duration(500)}
          className="mt-6"
        >
          <View
            style={{
              backgroundColor: 'rgba(23, 64, 139, 0.2)',
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: 'rgba(23, 64, 139, 0.3)',
            }}
          >
            <Text className="text-zinc-300 text-sm leading-5">
              Your profile information is visible to other users. When your account is private,
              only your approved followers can see your picks and stats.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
