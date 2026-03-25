import React from 'react';
import { Tabs } from 'expo-router';
import { Home, User } from 'lucide-react-native';
import { GlassBottomNav } from '@/components/GlassBottomNav';
import { ScrollProvider } from '@/contexts/ScrollContext';
import Svg, { Path, Circle, Line } from 'react-native-svg';

// Field goal post icon matching the "U" from the CLUTCH logo
function FieldGoalIcon({ size = 24, color = '#FFFFFF', strokeWidth = 1.5 }: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 2 L6 16" stroke={color} strokeWidth={strokeWidth * 1.2} strokeLinecap="round" />
      <Path d="M18 2 L18 16" stroke={color} strokeWidth={strokeWidth * 1.2} strokeLinecap="round" />
      <Path d="M6 16 L18 16" stroke={color} strokeWidth={strokeWidth * 1.2} strokeLinecap="round" />
      <Path d="M12 16 L12 22" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path
        d="M9 9 Q12 6 15 9 Q12 12 9 9"
        fill={color}
        transform="rotate(-35 12 9)"
      />
    </Svg>
  );
}

export default function TabLayout() {
  // NOTE: useLiveScores was removed — it called setLiveScores() on every SSE event
  // which re-rendered the entire tab layout (all icons, nav bar, frozen tabs) and caused crashes.
  // Live scores still work via polling in useGames().
  return (
    <ScrollProvider>
      <Tabs
        tabBar={(props) => <GlassBottomNav {...props} />}
        screenOptions={{
          tabBarActiveTintColor: '#FFFFFF',
          tabBarInactiveTintColor: 'rgba(255, 255, 255, 0.5)',
          tabBarShowLabel: true,
          tabBarLabelPosition: 'below-icon',
          headerShown: false,
          lazy: true,
          // NOTE: freezeOnBlur removed — it caused native crashes when combined
          // with reanimated animations in the GlassBottomNav and tab screens.
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ focused }) => (
              <Home
                size={24}
                color="#FFFFFF"
                strokeWidth={focused ? 2.5 : 1.5}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="clutch-picks"
          options={{
            title: 'Clutch Picks',
            tabBarIcon: ({ focused }) => (
              <FieldGoalIcon
                size={24}
                color="#FFFFFF"
                strokeWidth={focused ? 2.5 : 1.5}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: 'My Arena',
            tabBarIcon: ({ focused }) => (
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                {/* Radar rings */}
                <Circle cx={12} cy={12} r={10} stroke="#FFFFFF" strokeWidth={focused ? 1.8 : 1.2} fill="none" opacity={0.2} />
                <Circle cx={12} cy={12} r={6} stroke="#FFFFFF" strokeWidth={focused ? 1.8 : 1.2} fill="none" opacity={0.35} />
                <Circle cx={12} cy={12} r={2} fill="#FFFFFF" opacity={focused ? 0.9 : 0.6} />
                {/* Sweep line */}
                <Line x1={12} y1={2} x2={12} y2={12} stroke="#FFFFFF" strokeWidth={focused ? 2 : 1.2} strokeLinecap="round" opacity={0.7} />
                {/* Signal dot */}
                <Circle cx={15} cy={7} r={1.5} fill="#FFFFFF" opacity={focused ? 0.8 : 0.5} />
              </Svg>
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ focused }) => (
              <User
                size={24}
                color="#FFFFFF"
                strokeWidth={focused ? 2.5 : 1.5}
              />
            ),
          }}
        />
      </Tabs>
    </ScrollProvider>
  );
}
