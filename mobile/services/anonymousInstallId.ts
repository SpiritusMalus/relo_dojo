import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "gd.analytics.anon";
let pending: Promise<string> | undefined;

/** One stable anonymous ID even if analytics and a lesson initialize concurrently. */
export function anonymousInstallId(): Promise<string> {
  pending ??= (async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
    if (stored) return stored;
    const id = `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
    return id;
  })();
  return pending;
}
