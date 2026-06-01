export type AuthUserIdentity = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function authUserIdentityFromPayload(payload: unknown): AuthUserIdentity {
  const data = payload as any;
  const user = data?.user ?? data?.data?.user ?? null;

  return {
    userId: cleanString(user?.id),
    email: cleanString(user?.email),
    displayName: cleanString(user?.name),
  };
}

export function sessionTokenFromAuthPayload(payload: unknown): string | null {
  const data = payload as any;
  return cleanString(data?.token ?? data?.data?.token);
}
