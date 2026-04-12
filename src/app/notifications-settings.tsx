import { View, Text, Pressable, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ArrowLeft, Bell, Zap, TrendingUp, AlertTriangle, Activity } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface SettingItemProps {
  icon: any;
  title: string;
  subtitle?: string;
  rightElement?: React.ReactNode;
}

function SettingItem({ icon: Icon, title, subtitle, rightElement }: SettingItemProps) {
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.04)',
      }}
    >
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
      }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: 'rgba(255,255,255,0.06)',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: 14,
          }}
        >
          <Icon size={18} color="rgba(255,255,255,0.5)" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rightElement}
      </View>
    </View>
  );
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, paddingHorizontal: 20 }}>
        <View style={{ width: 3, height: 12, borderRadius: 1.5, backgroundColor: '#7A9DB8' }} />
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {title}
        </Text>
      </View>
      <View
        style={{
          marginHorizontal: 20,
          backgroundColor: 'rgba(20,20,25,0.95)',
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        {children}
      </View>
    </View>
  );
}

export default function NotificationsSettingsScreen() {
  const router = useRouter();

  // Notification preferences — stored in AsyncStorage
  const [notifPrefs, setNotifPrefs] = useState({
    gameLive: true,
    pickResult: true,
    predictionShift: true,
    bigGame: true,
    streak: true,
  });

  useEffect(() => {
    AsyncStorage.getItem('clutch_notif_prefs').then(val => {
      if (val) { try { setNotifPrefs(JSON.parse(val)); } catch {} }
    });
  }, []);

  const toggleNotif = useCallback((key: keyof typeof notifPrefs) => {
    setNotifPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] };
      AsyncStorage.setItem('clutch_notif_prefs', JSON.stringify(next));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return next;
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingVertical: 16,
          }}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.06)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.08)',
            }}
          >
            <ArrowLeft size={20} color="#FFFFFF" />
          </Pressable>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginLeft: 16 }}>
            Notifications
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.delay(100).duration(400)}>
            <SettingSection title="ALERTS">
              <SettingItem
                icon={Activity}
                title="Game Going Live"
                subtitle="When a game you picked starts"
                rightElement={
                  <Switch
                    value={notifPrefs.gameLive}
                    onValueChange={() => toggleNotif('gameLive')}
                    trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(122,157,184,0.4)' }}
                    thumbColor={notifPrefs.gameLive ? '#7A9DB8' : 'rgba(255,255,255,0.3)'}
                  />
                }
              />
              <SettingItem
                icon={Zap}
                title="Pick Results"
                subtitle="Win or loss when your pick resolves"
                rightElement={
                  <Switch
                    value={notifPrefs.pickResult}
                    onValueChange={() => toggleNotif('pickResult')}
                    trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(122,157,184,0.4)' }}
                    thumbColor={notifPrefs.pickResult ? '#7A9DB8' : 'rgba(255,255,255,0.3)'}
                  />
                }
              />
              <SettingItem
                icon={AlertTriangle}
                title="Prediction Shifts"
                subtitle="When the model changes its predicted winner"
                rightElement={
                  <Switch
                    value={notifPrefs.predictionShift}
                    onValueChange={() => toggleNotif('predictionShift')}
                    trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(122,157,184,0.4)' }}
                    thumbColor={notifPrefs.predictionShift ? '#7A9DB8' : 'rgba(255,255,255,0.3)'}
                  />
                }
              />
              <SettingItem
                icon={TrendingUp}
                title="Big Game Alerts"
                subtitle="High-confidence picks 3 hours before tip-off"
                rightElement={
                  <Switch
                    value={notifPrefs.bigGame}
                    onValueChange={() => toggleNotif('bigGame')}
                    trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(122,157,184,0.4)' }}
                    thumbColor={notifPrefs.bigGame ? '#7A9DB8' : 'rgba(255,255,255,0.3)'}
                  />
                }
              />
              <SettingItem
                icon={Bell}
                title="Win Streak Milestones"
                subtitle="Celebrate 5, 7, 10+ correct picks in a row"
                rightElement={
                  <Switch
                    value={notifPrefs.streak}
                    onValueChange={() => toggleNotif('streak')}
                    trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(122,157,184,0.4)' }}
                    thumbColor={notifPrefs.streak ? '#7A9DB8' : 'rgba(255,255,255,0.3)'}
                  />
                }
              />
            </SettingSection>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
