// Pre-install a simple online manager to prevent @better-auth/expo from calling
// expo-network's addNetworkStateListener, which can fail with "Object is not a function"
// when the native module isn't fully available.
// This file must be imported BEFORE @better-auth/expo/client.

const kOnlineManager = Symbol.for("better-auth:online-manager");
const g = globalThis as Record<symbol, unknown>;

if (!g[kOnlineManager]) {
  type Listener = (online: boolean) => void;
  g[kOnlineManager] = {
    listeners: new Set<Listener>(),
    isOnline: true,
    subscribe(listener: Listener) {
      (this as { listeners: Set<Listener> }).listeners.add(listener);
      return () => {
        (this as { listeners: Set<Listener> }).listeners.delete(listener);
      };
    },
    setOnline(online: boolean) {
      (this as { isOnline: boolean }).isOnline = online;
      (this as { listeners: Set<Listener> }).listeners.forEach((l) => l(online));
    },
    setup() {
      return () => {};
    },
  };
}
