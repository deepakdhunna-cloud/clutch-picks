import React from 'react';
import { View, Text, type TextStyle } from 'react-native';

interface Props {
  value: number;
  displayValue?: string | number;
  textStyle: TextStyle | TextStyle[];
  badgeAlign?: 'left' | 'right';
  accentColor?: string;
  enabled?: boolean;
  scoreKey?: string;
}

export const ScorePop = React.memo(function ScorePop({
  value,
  displayValue,
  textStyle,
}: Props) {
  return (
    <View style={{ position: 'relative' }}>
      <Text style={textStyle}>{displayValue ?? value}</Text>
    </View>
  );
});
