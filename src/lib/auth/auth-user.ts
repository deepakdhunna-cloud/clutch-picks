export type AuthUserIdentity = {
  userId: string | null;
  email: string | null;
  displayName: string | null;
};

export type AuthSessionSnapshot = {
  session?: {
    token: string | null;
  };
  user: {
    id: string;
    email: string | null;
    name: string | null;
  };
};

export type AuthSessionSnapshotOptions = {
  fallbackEmail?: string | null;
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
  return cleanString(
    data?.token ??
    data?.data?.token ??
    data?.session?.token ??
    data?.data?.session?.token,
  );
}

export function authPayloadHasSession(payload: unknown): boolean {
  const data = payload as any;
  const body = data?.data ?? data;
  const identity = authUserIdentityFromPayload(payload);

  return Boolean(
    sessionTokenFromAuthPayload(payload) ||
    body?.session ||
    identity.userId ||
    identity.email,
  );
}

export function authSessionFromPayload(
  payload: unknown,
  options: AuthSessionSnapshotOptions = {},
): AuthSessionSnapshot | null {
  const identity = authUserIdentityFromPayload(payload);
  const fallbackEmail = cleanString(options.fallbackEmail);
  const token = sessionTokenFromAuthPayload(payload);
  const hasPayloadIdentity = Boolean(identity.userId || identity.email);
  const userId = identity.userId ?? identity.email ?? (token ? fallbackEmail : null);

  if (!userId || (!token && !hasPayloadIdentity)) return null;

  return {
    ...(token ? { session: { token } } : {}),
    user: {
      id: userId,
      email: identity.email ?? fallbackEmail,
      name: identity.displayName,
    },
  };
}
