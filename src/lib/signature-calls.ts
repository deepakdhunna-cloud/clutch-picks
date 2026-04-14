import type { Pick } from '@/hooks/usePicks';

// ─── Types ─────────────────────────────────────────────────────────────────

export type SignatureCallReason =
  | 'high_confidence'
  | 'underdog'
  | 'bold'
  | 'underdog_and_bold';

// A Pick that has all 5 enrichment fields populated. Narrowed from the wider
// Pick type so downstream code can rely on the fields being present.
export type EnrichedPick = Pick & {
  result: 'win';
  modelPredictedWinner: 'home' | 'away';
  modelConfidence: number;
  modelHomeWinProb: number;
  finalHomeScore: number;
  finalAwayScore: number;
};

export type SignatureCall = {
  pick: EnrichedPick;
  reasons: SignatureCallReason[];
  primaryReason: SignatureCallReason;
  narrative: string;
};

// ─── Narrative variant pools ───────────────────────────────────────────────
// Templates use {team}, {opponent}, {score}, {confidence} placeholders.
// {score} is formatted as "{pickedTeamScore}-{opponentScore}".

const HIGH_CONFIDENCE_NARRATIVES = [
  "You trusted the model and the model delivered. {team} took it {score} — exactly the kind of conviction call that pays off.",
  "{confidence}% is high conviction. You backed it. {team} won {score}. Locked-in calls like this one are what build a track record.",
  "When the model is this confident, you go with it. You did. {team} won {score}. Smart pick, clean execution.",
  "The model loved {team} at {confidence}%. You loved them too. They came through {score}. This is what alignment looks like.",
  "High conviction, high reward. {team} won {score} just like the model said they would. You read this one right with the data.",
  "{confidence}% confidence is the model planting a flag. You stood with it. {team} took {opponent} {score} — exactly as called.",
];

const UNDERDOG_NARRATIVES = [
  "{team} were the underdogs and you saw something. They proved you right, {score}. Calls like this are why analysts exist.",
  "Picking the underdog takes guts. {team} winning {score}? That's the payoff. You saw it coming when nobody else did.",
  "The model leaned {opponent}. You leaned {team}. {team} won {score}. Underdog calls that hit are the ones worth remembering.",
  "Backing the underdog isn't easy. {team} winning {score} makes it worth it. You read the room before the room knew it had been read.",
  "{team} weren't supposed to win this one. You called it anyway. They took it {score}. That's the kind of read you remember.",
  "Going with the underdog is a statement. {team} winning {score} was the reply. You saw the path before anyone drew the map.",
];

const BOLD_NARRATIVES = [
  "You called {team} when the model said {opponent}. You were right. They took it {score} and you saw what the data missed.",
  "The model wanted {opponent}. You wanted {team}. {team} won {score}. That's the kind of read that separates the analysts from the algorithms.",
  "Going against the model is bold. Going against the model and being right is something else entirely. {team} beat {opponent} {score} — exactly like you said they would.",
  "Everyone with a spreadsheet had {opponent}. You had {team}. {team} won {score}. Sometimes the gut sees what the math doesn't.",
  "The model gave {opponent} the edge at {confidence}%. You disagreed. {team} won {score}. You read this game better than the engine did.",
  "Bold move. {team} over {opponent} when every projection said otherwise. Final: {score}. You called it before the data could.",
];

