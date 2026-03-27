import { View, Text, Pressable, ScrollView, TextInput, Image, ActivityIndicator, Alert, ActionSheetIOS, Platform, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, User, Camera, Check, Lock } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { useSession, useInvalidateSession } from '@/lib/auth/use-session';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { pickImage, takePhoto } from '@/lib/file-picker';
import { uploadFile } from '@/lib/upload';

// Match profile card palette
const BG = '#040608';
const GLASS = 'rgba(8,8,12,0.95)';
const MAROON = '#8B0A1F';
const MAROON_DIM = 'rgba(139,10,31,0.15)';
const TEAL = '#7A9DB8';
const BORDER = 'rgba(255,255,255,0.08)';
const BORDER_HI = 'rgba(255,255,255,0.14)';
const TEXT_MUTED = '#6B7C94';
const TEXT_SECONDARY = '#A1B3C9';

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
      <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={TEAL} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BG }} edges={['top']}>
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderWidth: 1,
            borderColor: BORDER,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ArrowLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700' }}>Edit Profile</Text>
        <Pressable
          onPress={handleSave}
          disabled={updateProfileMutation.isPending}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: updateProfileMutation.isPending ? MAROON_DIM : MAROON,
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

      <ScrollView style={{ flex: 1, paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Profile Photo Section */}
        <Animated.View
          entering={FadeInDown.delay(100).duration(500)}
          style={{ alignItems: 'center', paddingVertical: 32 }}
        >
          <Pressable onPress={handleAvatarPress} disabled={isUploading}>
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                padding: 3,
                overflow: 'hidden',
              }}
            >
              <LinearGradient
                colors={[MAROON, TEAL]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 60 }}
              />
              <View style={{ flex: 1, borderRadius: 57, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {isUploading ? (
                  <ActivityIndicator size="large" color="#FFFFFF" />
                ) : displayImage ? (
                  <Image
                    source={{ uri: displayImage }}
                    style={{ width: 114, height: 114, borderRadius: 57 }}
                  />
                ) : (
                  <User size={56} color={TEXT_MUTED} />
                )}
              </View>
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
                backgroundColor: MAROON,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 3,
                borderColor: BG,
              }}
            >
              <Camera size={18} color="#FFFFFF" />
            </View>
          </Pressable>
          <Pressable onPress={handleAvatarPress} style={{ marginTop: 12 }}>
            <Text style={{ color: TEAL, fontWeight: '600', fontSize: 14 }}>
              Change Photo
            </Text>
          </Pressable>
        </Animated.View>

        {/* Form Section */}
        <Animated.View entering={FadeInDown.delay(200).duration(500)}>
          <View
            style={{
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: BORDER_HI,
              backgroundColor: GLASS,
            }}
          >
            {/* Name Input */}
            <View
              style={{
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor: BORDER,
              }}
            >
              <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Enter your name"
                placeholderTextColor={TEXT_MUTED}
                keyboardAppearance="dark"
                style={{
                  color: '#FFFFFF',
                  fontSize: 16,
                  paddingVertical: 8,
                }}
                maxLength={50}
                autoCapitalize="words"
              />
              <Text style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11, marginTop: 8 }}>{name.length}/50 characters</Text>
            </View>

            {/* Bio Input */}
            <View
              style={{
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor: BORDER,
              }}
            >
              <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Bio</Text>
              <TextInput
                value={bio}
                onChangeText={setBio}
                placeholder="Tell us about yourself..."
                placeholderTextColor={TEXT_MUTED}
                keyboardAppearance="dark"
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
              <Text style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11, marginTop: 8 }}>{bio.length}/150 characters</Text>
            </View>

            {/* Email (Read-only) */}
            <View style={{ padding: 16 }}>
              <Text style={{ color: TEXT_MUTED, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>Email</Text>
              <Text style={{ color: TEXT_SECONDARY, fontSize: 16 }}>
                {user?.email || 'No email'}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11, marginTop: 8 }}>
                Email cannot be changed
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Privacy Section */}
        <Animated.View entering={FadeInDown.delay(300).duration(500)} style={{ marginTop: 24 }}>
          <Text style={{ color: TEXT_MUTED, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12 }}>
            PRIVACY
          </Text>
          <View
            style={{
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: BORDER_HI,
              backgroundColor: GLASS,
            }}
          >
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
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  borderWidth: 1,
                  borderColor: BORDER,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Lock size={22} color={TEXT_MUTED} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 15 }}>Private Account</Text>
                <Text style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 2 }}>
                  Only followers can see your picks and stats
                </Text>
              </View>
              <Switch
                value={isPrivate}
                onValueChange={setIsPrivate}
                trackColor={{
                  false: 'rgba(255,255,255,0.12)',
                  true: MAROON,
                }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        </Animated.View>

        {/* Info Card */}
        <Animated.View entering={FadeInDown.delay(400).duration(500)} style={{ marginTop: 24 }}>
          <View
            style={{
              backgroundColor: MAROON_DIM,
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: 'rgba(139,10,31,0.20)',
            }}
          >
            <Text style={{ color: TEXT_SECONDARY, fontSize: 13, lineHeight: 20 }}>
              Your profile information is visible to other users. When your account is private,
              only your approved followers can see your picks and stats.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
