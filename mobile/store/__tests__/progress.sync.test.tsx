import { useState } from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_PROGRESS, PROGRESS_LEGACY_ARCHIVE_KEY, ProgressProvider, useProgress, type Progress } from "../progress";
import { putProgress, setAuthToken } from "../../services/api";
import { captureAccountScope } from "../accountScope";

const jwt = (id: string) => `header.${Buffer.from(JSON.stringify({ sub: id })).toString("base64url")}.signature`;
const TOKEN_A = jwt("a");
const TOKEN_B = jwt("b");
let mockToken: string | null = TOKEN_A;
let mockReady = true;
jest.mock("../auth", () => ({ useAuth: () => ({ token: mockToken, ready: mockReady }) }));
jest.mock("../wallet", () => ({ useWallet: () => ({ freezes: 0, ready: false, spend: jest.fn() }) }));
jest.mock("../registerWall", () => ({ resetWall: jest.fn(async () => {}) }));
jest.mock("../guestLimit", () => ({ resetGuestLimit: jest.fn(async () => {}) }));
jest.mock("../journey", () => ({ resetJourney: jest.fn(async () => {}) }));
jest.mock("../reviewHook", () => ({ resetReviewHook: jest.fn(async () => {}) }));

const LEGACY_KEY = "relo_dojo/progress/v1";
const key = (owner: string) => `relo_dojo/progress/v2/${encodeURIComponent(owner)}`;
const seed = (owner: string, progress: Progress) => AsyncStorage.setItem(key(owner), JSON.stringify({ owner, progress }));
const saved = async (owner: string): Promise<Progress> => JSON.parse((await AsyncStorage.getItem(key(owner)))!).progress;
const A: Progress = { ...DEFAULT_PROGRESS, onboarded: true, xp: 90, beltEarned: 3, topics: { articles: { attempts: 9, correct: 9, recent: [{ score: 1, difficulty: 1.5, format: "multiple-choice" }] } }, skill: { articles: 2 } };
const B: Progress = { ...DEFAULT_PROGRESS, onboarded: true, xp: 20, topics: { vocabulary: { attempts: 2, correct: 2 } }, skill: { vocabulary: 1 } };
let store!: ReturnType<typeof useProgress>;
let rerender!: () => void;
const renders: Array<{ owner: string | null; xp: number; ready: boolean }> = [];
function Harness() { store = useProgress(); renders.push({ owner: captureAccountScope().owner, xp: store.progress.xp, ready: store.ready }); return null; }
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
const flush = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); }); };
async function mount() { await act(async () => { renderer = TestRenderer.create(<Root />); }); await flush(); }
async function changeSession(token: string | null) {
  await act(async () => { setAuthToken(token); mockToken = token; rerender(); });
  await flush();
}
async function resolveGet(token: string, snapshot: Progress) {
  const request = pending.find((p) => p.token === `Bearer ${token}`)!;
  expect(request).toBeDefined();
  pending.splice(pending.indexOf(request), 1);
  await act(async () => { request.resolve(response(snapshot)); });
  await flush();
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  pending.length = 0;
  puts.length = 0;
  renders.length = 0;
  mockReady = true;
  mockToken = TOKEN_A;
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
  await seed("user:a", A);
  await mount();
  expect(pending).toHaveLength(1);
  await changeSession(null);
  await changeSession(TOKEN_B);
  await resolveGet(TOKEN_A, A);
  expect(puts).toHaveLength(0);
  await resolveGet(TOKEN_B, B);
  expect(store.progress.topics.articles).toBeUndefined();
  expect(store.progress.topics.vocabulary.attempts).toBe(2);
  expect(puts).toHaveLength(1);
  expect(puts[0].token).toBe(`Bearer ${TOKEN_B}`);
  expect(puts[0].snapshot.topics.articles).toBeUndefined();
  expect((await saved("user:b")).topics.articles).toBeUndefined();
  expect((await saved("user:b")).topics.vocabulary.attempts).toBe(2);
  expect((await saved("user:a")).xp).toBe(90);
});

it("an old debounce firing before React sees the new token cannot write with B's bearer", async () => {
  await mount();
  await resolveGet(TOKEN_A, A);
  expect(puts).toHaveLength(1);
  act(() => { store.recordAnswer("articles", true); });
  // Auth.apply changes the API token synchronously, before provider props/effects run.
  act(() => { setAuthToken(TOKEN_B); });
  await act(async () => { jest.advanceTimersByTime(1200); });
  expect(puts).toHaveLength(1);
  await expect(putProgress(A, TOKEN_A)).rejects.toMatchObject({ code: "session_changed" });
  expect(puts).toHaveLength(1);
  mockToken = TOKEN_B;
  await act(async () => rerender());
  await flush();
  await resolveGet(TOKEN_B, B);
  expect(puts[1].token).toBe(`Bearer ${TOKEN_B}`);
  expect(puts[1].snapshot.topics.articles).toBeUndefined();
});

