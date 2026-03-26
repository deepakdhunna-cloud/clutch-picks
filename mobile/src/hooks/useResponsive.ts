import { useWindowDimensions, Platform } from 'react-native';
import { useMemo } from 'react';

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const isTablet = Platform.OS === 'ios' && Math.min(width, height) >= 600;
    const isLandscape = width > height;
    const numColumns = isTablet && isLandscape ? 2 : 1;

    return {
      isTablet,
      isLandscape,
      width,
      height,
      numColumns,
      contentPadding: isTablet ? (isLandscape ? 32 : 28) : 20,
      cardGap: isTablet ? 16 : 0,
      headerSize: isTablet ? 26 : 20,
      subheaderSize: isTablet ? 16 : 13,
      bodySize: isTablet ? 15 : 13,
      filterIconSize: isTablet ? 76 : 64,
      filterIconRadius: isTablet ? 20 : 16,
      navMaxWidth: isTablet ? 480 : 400,
      useSideBySide: isTablet && isLandscape,
    };
  }, [width, height]);
}
