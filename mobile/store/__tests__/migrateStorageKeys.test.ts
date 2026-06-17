// Tests for the one-time storage-key migration (brand rename grammar-dojo → relo_dojo).
//
// AsyncStorage is globally mocked (jest.setup.js → the official in-memory mock). expo-secure-store
// has no global mock, so we provide a tiny in-memory one here.
import AsyncStorage from "@react-native-async-storage/async-storage";

// In-memory SecureStore mock. Declared before the jest.mock factory; the factory closes over it.
const secureMem: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => (k in secureMem ? secureMem[k] : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    secureMem[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete secureMem[k];
  }),
}));

import { migrateStorageKeys } from "../migrateStorageKeys";

// The old → new pairs the migration must move (mirrors migrateStorageKeys.ts; asserted explicitly so
// a drift in either list is caught here).
const ASYNC_PAIRS: Array<[string, string]> = [
  ["grammar-dojo/guest-limit/v1", "relo_dojo/guest-limit/v1"],
  ["grammar-dojo/mistakes/v1", "relo_dojo/mistakes/v1"],
  ["grammar-dojo/progress/v1", "relo_dojo/progress/v1"],
  ["grammar-dojo/lang/v1", "relo_dojo/lang/v1"],
  ["grammar-dojo/reviewHook/v1", "relo_dojo/reviewHook/v1"],
  ["grammar-dojo/challenge-best/v1", "relo_dojo/challenge-best/v1"],
  ["grammar-dojo/journey/v1", "relo_dojo/journey/v1"],
  ["grammar-dojo/offers/v1", "relo_dojo/offers/v1"],
  ["grammar-dojo/register-wall/v1", "relo_dojo/register-wall/v1"],
  ["grammar-dojo/ui/theme", "relo_dojo/ui/theme"],
];
const TOKEN_OLD = "grammar_dojo_token";
const TOKEN_NEW = "relo_dojo_token";
const MIGRATED_FLAG = "relo_dojo/_migrated/v1";

const SecureStore = require("expo-secure-store");

beforeEach(async () => {
  await AsyncStorage.clear();
  for (const k of Object.keys(secureMem)) delete secureMem[k];
  jest.clearAllMocks();
});

describe("migrateStorageKeys", () => {
  test("migrates every old AsyncStorage key to its new key and clears the old one", async () => {
    // Seed each old key with a distinct value.
    for (const [oldKey] of ASYNC_PAIRS) {
      await AsyncStorage.setItem(oldKey, `val:${oldKey}`);
    }

    await migrateStorageKeys();

    for (const [oldKey, newKey] of ASYNC_PAIRS) {
      expect(await AsyncStorage.getItem(newKey)).toBe(`val:${oldKey}`); // copied to new
      expect(await AsyncStorage.getItem(oldKey)).toBeNull(); // old removed
    }
    // The once-flag is set.
    expect(await AsyncStorage.getItem(MIGRATED_FLAG)).toBe("1");
  });

  test("migrates the SecureStore token and deletes the old one", async () => {
    await SecureStore.setItemAsync(TOKEN_OLD, "jwt-abc");

    await migrateStorageKeys();

    expect(await SecureStore.getItemAsync(TOKEN_NEW)).toBe("jwt-abc");
    expect(await SecureStore.getItemAsync(TOKEN_OLD)).toBeNull();
  });

  test("does not clobber data already under a new key (new wins), but still clears the old", async () => {
    await AsyncStorage.setItem("grammar-dojo/progress/v1", "OLD");
    await AsyncStorage.setItem("relo_dojo/progress/v1", "NEW"); // new already populated
    await SecureStore.setItemAsync(TOKEN_OLD, "old-jwt");
    await SecureStore.setItemAsync(TOKEN_NEW, "new-jwt");

    await migrateStorageKeys();

    expect(await AsyncStorage.getItem("relo_dojo/progress/v1")).toBe("NEW"); // not overwritten
    expect(await AsyncStorage.getItem("grammar-dojo/progress/v1")).toBeNull(); // stale old cleaned up
    expect(await SecureStore.getItemAsync(TOKEN_NEW)).toBe("new-jwt"); // not overwritten
    expect(await SecureStore.getItemAsync(TOKEN_OLD)).toBeNull(); // stale old cleaned up
  });

  test("is a no-op on a second run (idempotent via the once-flag)", async () => {
    await AsyncStorage.setItem("grammar-dojo/lang/v1", "en");
    await SecureStore.setItemAsync(TOKEN_OLD, "jwt-1");

    await migrateStorageKeys(); // first run migrates
    expect(await AsyncStorage.getItem("relo_dojo/lang/v1")).toBe("en");
    expect(await AsyncStorage.getItem(MIGRATED_FLAG)).toBe("1");

    // Simulate post-migration drift: app re-writes the OLD key (it shouldn't, but prove we ignore it).
    await AsyncStorage.setItem("grammar-dojo/lang/v1", "ru");
    SecureStore.setItemAsync.mockClear();

    await migrateStorageKeys(); // second run must short-circuit on the flag

    // New key untouched by the second run; the (re-added) old key is left alone — no re-migration.
    expect(await AsyncStorage.getItem("relo_dojo/lang/v1")).toBe("en");
    expect(await AsyncStorage.getItem("grammar-dojo/lang/v1")).toBe("ru");
    // No SecureStore writes happened on the second (no-op) run.
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  test("does not throw when nothing is present (fresh install)", async () => {
    await expect(migrateStorageKeys()).resolves.toBeUndefined();
    // Flag still set so a fresh install also short-circuits next boot.
    expect(await AsyncStorage.getItem(MIGRATED_FLAG)).toBe("1");
    // No new keys fabricated.
    for (const [, newKey] of ASYNC_PAIRS) {
      expect(await AsyncStorage.getItem(newKey)).toBeNull();
    }
  });
});
