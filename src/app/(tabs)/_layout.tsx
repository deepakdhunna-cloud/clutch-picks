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
              <Svg width={26} height={26} viewBox="0 0 32 32" fill="none">
                {/* Crown rim */}
                <Path
                  d="M5 23h22"
                  stroke="#FFFFFF"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                />
                <Path
                  d="M5 23L4 14l4 3"
                  stroke="#FFFFFF"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d="M27 23l1-9-4 3"
                  stroke="#FFFFFF"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Left fleur */}
                <Path
                  d="M8 17c0-3 2-5 2-5s2 2 2 5"
                  stroke="#FFFFFF"
                  strokeWidth={1.2}
                  strokeLinecap="round"
                />
                <Circle cx={10} cy={11.5} r={0.8} fill="#FFFFFF" opacity={0.5} />
                {/* Center fleur — tallest */}
                <Path
                  d="M13.5 17c0-4 2.5-8 2.5-8s2.5 4 2.5 8"
                  stroke="#FFFFFF"
                  strokeWidth={1.3}
                  strokeLinecap="round"
                />
                <Circle cx={16} cy={8.5} r={1} fill="#FFFFFF" opacity={0.6} />
                {/* Right fleur */}
                <Path
                  d="M20 17c0-3 2-5 2-5s2 2 2 5"
                  stroke="#FFFFFF"
                  strokeWidth={1.2}
                  strokeLinecap="round"
                />
                <Circle cx={22} cy={11.5} r={0.8} fill="#FFFFFF" opacity={0.5} />
                {/* Crown band */}
                <Path
                  d="M5 23h22v3H5z"
                  stroke="#FFFFFF"
                  strokeWidth={1.3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                {/* Band cross details */}
                <Line x1={11} y1={23} x2={11} y2={26} stroke="#FFFFFF" strokeWidth={0.5} opacity={0.25} />
                <Line x1={16} y1={23} x2={16} y2={26} stroke="#FFFFFF" strokeWidth={0.5} opacity={0.25} />
                <Line x1={21} y1={23} x2={21} y2={26} stroke="#FFFFFF" strokeWidth={0.5} opacity={0.25} />
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