it("preserves newer local answers and their recent evidence when a current-account snapshot merges", async () => {
  await seed("user:a", A);
  await mount();
  act(() => { store.recordAnswer("articles", false, { score: 0, difficulty: 2.5, format: "build-the-sentence", elapsedMs: 12_000 }); });
  await resolveGet(TOKEN_A, { ...A, topics: { articles: { attempts: 8, correct: 8 } } });
  expect(store.progress.topics.articles.attempts).toBe(10);
  expect(store.progress.topics.articles.recent).toHaveLength(2);
  expect(puts[0].snapshot.topics.articles.recent?.[1]).toMatchObject({ score: 0, difficulty: 2.5, elapsedMs: 12_000 });
});

it("a slow native A write never replaces B's separate durable owner cache", async () => {
  const setItem = AsyncStorage.setItem as jest.Mock;
  const nativeWrite = setItem.getMockImplementation()!;
  let release!: () => void;
  let blocked = false;
  setItem.mockImplementation((key: string, value: string) => {
    if (key === "relo_dojo/progress/v2/user%3Aa" && JSON.parse(value).progress.topics.articles && !blocked) {
      blocked = true;
      return new Promise<void>((resolve) => { release = () => { nativeWrite(key, value).then(resolve); }; });
    }
    return nativeWrite(key, value);
  });
  try {
    await mount();
    await resolveGet(TOKEN_A, A);
    expect(blocked).toBe(true);
    expect(puts).toHaveLength(0); // A's reconcile is still saving to native storage
    await changeSession(null);
    await changeSession(TOKEN_B);
    expect(store.progress).toEqual(DEFAULT_PROGRESS);
    await act(async () => { release(); });
    await flush();
    await resolveGet(TOKEN_B, B);
    expect((await saved("user:b")).topics.articles).toBeUndefined();
    expect((await saved("user:b")).topics.vocabulary.attempts).toBe(2);
    expect((await saved("user:a")).xp).toBe(90);
    expect(puts).toHaveLength(1);
    expect(puts[0].token).toBe(`Bearer ${TOKEN_B}`);
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
  const cached = { ...A, beltEarned: earned } as unknown as Progress;
  await seed("guest", cached);
  await mount();
  expect(store.progress.beltEarned).toBe(earned ?? 0);
});

it("restart with B's token never renders or uploads A's cache, an unowned v1 cache, or a durable guest cache", async () => {
  const legacy = JSON.stringify(A);
  await seed("user:a", A);
  await seed("guest", A);
  await AsyncStorage.setItem(LEGACY_KEY, legacy);
  mockToken = TOKEN_B;
  setAuthToken(TOKEN_B);
  await mount();
  expect(store.progress).toEqual(DEFAULT_PROGRESS);
  expect(renders.filter((render) => render.owner === "user:b").every((render) => render.xp === 0)).toBe(true);
  await resolveGet(TOKEN_B, B);
  expect(store.progress.xp).toBe(20);
  expect(store.progress.topics.articles).toBeUndefined();
  expect(puts.every((put) => put.snapshot.topics.articles === undefined)).toBe(true);
  expect((await saved("user:a")).beltEarned).toBe(3);
  expect((await saved("guest")).xp).toBe(90);
  expect(await AsyncStorage.getItem(PROGRESS_LEGACY_ARCHIVE_KEY)).toBe(legacy);
  expect(await AsyncStorage.getItem(LEGACY_KEY)).toBe(legacy);
});

it("cold auth startup cannot claim durable guest progress before a saved B session resolves", async () => {
  await seed("guest", A);
  await seed("user:a", A);
  mockReady = false;
  mockToken = null;
  setAuthToken(null);
  await mount();
  expect(store.ready).toBe(false);
  expect(store.progress.xp).toBe(0);
  mockReady = true;
  await changeSession(TOKEN_B);
  await resolveGet(TOKEN_B, DEFAULT_PROGRESS);
  expect(store.progress.xp).toBe(0);
  expect(puts[0].snapshot.xp).toBe(0);
  expect((await saved("guest")).xp).toBe(90);
});

it("claims a known live guest once for A and restores A→B→A XP and numeric awards independently", async () => {
  mockToken = null;
  setAuthToken(null);
  await seed("guest", A);
  await mount();
  expect(store.progress.xp).toBe(90);
  await changeSession(TOKEN_A);
  await resolveGet(TOKEN_A, DEFAULT_PROGRESS);
  expect(store.progress.xp).toBe(90);
  expect(store.progress.beltEarned).toBe(3);
  await changeSession(null);
  expect(store.progress.xp).toBe(0); // claimed data is no longer the anonymous working snapshot
  await changeSession(TOKEN_B);
  await resolveGet(TOKEN_B, B);
  expect(store.progress.xp).toBe(20);
  expect(store.progress.topics.articles).toBeUndefined();
  await changeSession(TOKEN_A);
  expect(store.progress.xp).toBe(90); // durable A cache is available before its server GET completes
  await resolveGet(TOKEN_A, DEFAULT_PROGRESS);
  expect(store.progress.xp).toBe(90);
  expect(store.progress.beltEarned).toBe(3);
  expect((await saved("user:b")).xp).toBe(20);
  const keys = JSON.stringify(await AsyncStorage.getAllKeys());
  expect(keys).not.toContain(TOKEN_A);
  expect(keys).not.toContain(TOKEN_B);
});

it("recovers an interrupted guest claim only for its pinned account after restart", async () => {
  mockToken = null;
  setAuthToken(null);
  await seed("guest", A);
  await mount();
  const setItem = AsyncStorage.setItem as jest.Mock;
  const nativeWrite = setItem.getMockImplementation()!;
  setItem.mockImplementation((storageKey: string, value: string) => storageKey === key("user:a")
    ? Promise.reject(new Error("simulated interruption before account cache write")) : nativeWrite(storageKey, value));
  try {
    await changeSession(TOKEN_A);
    await flush();
    const guest = JSON.parse((await AsyncStorage.getItem(key("guest")))!);
    expect(guest.progress.xp).toBe(0);
    expect(guest.pendingClaims["user:a"].progress.xp).toBe(90);
    act(() => renderer!.unmount());
    renderer = undefined;
    pending.length = 0; // the terminated process cannot return the original network request
    setItem.mockImplementation(nativeWrite);
    mockToken = TOKEN_B;
    setAuthToken(TOKEN_B);
    await mount();
    await resolveGet(TOKEN_B, B);
    expect(store.progress.xp).toBe(20);
    expect(store.progress.beltEarned).toBe(0);
    act(() => renderer!.unmount());
    renderer = undefined;
    pending.length = 0;
    mockToken = TOKEN_A;
    setAuthToken(TOKEN_A);
    await mount();
    expect(store.progress.xp).toBe(90);
    expect(store.progress.beltEarned).toBe(3);
    await flush();
    expect((await saved("user:a")).xp).toBe(90);
    expect(JSON.parse((await AsyncStorage.getItem(key("guest")))!).pendingClaims["user:a"]).toBeUndefined();
  } finally {
    setItem.mockImplementation(nativeWrite);
  }
});

it("held A reward/profile/test callbacks cannot mutate or submit B's current progress", async () => {
  const profile = { goals: [], focusTopics: [], selfLevel: "advanced", dailyMinutes: 10, sphere: "", domains: [], painText: "" };
  await seed("user:a", { ...A, profile });
  await seed("user:b", { ...B, profile });
  await mount();
  await resolveGet(TOKEN_A, { ...A, profile });
  const old = store;
  await changeSession(TOKEN_B);
  await resolveGet(TOKEN_B, { ...B, profile });
  const before = JSON.stringify(store.progress);
  const fetches = (global.fetch as jest.Mock).mock.calls.length;
  act(() => {
    old.activateBoost();
    expect(old.recordAnswer("articles", true)).toEqual(DEFAULT_PROGRESS);
    old.recordExamResult(true, 5, "2026-11-01");
    old.applyLevelTest({ articles: 5 }, 5, "2026-11-01");
    old.awardQuestBonus(999, { painText: "A private patch" });
    old.completeOnboarding(profile, { articles: 5 });
    old.updateProfile({ sphere: "A private sphere" });
    old.masterUnit("articles");
    old.resetOnboarding();
    old.setSteering({ ...DEFAULT_PROGRESS.steering, mutedTopics: ["articles"] });
    old.dismissBrokenStreak();
  });
  await act(async () => { await old.repairStreak(); });
  act(() => { jest.advanceTimersByTime(1500); });
  await flush();
  expect(JSON.stringify(store.progress)).toBe(before);
  expect(JSON.stringify(await saved("user:b"))).toBe(before);
  expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetches);
  expect((await saved("user:a")).beltEarned).toBe(3);
});

it("discards a delayed native A cache read without exposing A during B's first render", async () => {
  await seed("user:a", A);
  await seed("user:b", B);
  const getItem = AsyncStorage.getItem as jest.Mock;
  const nativeRead = getItem.getMockImplementation()!;
  let release!: () => void;
  getItem.mockImplementation((storageKey: string) => storageKey === key("user:a")
    ? new Promise<string | null>((resolve) => { release = () => { nativeRead(storageKey).then(resolve); }; }) : nativeRead(storageKey));
  try {
    await mount();
    expect(release).toBeDefined();
    await changeSession(TOKEN_B);
    expect(store.progress.xp).toBe(0);
    expect(store.ready).toBe(false);
    await act(async () => { release(); });
    await flush();
    expect(store.progress.xp).toBe(20);
    expect(renders.filter((render) => render.owner === "user:b").some((render) => render.xp === 90)).toBe(false);
    await resolveGet(TOKEN_B, B);
    expect(puts[0].snapshot.topics.articles).toBeUndefined();
  } finally {
    getItem.mockImplementation(nativeRead);
  }
});
