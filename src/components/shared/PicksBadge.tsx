import React from 'react';
import { View, Text } from 'react-native';

/**
 * Consistent PICKS badge used in the logo across the app.
 * Dark raised 3D border — darker blue than the fill.
 */
export function PicksBadge({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const config = {
    sm: { px: 12, py: 5, fontSize: 12, spacing: 3, borderRadius: 10, borderWidth: 3, marginLeft: 8, marginTop: 8 },
    md: { px: 14, py: 8, fontSize: 16, spacing: 4, borderRadius: 11, borderWidth: 3.5, marginLeft: 12, marginTop: 0 },
    lg: { px: 22, py: 11, fontSize: 22, spacing: 7, borderRadius: 13, borderWidth: 4, marginLeft: 0, marginTop: 12 },
  }[size];

  return (
    <View
      style={{
        marginLeft: config.marginLeft,
        marginTop: config.marginTop,
        borderRadius: config.borderRadius,
        borderWidth: config.borderWidth,
        borderColor: '#2A3E4E',
        backgroundColor: '#5A7A8A',
        paddingHorizontal: config.px,
        paddingVertical: config.py,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.7,
        shadowRadius: 16,
        elevation: 14,
      }}
    >
      <Text
        style={{
          fontWeight: '800',
          letterSpacing: config.spacing,
          color: '#FFFFFF',
          fontSize: config.fontSize,
          textTransform: 'uppercase',
        }}
      >
        PICKS
      </Text>
    </View>
  );
}
