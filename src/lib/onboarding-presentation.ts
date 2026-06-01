export function arenaStepButtonLabel(subPage: number): 'Next' | 'Continue' {
  return subPage < 2 ? 'Next' : 'Continue';
}
