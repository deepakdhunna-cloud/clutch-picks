export const REPLAY_BLACK_SCREEN_MS = 650;
export const REPLAY_INTRO_MOTION_SCALE = 1.4;

type ReplayParam = string | string[] | undefined;

export function shouldUseReplayIntroGate(replay: ReplayParam): boolean {
  if (Array.isArray(replay)) {
    return replay.some(shouldUseReplayIntroGate);
  }

  return replay === 'settings' || replay === 'true';
}
