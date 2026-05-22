import { Sport } from '@/types/sports';
import {
  cricketBattersText,
  cricketBowlerText,
  cricketInningsPlateText,
  cricketInningsContext,
  cricketLedScoreText,
  cricketOversText,
  cricketPlayersCompactText,
  cricketRequiredText,
  cricketRoleText,
  cricketScoreboardText,
  cricketStatusText,
  cricketTeamScoreText,
} from '../cricket-score';

type CricketGame = Parameters<typeof cricketScoreboardText>[0];

function makeCricketGame(): CricketGame {
  return {
    sport: Sport.IPL,
    homeTeam: { abbreviation: 'MI' },
    awayTeam: { abbreviation: 'RCB' },
    homeScore: 128,
    awayScore: 117,
    homeScoreDisplay: '128',
    awayScoreDisplay: '117/5',
    cricketState: {
      home: {
        runs: 128,
        wickets: 3,
        overs: 14.2,
        scoreText: '128',
        detailText: '14.2 ov',
        isBatting: true,
      },
      away: {
        runs: 117,
        wickets: 5,
        overs: 20,
        scoreText: '117/5',
        detailText: '20 ov',
      },
      battingSide: 'home',
      innings: 2,
    },
  };
}

describe('cricket score display helpers', () => {
  it('includes wickets when score display only has runs', () => {
    const game = makeCricketGame();

    expect(cricketTeamScoreText(game, 'home')).toBe('128/3');
    expect(cricketTeamScoreText(game, 'away')).toBe('117/5');
  });

  it('keeps scoreboard scores compact when feed display includes extra text', () => {
    const game = makeCricketGame();
    game.homeScoreDisplay = '128/3 (14.2 ov)';

    expect(cricketTeamScoreText(game, 'home')).toBe('128/3');
  });

  it('builds a scoreboard label with cricket score text', () => {
    expect(cricketScoreboardText(makeCricketGame())).toBe('128/3-117/5');
  });

  it('returns the batting innings overs for the scoreboard detail line', () => {
    expect(cricketOversText(makeCricketGame())).toBe('14.2 ov');
  });

  it('uses innings as the compact cricket center plate', () => {
    expect(cricketInningsPlateText(makeCricketGame())).toBe('IN2');
  });

  it('uses the batting score with wickets for the cricket led score', () => {
    expect(cricketLedScoreText(makeCricketGame())).toBe('128/3');
  });

  it('shows first innings context when the opening innings is complete', () => {
    const game = makeCricketGame();
    game.cricketState = {
      home: {
        runs: 255,
        wickets: 4,
        overs: 20,
        maxOvers: 20,
        scoreText: '255/4',
        detailText: '20/20 ov',
        isBatting: true,
      },
      away: {
        runs: 0,
        wickets: 0,
        scoreText: '0/0',
      },
      battingSide: 'home',
      innings: 1,
    };
    game.homeScore = 255;
    game.awayScore = 0;

    expect(cricketInningsContext(game)).toEqual({
      label: '1ST INNS',
      value: '255/4',
      detail: 'MI complete',
    });
  });

  it('uses the wicket-aware score in cricket live status text', () => {
    expect(cricketStatusText(makeCricketGame())).toBe('MI · 128/3 · 14.2 ov');
  });

  it('shows 0/0 for a cricket side with innings data but no wicket count yet', () => {
    const game = makeCricketGame();
    game.status = 'LIVE';
    game.awayScoreDisplay = '0';
    game.awayScore = 0;
    game.cricketState!.away = {
      runs: 0,
      scoreText: '0',
    };

    expect(cricketTeamScoreText(game, 'away')).toBe('0/0');
  });

  it('shows 0/0 for a live cricket side that has not batted yet', () => {
    const game = makeCricketGame();
    game.status = 'LIVE';
    game.awayScore = undefined;
    game.awayScoreDisplay = undefined;
    game.cricketState = undefined;

    expect(cricketTeamScoreText(game, 'away')).toBe('0/0');
  });

  it('labels the batting and bowling sides', () => {
    const game = makeCricketGame();

    expect(cricketRoleText(game, 'home')).toBe('BATTING');
    expect(cricketRoleText(game, 'away')).toBe('BOWLING');
  });

  it('shows chase requirement when the second team is batting', () => {
    const game = makeCricketGame();
    game.cricketState = {
      home: {
        runs: 180,
        wickets: 6,
        overs: 20,
        maxOvers: 20,
        scoreText: '180/6',
        detailText: '20/20 ov',
      },
      away: {
        runs: 139,
        wickets: 2,
        overs: 12.2,
        maxOvers: 20,
        scoreText: '139/2',
        detailText: '12.2/20 ov',
        isBatting: true,
      },
      battingSide: 'away',
      innings: 2,
    };
    game.homeScore = 180;
    game.awayScore = 139;

    expect(cricketRequiredText(game)).toBe('Need 42 off 46 balls');
    expect(cricketInningsContext(game)).toEqual({
      label: 'TARGET',
      value: '181',
      detail: 'MI 180/6',
    });
  });

  it('counts 13.6 as a completed over for chase requirements', () => {
    const game = makeCricketGame();
    game.cricketState = {
      home: {
        runs: 180,
        wickets: 6,
        overs: 20,
        maxOvers: 20,
        scoreText: '180/6',
        detailText: '20/20 ov',
      },
      away: {
        runs: 150,
        wickets: 2,
        overs: 13.6,
        maxOvers: 20,
        scoreText: '150/2',
        detailText: '13.6/20 ov',
        isBatting: true,
      },
      battingSide: 'away',
      innings: 2,
    };
    game.homeScore = 180;
    game.awayScore = 150;

    expect(cricketRequiredText(game)).toBe('Need 31 off 36 balls');
  });

  it('formats live batter and bowler names', () => {
    const game = makeCricketGame();
    game.cricketState!.currentBatters = [
      { name: 'Ishan Kishan', role: 'non-striker', runs: 45, balls: 29 },
      { name: 'Heinrich Klaasen', role: 'striker', runs: 35, balls: 17 },
    ];
    game.cricketState!.currentBowler = {
      name: 'Suyash Sharma',
      overs: '2.6',
      wickets: 1,
      runsConceded: 36,
    };

    expect(cricketBattersText(game)).toBe('Bat: Heinrich Klaasen* 35 (17) · Ishan Kishan 45 (29)');
    expect(cricketBowlerText(game)).toBe('Bowl: Suyash Sharma · 2.6 ov · 1/36');
    expect(cricketPlayersCompactText(game)).toBe('Heinrich Klaasen* / Ishan Kishan · Bowl: Suyash Sharma');
  });
});
