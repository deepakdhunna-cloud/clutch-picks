import { Platform } from 'react-native';

/**
 * Release-critical scroll polish.
 *
 * Keep clipped-subview recycling Android-only for card-heavy feeds. On iOS,
 * removeClippedSubviews can visibly clip shadows/rounded cards and cause brief
 * blanking while fast-scrolling mixed card surfaces.
 */
export const SHOULD_REMOVE_CLIPPED_SCROLL_SUBVIEWS = Platform.OS === 'android';
