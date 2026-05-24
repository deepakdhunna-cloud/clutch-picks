import type { CanonicalDecisionProfile, CanonicalDecisionTag } from '@/types/sports';

const TAG_LABELS: Record<CanonicalDecisionTag, string> = {
  'model-consensus': 'Consensus',
  'hidden-edge': 'Hidden edge',
  'upset-watch': 'Upset watch',
  'market-disagreement': 'Market gap',
  'thin-data': 'Thin data',
  'volatile-script': 'Volatile',
  'low-conviction': 'Low conviction',
  chalk: 'Chalk',
};

export function decisionTagLabel(tag: CanonicalDecisionTag): string {
  return TAG_LABELS[tag] ?? tag;
}

export function decisionProfileHeadline(profile?: CanonicalDecisionProfile | null): string {
  if (!profile) return 'Unified read pending';
  if (profile.tags.includes('upset-watch')) return 'Upset profile active';
  if (profile.tags.includes('hidden-edge')) return 'Hidden edge detected';
  if (profile.tags.includes('model-consensus')) return 'Engines aligned';
  if (profile.tags.includes('market-disagreement')) return 'Market disagreement';
  if (profile.tags.includes('thin-data')) return 'Limited-data read';
  return 'Unified read';
}

export function decisionProfileSubline(profile?: CanonicalDecisionProfile | null): string {
  if (!profile) return 'Waiting for the unified decision layer.';
  const agreement = `${Math.round(profile.agreementScore)}% agreement`;
  const hidden = `hidden ${Math.round(profile.hiddenEdgeScore)}`;
  const upset = `upset ${Math.round(profile.upsetScore)}`;
  return `${agreement} · ${hidden} · ${upset}`;
}

export function decisionProfileTags(profile?: CanonicalDecisionProfile | null): CanonicalDecisionTag[] {
  return profile?.tags.slice(0, 3) ?? [];
}
