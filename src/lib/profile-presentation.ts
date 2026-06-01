type ProfileDisplayNameInput = {
  profileName?: string | null;
  sessionName?: string | null;
};

export function profileDisplayName({ profileName, sessionName }: ProfileDisplayNameInput): string {
  const profile = profileName?.trim();
  if (profile) return profile;

  const session = sessionName?.trim();
  if (session) return session;

  return 'Player';
}