const UNDERDOG_AND_BOLD_NARRATIVES = [
  "Underdog. Against the model. Right anyway. {team} took it {score}. This is the kind of call you tell people about for weeks.",
  "Bold and contrarian — and right. {team} beat {opponent} {score} when nothing in the data said they should. Calls like this are signature calls.",
  "You backed the underdog AND went against the model. {team} winning {score} is the rarest kind of right. This is the call of the week.",
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function isEnrichedWin(p: Pick): p is EnrichedPick {
  return (
    p.result === 'win' &&
    p.modelPredictedWinner != null &&
    p.modelConfidence != null &&
    p.modelHomeWinProb != null &&
    p.finalHomeScore != null &&
    p.finalAwayScore != null
  );
}

function pickedTeamLabel(pick: EnrichedPick): string {
  return pick.pickedTeam === 'home' ? (pick.homeTeam ?? 'Home') : (pick.awayTeam ?? 'Away');
}

function opponentTeamLabel(pick: EnrichedPick): string {
  return pick.pickedTeam === 'home' ? (pick.awayTeam ?? 'Away') : (pick.homeTeam ?? 'Home');
}

function pickedTeamScore(pick: EnrichedPick): number {
  return pick.pickedTeam === 'home' ? pick.finalHomeScore : pick.finalAwayScore;
}

function opponentScore(pick: EnrichedPick): number {
  return pick.pickedTeam === 'home' ? pick.finalAwayScore : pick.finalHomeScore;
}

// ─── Eligibility ───────────────────────────────────────────────────────────

function evaluateReasons(pick: EnrichedPick): SignatureCallReason[] {
  const reasons: SignatureCallReason[] = [];

  // HIGH_CONFIDENCE: model was ≥60% sure, user picked the model's side, won.
  const highConfidence =
    pick.modelConfidence >= 60 && pick.pickedTeam === pick.modelPredictedWinner;
  if (highConfidence) reasons.push('high_confidence');

  // UNDERDOG: user picked the side the model rated as the lower probability.
  const underdogSide = pick.modelHomeWinProb < 50 ? 'home' : 'away';
  const underdog = pick.pickedTeam === underdogSide;
  if (underdog) reasons.push('underdog');

  // BOLD: user picked the opposite side of the model's call.
  const bold = pick.pickedTeam !== pick.modelPredictedWinner;
  if (bold) reasons.push('bold');

  return reasons;
}

function pickPrimaryReason(reasons: SignatureCallReason[]): SignatureCallReason | null {
  const hasUnderdog = reasons.includes('underdog');
  const hasBold = reasons.includes('bold');
  if (hasUnderdog && hasBold) return 'underdog_and_bold';
  if (hasBold) return 'bold';
  if (hasUnderdog) return 'underdog';
  if (reasons.includes('high_confidence')) return 'high_confidence';
  return null;
}

// ─── Narrative generation ──────────────────────────────────────────────────

export function generateNarrative(
  pick: EnrichedPick,
  primaryReason: SignatureCallReason
): string {
  const pool =
    primaryReason === 'high_confidence' ? HIGH_CONFIDENCE_NARRATIVES :
    primaryReason === 'underdog' ? UNDERDOG_NARRATIVES :
    primaryReason === 'bold' ? BOLD_NARRATIVES :
    UNDERDOG_AND_BOLD_NARRATIVES;

  const template = pool[Math.floor(Math.random() * pool.length)] ?? pool[0]!;

  const team = pickedTeamLabel(pick);
  const opponent = opponentTeamLabel(pick);
  const score = `${pickedTeamScore(pick)}-${opponentScore(pick)}`;
  const confidence = String(pick.modelConfidence);

  return template
    .replace(/\{team\}/g, team)
    .replace(/\{opponent\}/g, opponent)
    .replace(/\{score\}/g, score)
    .replace(/\{confidence\}/g, confidence);
}

// ─── Public API ────────────────────────────────────────────────────────────

export function getSignatureCalls(picks: Pick[] | undefined): SignatureCall[] {
  if (!picks) return [];

  const calls: SignatureCall[] = [];
  for (const p of picks) {
    if (!isEnrichedWin(p)) continue;
    const reasons = evaluateReasons(p);
    const primaryReason = pickPrimaryReason(reasons);
    if (!primaryReason) continue;
    calls.push({
      pick: p,
      reasons,
      primaryReason,
      narrative: generateNarrative(p, primaryReason),
    });
  }

  // Newest signature calls first, then take the top 5.
  calls.sort(
    (a, b) => new Date(b.pick.createdAt).getTime() - new Date(a.pick.createdAt).getTime()
  );
  return calls.slice(0, 5);
}
