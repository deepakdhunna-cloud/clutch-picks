export type HomeGamesRequestPlan = {
  firstPaintPath: '/api/games';
};

export function getHomeGamesRequestPlan(): HomeGamesRequestPlan {
  return {
    firstPaintPath: '/api/games',
  };
}
