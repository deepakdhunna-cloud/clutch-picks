import fs from 'fs';
import path from 'path';

const editProfileSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/edit-profile.tsx'),
  'utf8',
);
const picksHistorySource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/picks-history.tsx'),
  'utf8',
);
const notificationsSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/notifications-settings.tsx'),
  'utf8',
);
const sportSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/sport/[sport].tsx'),
  'utf8',
);
const privacySource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/privacy-policy.tsx'),
  'utf8',
);

describe('secondary route accessibility', () => {
  it('labels edit profile controls and keeps header actions 44 points', () => {
    expect(editProfileSource).toContain('accessibilityLabel="Back"');
    expect(editProfileSource).toContain('accessibilityLabel="Save profile"');
    expect(editProfileSource).toContain('accessibilityState={{ disabled: updateProfileMutation.isPending, busy: updateProfileMutation.isPending }}');
    expect(editProfileSource).toContain('accessibilityLabel={displayImage ? "Change profile photo" : "Add profile photo"}');
    expect(editProfileSource).toContain('accessibilityLabel="Name"');
    expect(editProfileSource).toContain('width: 44');
    expect(editProfileSource).toContain('height: 44');
  });

  it('does not delay edit profile primary content after the route opens', () => {
    expect(editProfileSource).not.toContain('FadeInDown.delay(100).duration(500)');
    expect(editProfileSource).not.toContain('FadeInDown.delay(200).duration(500)');
  });

  it('labels pick history navigation, filters, and rows', () => {
    expect(picksHistorySource).toContain('accessibilityLabel="Back"');
    expect(picksHistorySource).toContain('accessibilityLabel={`Open ${item.teamName} versus ${item.opponentName}`}');
    expect(picksHistorySource).toContain('accessibilityHint="Opens game details"');
    expect(picksHistorySource).toContain('accessibilityLabel={`${f.label} picks filter`}');
    expect(picksHistorySource).toContain('accessibilityState={{ selected: active }}');
    expect(picksHistorySource).toContain('minHeight: 44');
  });

  it('labels notification settings and switch states', () => {
    expect(notificationsSource).toContain('accessibilityLabel="Back"');
    expect(notificationsSource).toContain('const NOTIFICATION_LABELS');
    expect(notificationsSource).toContain('accessibilityLabel={NOTIFICATION_LABELS.gameLive}');
    expect(notificationsSource).toContain('accessibilityHint={NOTIFICATION_HINTS.gameLive}');
    expect(notificationsSource).toContain('accessibilityState={{ disabled: savingKey !== null, checked: notifPrefs.gameLive }}');
    expect(notificationsSource).toContain('accessibilityRole="switch"');
    expect(notificationsSource).toContain('importantForAccessibility="no"');
    expect(notificationsSource).toContain('width: 44');
    expect(notificationsSource).toContain('height: 44');
  });

  it('exposes sport filters as selectable controls', () => {
    expect(sportSource).toContain('accessibilityRole="button"');
    expect(sportSource).toContain("accessibilityLabel={`${filter.label}, ${count} ${count === 1 ? 'game' : 'games'}`}");
    expect(sportSource).toContain('accessibilityHint="Filters this sport screen"');
    expect(sportSource).toContain('accessibilityState={{ selected: isSelected }}');
  });

  it('labels the game analysis Pro preview clearly', () => {
    const gameAnalysisSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/game-analysis.tsx'),
      'utf8',
    );

    expect(gameAnalysisSource).toContain('AI analysis is ready');
    expect(gameAnalysisSource).not.toContain('AI analysis is queued');
    expect(gameAnalysisSource).toContain('accessibilityLabel="Preview Pro analysis"');
    expect(gameAnalysisSource).toContain('accessibilityHint="Opens Clutch Picks Pro"');
  });

  it('breaks the privacy policy into navigable text sections', () => {
    expect(privacySource).toContain(".split('\\n\\n')");
    expect(privacySource).toContain('accessibilityRole={isHeading ? "header" : undefined}');
    expect(privacySource).toContain('marginBottom: isHeading ? 12 : 16');
  });

  it('labels live games sport chips before multiple live sports appear', () => {
    const liveGamesSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/live-games.tsx'),
      'utf8',
    );

    expect(liveGamesSource).toContain('accessibilityLabel={`${label} live games filter`}');
    expect(liveGamesSource).toContain('accessibilityHint="Filters live games by sport"');
    expect(liveGamesSource).toContain('accessibilityState={{ selected: active }}');
    expect(liveGamesSource).toContain('minHeight: 44');
  });
});
