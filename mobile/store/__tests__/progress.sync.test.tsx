import { useState } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_PROGRESS, ProgressProvider, useProgress, type Progress } from "../progress";
import { putProgress, setAuthToken } from "../../services/api";

let mockToken: string | null = "session-a";
jest.mock("../auth", () => ({ useAuth: () => ({ token: mockToken, ready: true }) }));
jest.mock("../wallet", () => ({ useWallet: () => ({ freezes: 0, ready: false, spend: jest.fn() }) }));
jest.mock("../registerWall", () => ({ resetWall: jest.fn(async () => {}) }));
jest.mock("../guestLimit", () => ({ resetGuestLimit: jest.fn(async () => {}) }));
jest.mock("../journey", () => ({ resetJourney: jest.fn(async () => {}) }));
jest.mock("../reviewHook", () => ({ resetReviewHook: jest.fn(async () => {}) }));

const STORAGE_KEY = "relo_dojo/progress/v1";
const A: Progress = { ...DEFAULT_PROGRESS, onboarded: true, xp: 90, topics: { articles: { attempts: 9, correct: 9, recent: [{ score: 1, difficulty: 1.5, format: "multiple-choice" }] } }, skill: { articles: 2 } };
const B: Progress = { ...DEFAULT_PROGRESS, onboarded: true, xp: 20, topics: { vocabulary: { attempts: 2, correct: 2 } }, skill: { vocabulary: 1 } };
let store!: ReturnType<typeof useProgress>;
let rerender!: () => void;
function Harness() { store = useProgress(); return null; }
function Root() {
  const [, force] = useState(0);
  rerender = () => force((n) => n + 1);
  return <ProgressProvider><Harness /></ProgressProvider>;
}
let renderer: ReactTestRenderer | undefined;
const originalFetch = global.fetch;
const pending: Array<{ token: string; resolve: (response: Response) => void }> = [];
const puts: Array<{ token: string; snapshot: Progress }> = [];
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
async function mount() { await act(async () => { renderer = TestRenderer.create(<Root />); }); }
async function changeSession(token: string | null) {
  setAuthToken(token);
  mockToken = token;
  await act(async () => rerender());
}
async function resolveGet(token: string, snapshot: Progress) {
  const request = pending.find((p) => p.token === `Bearer ${token}`)!;
  await act(async () => { request.resolve(response(snapshot)); });
  await flush();
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  pending.length = 0;
  puts.length = 0;
  mockToken = "session-a";
  setAuthToken(mockToken);
  global.fetch = jest.fn((_url, init) => {
    const token = (init?.headers as Record<string, string>).Authorization;
    if (init?.method === "GET") return new Promise<Response>((resolve) => { pending.push({ token, resolve }); });
    const snapshot = JSON.parse(String(init?.body)) as Progress;
    puts.push({ token, snapshot });
    return Promise.resolve(response(snapshot));
  });
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  setAuthToken(null);
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it("drops a deferred A response after logout/B login without contaminating B's cache or PUT", async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(A));
  await mount();
  expect(pending).toHaveLength(1);
  await changeSession(null);
  await changeSession("session-b");
  await resolveGet("session-a", A);
  expect(puts).toHaveLength(0);
  await resolveGet("session-b", B);
  expect(store.progress.topics.articles).toBeUndefined();
  expect(store.progress.topics.vocabulary.attempts).toBe(2);
  expect(puts).toHaveLength(1);
  expect(puts[0].token).toBe("Bearer session-b");
  expect(puts[0].snapshot.topics.articles).toBeUndefined();
  const saved = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!);
  expect(saved.topics.articles).toBeUndefined();
  expect(saved.topics.vocabulary.attempts).toBe(2);
});

it("an old debounce firing before React sees the new token cannot write with B's bearer", async () => {
  await mount();
  await resolveGet("session-a", A);
  expect(puts).toHaveLength(1);
  act(() => { store.recordAnswer("articles", true); });
  // Auth.apply changes the API token synchronously, before provider props/effects run.
  setAuthToken("session-b");
  await act(async () => { jest.advanceTimersByTime(1200); });
  expect(puts).toHaveLength(1);
  await expect(putProgress(A, "session-a")).rejects.toMatchObject({ code: "session_changed" });
  expect(puts).toHaveLength(1);
  mockToken = "session-b";
  await act(async () => rerender());
  await resolveGet("session-b", B);
  expect(puts[1].token).toBe("Bearer session-b");
  expect(puts[1].snapshot.topics.articles).toBeUndefined();
});

