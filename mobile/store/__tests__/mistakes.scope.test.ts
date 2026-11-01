import AsyncStorage from "@react-native-async-storage/async-storage";
import { setAuthToken, type Exercise } from "../../services/api";
import { captureAccountScope } from "../accountScope";
import {
  captureMistake, dueCount, dueMistakes, loadMistakes, mistakeHintsForTopic, mistakeId,
  MISTAKES_LEGACY_ARCHIVE_KEY, nextDueAt, promoteMistakeStored, resolveMistake,
} from "../mistakes";

const nativeGet = (AsyncStorage.getItem as jest.Mock).getMockImplementation()!;
const nativeSet = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
const token = (id: string, nonce = "one") => `header.${Buffer.from(JSON.stringify({ sub: id, nonce })).toString("base64url")}.signature`;
const ownerKey = (id: string) => `relo_dojo/mistakes/v2/${encodeURIComponent(`user:${id}`)}`;
const exercise = (text: string): Exercise => ({ type: "multiple-choice", topic: "articles", level: "B1", text,
  prompt: "", options: ["a", "an"], tiles: [], tokens: [], left: [], right: [], blankOptions: [], token: "sealed-exercise" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(nativeGet);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(nativeSet);
  await AsyncStorage.clear();
  setAuthToken(null);
});
afterEach(() => {
  (AsyncStorage.getItem as jest.Mock).mockImplementation(nativeGet);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(nativeSet);
  setAuthToken(null);
});

it("keeps A→B→A decks independent, with a separate guest and no bearer in any storage key", async () => {
  const guest = exercise("Guest ___ example.");
  const a = exercise("A has ___ owl.");
  const b = exercise("B has ___ idea.");
  await captureMistake(guest);
  const jwtA = token("account-a");
  setAuthToken(jwtA);
  expect(await loadMistakes()).toEqual([]);
  await captureMistake(a);
  setAuthToken(token("account-b"));
  expect(await loadMistakes()).toEqual([]);
  expect(await dueCount()).toBe(0);
  await captureMistake(b);
  setAuthToken(token("account-a", "refreshed-token"));
  expect((await loadMistakes()).map((item) => item.exercise.text)).toEqual([a.text]);
  setAuthToken(null);
  expect((await loadMistakes()).map((item) => item.exercise.text)).toEqual([guest.text]);
  const keys = await AsyncStorage.getAllKeys();
  expect(keys).toEqual(expect.arrayContaining([ownerKey("account-a"), ownerKey("account-b"), "relo_dojo/mistakes/v2/guest"]));
  expect(JSON.stringify(keys)).not.toContain(jwtA);
});

it("quarantines ownerless v1 bytes without assigning them to the current account or deleting them", async () => {
  const legacy = JSON.stringify([{ private: "unowned historical content" }]);
  await AsyncStorage.setItem("relo_dojo/mistakes/v1", legacy);
  setAuthToken(token("b"));
  expect(await loadMistakes()).toEqual([]);
  expect(await AsyncStorage.getItem(MISTAKES_LEGACY_ARCHIVE_KEY)).toBe(legacy);
  expect(await AsyncStorage.getItem("relo_dojo/mistakes/v1")).toBe(legacy);
  setAuthToken(token("a"));
  expect(await loadMistakes()).toEqual([]);
  setAuthToken(null);
  expect(await loadMistakes()).toEqual([]);
});

it("serializes concurrent mutations so two misses cannot overwrite each other", async () => {
  setAuthToken(token("a"));
  await Promise.all([captureMistake(exercise("First ___ item.")), captureMistake(exercise("Second ___ item."))]);
  expect((await loadMistakes()).map((item) => item.exercise.text)).toEqual(["Second ___ item.", "First ___ item."]);
});

it("drops a late A read and refuses old A hints immediately after switching to B", async () => {
  setAuthToken(token("a"));
  await captureMistake(exercise("A private ___ example."));
  const loaded = await loadMistakes();
  const due = dueMistakes(loaded, new Date().toISOString());
  const rawA = await AsyncStorage.getItem(ownerKey("a"));
  const started = deferred<void>();
  const read = deferred<string | null>();
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === ownerKey("a")) { started.resolve(); return read.promise; }
    return nativeGet(key);
  });
  const staleScope = captureAccountScope();
  const pending = loadMistakes(staleScope);
  await started.promise;
  setAuthToken(token("b"));
  expect(mistakeHintsForTopic(loaded, "articles")).toEqual([]);
  expect(mistakeHintsForTopic(due, "articles")).toEqual([]);
  expect(dueMistakes(loaded, new Date().toISOString())).toEqual([]);
  expect(nextDueAt(loaded, new Date().toISOString())).toBeNull();
  expect(await loadMistakes()).toEqual([]);
  read.resolve(rawA);
  expect(await pending).toEqual([]);
  await captureMistake(exercise("Late A capture."), staleScope);
  expect(await loadMistakes()).toEqual([]);
});

it("an already-dispatched A native write can finish only under A's captured key", async () => {
  setAuthToken(token("a"));
  const started = deferred<void>();
  const release = deferred<void>();
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    if (key === ownerKey("a")) { started.resolve(); await release.promise; }
    return nativeSet(key, value);
  });
  const pendingA = captureMistake(exercise("A late ___ write."));
  await started.promise;
  setAuthToken(token("b"));
  await captureMistake(exercise("B current ___ item."));
  expect((await loadMistakes()).map((item) => item.exercise.text)).toEqual(["B current ___ item."]);
  setAuthToken(token("a", "new-session"));
  const restoredA = loadMistakes(); // waits for the older A write, rather than racing it
  release.resolve();
  await pendingA;
  expect((await restoredA).map((item) => item.exercise.text)).toEqual(["A late ___ write."]);
});

it.each([promoteMistakeStored, resolveMistake])("a stale review mutation cannot promote/remove B's same-id card", async (mutate) => {
  const card = exercise("Shared ___ wording.");
  setAuthToken(token("a"));
  await captureMistake(card);
  const scopeA = captureAccountScope();
  const rawA = await AsyncStorage.getItem(ownerKey("a"));
  const started = deferred<void>();
  const read = deferred<string | null>();
  (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
    if (key === ownerKey("a")) { started.resolve(); return read.promise; }
    return nativeGet(key);
  });
  const pending = mutate(mistakeId(card), scopeA);
  await started.promise;
  setAuthToken(token("b"));
  await captureMistake(card);
  read.resolve(rawA);
  await pending;
  await mutate(mistakeId(card), scopeA); // even a delayed callback invoked under B stays pinned
  expect(await loadMistakes()).toEqual([expect.objectContaining({ id: mistakeId(card), box: 0, misses: 1 })]);
});

it("does not borrow guest data while a signed-in opaque token has no resolved identity", async () => {
  await captureMistake(exercise("Guest private ___ item."));
  setAuthToken("opaque-auth-token");
  expect(captureAccountScope().owner).toBeNull();
  expect(await loadMistakes()).toEqual([]);
  await captureMistake(exercise("Unresolved account ___ item."));
  setAuthToken(null);
  expect((await loadMistakes()).map((item) => item.exercise.text)).toEqual(["Guest private ___ item."]);
});
