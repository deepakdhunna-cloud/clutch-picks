import React from 'react';
import { Tabs } from 'expo-router';
import { Home, User } from 'lucide-react-native';
import { GlassBottomNav } from '@/components/GlassBottomNav';
import { ScrollProvider } from '@/contexts/ScrollContext';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import { useLiveScores } from '@/hooks/useLiveScores';

// Field goal post icon matching the "U" from the CLUTCH logo
function FieldGoalIcon({ size = 24, color = '#FFFFFF', strokeWidth = 1.5 }: { size?: number; color?: string; strokeWidth?: number }) {
  const scale = size / 24;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Left upright */}
      <Path d="M6 2 L6 16" stroke={color} strokeWidth={strokeWidth * 1.2} strokeLinecap="round" />
      {/* Right upright */}
      <Path d="M18 2 L18 16" stroke={color} strokeWidth={strokeWidth * 1.2} strokeLinecap="round" />
      {/* Crossbar */}
      <Path d="M6 16 L18 16" stroke={color} strokeWidth={strokeWidth * 1.2} strokeLinecap="round" />
      {/* Center post going down */}
      <Path d="M12 16 L12 22" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      {/* Football going through - pointed oval shape */}
      <Path
        d="M9 9 Q12 6 15 9 Q12 12 9 9"
        fill={color}
        transform="rotate(-35 12 9)"
      />
    </Svg>
  );
}

export default function TabLayout() {
  const { isConnected } = useLiveScores();
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
          freezeOnBlur: true,
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
              <Svg width={24} height={24} viewBox="0 0 32 32" fill="none">
                <Circle cx={16} cy={16} r={14} stroke="#FFFFFF" strokeWidth={focused ? 2 : 1.2} fill="none" opacity={0.25} />
                <Circle cx={16} cy={16} r={9} stroke="#FFFFFF" strokeWidth={focused ? 2 : 1.2} fill="none" opacity={0.4} />
                <Circle cx={16} cy={16} r={4} stroke="#FFFFFF" strokeWidth={focused ? 2 : 1.2} fill="none" opacity={0.6} />
                <Line x1={16} y1={2} x2={16} y2={16} stroke="#FFFFFF" strokeWidth={focused ? 2 : 1.2} strokeLinecap="round" />
                <Circle cx={16} cy={6} r={2} fill="#FFFFFF" />
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