it("preserves newer local answers and their recent evidence when a current-account snapshot merges", async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(A));
  await mount();
  act(() => { store.recordAnswer("articles", false, { score: 0, difficulty: 2.5, format: "build-the-sentence", elapsedMs: 12_000 }); });
  await resolveGet("session-a", { ...A, topics: { articles: { attempts: 8, correct: 8 } } });
  expect(store.progress.topics.articles.attempts).toBe(10);
  expect(store.progress.topics.articles.recent).toHaveLength(2);
  expect(puts[0].snapshot.topics.articles.recent?.[1]).toMatchObject({ score: 0, difficulty: 2.5, elapsedMs: 12_000 });
});

it("a slow native cache write from A finishes before B's replacement, never overwriting it later", async () => {
  const setItem = AsyncStorage.setItem as jest.Mock;
  const nativeWrite = setItem.getMockImplementation()!;
  let release!: () => void;
  let blocked = false;
  setItem.mockImplementation((key: string, value: string) => {
    if (key === STORAGE_KEY && JSON.parse(value).topics.articles && !blocked) {
      blocked = true;
      return new Promise<void>((resolve) => { release = () => { nativeWrite(key, value).then(resolve); }; });
    }
    return nativeWrite(key, value);
  });
  try {
    await mount();
    await resolveGet("session-a", A);
    expect(blocked).toBe(true);
    expect(puts).toHaveLength(0); // A's reconcile is still saving to native storage
    await changeSession(null);
    await changeSession("session-b");
    await resolveGet("session-b", B);
    await act(async () => { release(); });
    await flush();
    const saved = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!);
    expect(saved.topics.articles).toBeUndefined();
    expect(saved.topics.vocabulary.attempts).toBe(2);
    expect(puts).toHaveLength(1);
    expect(puts[0].token).toBe("Bearer session-b");
  } finally {
    setItem.mockImplementation(nativeWrite);
  }
});

it("a fresh guest keeps White after a high warm-up seed and a 9/10 lesson until an exam is passed", async () => {
  mockToken = null;
  setAuthToken(null);
  await mount();
  expect(store.progress.beltEarned).toBe(0);
  const { TOPIC_PRIORS } = require("../adaptive");
  const { beltProgress } = require("../dojo");
  const { examOffer } = require("../exam");
  const profile = { goals: [], focusTopics: [], selfLevel: "advanced", dailyMinutes: 10,
    sphere: "", domains: [], painText: "" };
  const seeded = Object.fromEntries(Object.keys(TOPIC_PRIORS).map((topic) => [topic, 3.9]));
  act(() => { store.completeOnboarding(profile, seeded); });
  expect(store.progress.beltEarned).toBe(0);
  for (let i = 0; i < 10; i++) {
    act(() => { store.recordAnswer("word order", i < 9, { format: "multiple-choice", difficulty: 3.5 }); });
  }
  expect(store.progress.xp).toBe(110);
  expect(store.progress.topics["word order"].attempts).toBe(10);
  expect(beltProgress(store.progress).belt.idx).toBe(0);
  expect(examOffer(store.progress)).toEqual({ target: 1, confirm: false });
  act(() => { store.recordExamResult(true, 1, "2026-11-01"); });
  expect(beltProgress(store.progress).belt.idx).toBe(1);
  // The explicit full Level Test award remains its existing, separate contract.
  act(() => { store.applyLevelTest(seeded, 3, "2026-11-01"); });
  expect(beltProgress(store.progress).belt.idx).toBe(3);
});

it.each([undefined, null, 3])("hydrates missing/null earned belts conservatively while preserving numeric awards: %s", async (earned) => {
  mockToken = null;
  setAuthToken(null);
  const cached = { ...A, beltEarned: earned };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  await mount();
  expect(store.progress.beltEarned).toBe(earned ?? 0);
});
