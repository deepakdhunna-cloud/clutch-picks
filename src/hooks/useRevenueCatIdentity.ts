import { useEffect, useRef } from "react";
import { syncSubscriberInfo } from "@/lib/revenuecatClient";

export function useRevenueCatIdentity(user?: {
  id?: string | null;
  email?: string | null;
  name?: string | null;
} | null) {
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      lastSyncedRef.current = null;
      return;
    }

    const syncKey = JSON.stringify({
      id: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
    });
    if (lastSyncedRef.current === syncKey) return;
    lastSyncedRef.current = syncKey;

    void syncSubscriberInfo({
      userId: user.id,
      email: user.email,
      displayName: user.name,
    });
  }, [user?.email, user?.id, user?.name]);
}
