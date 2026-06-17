// One-time storage-key migration (brand rename grammar-dojo → relo_dojo).
//
// The app's persisted device keys were renamed from the old "grammar-dojo/..." (AsyncStorage) and
// "grammar_dojo_token" (SecureStore) namespace to the new "relo_dojo/..." one. Existing installs
// already hold data under the OLD keys, so on first boot after the rename we copy each old value to
// its new key (only when the new key is still empty), then delete the old one. Without this an
// update would silently reset progress, language, streak-repair charms, the saved login, etc.
//
// Contract (per the rename brief):
//  - For each (oldKey → newKey) pair: copy old→new ONLY if `new` is empty AND `old` exists, then
//    remove `old`. Never overwrite data already written under the new key.
//  - Idempotent: a once-flag ("relo_dojo/_migrated/v1") makes subsequent boots a no-op.
//  - Never throws — a missing key, or any storage error, is swallowed so boot can't be blocked by it.
//
// Call this during app boot BEFORE any store/provider reads its key (see app/_layout.tsx, which
// awaits it behind the splash gate so AuthProvider/ProgressProvider/I18nProvider/ThemeProvider all
// see the migrated values on their first mount).
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Flag remembered once the migration has run, so it no-ops on every later boot.
const MIGRATED_FLAG = "relo_dojo/_migrated/v1";

// AsyncStorage key renames: old "grammar-dojo/..." → new "relo_dojo/...". Keep this list in sync
// with the STORAGE_KEY constants in the store modules (and theme.ts's THEME_KEY).
const ASYNC_KEY_PAIRS: ReadonlyArray<readonly [oldKey: string, newKey: string]> = [
  ["grammar-dojo/guest-limit/v1", "relo_dojo/guest-limit/v1"], // store/guestLimit.ts
  ["grammar-dojo/mistakes/v1", "relo_dojo/mistakes/v1"], // store/mistakes.ts
  ["grammar-dojo/progress/v1", "relo_dojo/progress/v1"], // store/progress.tsx
  ["grammar-dojo/lang/v1", "relo_dojo/lang/v1"], // store/i18n.tsx
  ["grammar-dojo/reviewHook/v1", "relo_dojo/reviewHook/v1"], // store/reviewHook.ts
  ["grammar-dojo/challenge-best/v1", "relo_dojo/challenge-best/v1"], // store/challenge.ts
  ["grammar-dojo/journey/v1", "relo_dojo/journey/v1"], // store/journey.ts
  ["grammar-dojo/offers/v1", "relo_dojo/offers/v1"], // store/offers.ts
  ["grammar-dojo/register-wall/v1", "relo_dojo/register-wall/v1"], // store/registerWall.ts
  ["grammar-dojo/ui/theme", "relo_dojo/ui/theme"], // theme/theme.ts (THEME_KEY)
];

// SecureStore token rename (SecureStore keys allow only [A-Za-z0-9._-], so no "/").
const SECURE_TOKEN_OLD = "grammar_dojo_token";
const SECURE_TOKEN_NEW = "relo_dojo_token";

/** Move one AsyncStorage value old→new if new is empty and old exists, then drop old. Never throws. */
async function migrateAsyncKey(oldKey: string, newKey: string): Promise<void> {
  try {
    const existingNew = await AsyncStorage.getItem(newKey);
    if (existingNew !== null) {
      // New key already has data — don't clobber it. Still clean up a stale old copy if present.
      const oldVal = await AsyncStorage.getItem(oldKey);
      if (oldVal !== null) await AsyncStorage.removeItem(oldKey);
      return;
    }
    const oldVal = await AsyncStorage.getItem(oldKey);
    if (oldVal === null) return; // nothing to migrate
    await AsyncStorage.setItem(newKey, oldVal);
    await AsyncStorage.removeItem(oldKey);
  } catch {
    // Best-effort: a single key failing must not block boot or the other keys.
  }
}

/** Move the SecureStore token old→new under the same copy-then-delete contract. Never throws. */
async function migrateSecureToken(): Promise<void> {
  try {
    const existingNew = await SecureStore.getItemAsync(SECURE_TOKEN_NEW);
    if (existingNew !== null && existingNew !== undefined) {
      const oldVal = await SecureStore.getItemAsync(SECURE_TOKEN_OLD);
      if (oldVal !== null && oldVal !== undefined) await SecureStore.deleteItemAsync(SECURE_TOKEN_OLD);
      return;
    }
    const oldVal = await SecureStore.getItemAsync(SECURE_TOKEN_OLD);
    if (oldVal === null || oldVal === undefined) return;
    await SecureStore.setItemAsync(SECURE_TOKEN_NEW, oldVal);
    await SecureStore.deleteItemAsync(SECURE_TOKEN_OLD);
  } catch {
    // Best-effort: worst case the user re-logs in once.
  }
}

/**
 * Idempotent one-time migration of all renamed persisted keys. Safe to call on every boot: it
 * checks a once-flag first and returns immediately on subsequent runs. Never throws.
 */
export async function migrateStorageKeys(): Promise<void> {
  try {
    const done = await AsyncStorage.getItem(MIGRATED_FLAG);
    if (done === "1") return; // already migrated on a previous boot
  } catch {
    // If we can't even read the flag, fall through and attempt the (idempotent) migration anyway.
  }

  for (const [oldKey, newKey] of ASYNC_KEY_PAIRS) {
    await migrateAsyncKey(oldKey, newKey);
  }
  await migrateSecureToken();

  try {
    await AsyncStorage.setItem(MIGRATED_FLAG, "1");
  } catch {
    // If the flag write fails the migration simply re-runs next boot — still correct (idempotent):
    // the new keys now hold the data, so each pair's "new is empty" check skips the copy.
  }
}
