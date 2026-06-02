import React from 'react';
import { GameWithPrediction } from '@/types/sports';
import { LiveArenaCard } from './LiveArenaCard';

// Fixed footprint for the home-page "Live Now" rail. Kept constant so the rail
// height never shifts between cards.
const CARD_WIDTH = 300;

interface CompactLiveCardProps {
  game: GameWithPrediction;
  // Receive the game so the parent can pass a single stable handler instead of a
  // fresh inline closure per render (which would defeat the content memo).
  onPress: (game: GameWithPrediction) => void;
  onPressIn?: (game: GameWithPrediction) => void;
  canOpen?: () => boolean;
}

// The compact "Live Now" card now shares the My Arena game-day live-card design
// (glass frame, jerseys, LED scoreboard, duration pill, LIVE badge) via the
// shared rail variant — no stat tiles, no game pulse.
export function CompactLiveCard({ game, onPress, onPressIn, canOpen }: CompactLiveCardProps) {
  return (
    <LiveArenaCard
      game={game}
      cardWidth={CARD_WIDTH}
      variant="rail"
      onPress={onPress}
      onPressIn={onPressIn}
      canOpen={canOpen}
    />
  );
}

export default CompactLiveCard;
