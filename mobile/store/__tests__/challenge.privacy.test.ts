import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureAccountScope, setAccountToken } from "../accountScope";
import { loadBestScore, recordBestScore } from "../challenge";

const token = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
const legacy = "relo_dojo/challenge-best/v1";
beforeEach(async () => { setAccountToken(null); await AsyncStorage.clear(); });
afterEach(() => { setAccountToken(null); jest.restoreAllMocks(); });

it("keeps member records separate without assigning the unowned legacy best to B", async () => {
  await AsyncStorage.setItem(legacy, "999");
  setAccountToken(token("a"));
  expect(await recordBestScore(50)).toEqual({ best: 50, isRecord: true });
  setAccountToken(token("b"));
  expect(await loadBestScore()).toBe(0);
  await recordBestScore(10);
  setAccountToken(token("a"));
  expect(await loadBestScore()).toBe(50);
  expect(await AsyncStorage.getItem(legacy)).toBe("999");
});

it("discards a late A read and never saves that score under B", async () => {
  setAccountToken(token("a"));
  const scopeA = captureAccountScope();
  let resolveA!: (value: string | null) => void;
  jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
  const pendingA = recordBestScore(90, scopeA);
  await Promise.resolve();
  await Promise.resolve();
  setAccountToken(token("b"));
  await recordBestScore(7);
  resolveA(null);
  expect(await pendingA).toEqual({ best: 0, isRecord: false });
  expect(await loadBestScore()).toBe(7);
  setAccountToken(token("a"));
  expect(await loadBestScore()).toBe(0);
});

it("serializes concurrent records so a slower lower result cannot overwrite the best", async () => {
  setAccountToken(token("a"));
  await Promise.all([recordBestScore(80), recordBestScore(20)]);
  expect(await loadBestScore()).toBe(80);
});
