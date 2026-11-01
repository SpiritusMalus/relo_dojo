import AsyncStorage from "@react-native-async-storage/async-storage";
import { setAccountToken } from "../accountScope";
import { loadJourney, recordJourneySession, resetJourney, saveJourney } from "../journey";

const token = (sub: string) => `header.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.signature`;
const legacy = "relo_dojo/journey/v1";
beforeEach(async () => { setAccountToken(null); await AsyncStorage.clear(); });
afterEach(() => { setAccountToken(null); jest.restoreAllMocks(); });

it("keeps A's journey across logout, isolates B and preserves unknown legacy without reading it", async () => {
  const unknown = JSON.stringify({ stage: "settled", sessions: 99 });
  await AsyncStorage.setItem(legacy, unknown);
  setAccountToken(token("a"));
  await saveJourney({ stage: "arrived", sessions: 5 });
  setAccountToken(null);
  await resetJourney();
  setAccountToken(token("b"));
  expect(await loadJourney()).toBeNull();
  await saveJourney({ stage: "pre_move", sessions: 1 });
  setAccountToken(token("a"));
  expect(await loadJourney()).toEqual({ stage: "arrived", sessions: 5 });
  expect(await AsyncStorage.getItem(legacy)).toBe(unknown);
});

it("does not resurrect A's late session write in B's namespace", async () => {
  setAccountToken(token("a"));
  let resolveA!: (value: string | null) => void;
  jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
  const pendingA = recordJourneySession(["interviews"]);
  // The serialized read starts in a microtask.
  await Promise.resolve();
  await Promise.resolve();
  setAccountToken(token("b"));
  await saveJourney({ stage: "settled", sessions: 3 });
  resolveA(JSON.stringify({ stage: "arrived", sessions: 8 }));
  await pendingA;
  expect(await loadJourney()).toEqual({ stage: "settled", sessions: 3 });
  setAccountToken(token("a"));
  expect(await loadJourney()).toBeNull();
});

it("serializes two completed sessions for the same owner instead of dropping one", async () => {
  setAccountToken(token("a"));
  await Promise.all([recordJourneySession(["interviews"]), recordJourneySession(["interviews"])]);
  expect(await loadJourney()).toEqual({ stage: "pre_move", sessions: 2 });
});
