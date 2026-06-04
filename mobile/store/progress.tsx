// Progress & gamification store (Phase 3 local; Phase 4 backend sync).
//
// AsyncStorage is the working cache (offline-safe). When logged in, the store also syncs with the
// server: on login it pulls the server snapshot, merges by max with local, and pushes the result;
// later changes are pushed (debounced). The update logic stays a pure function (`recordAnswer`).
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getProgress, putProgress } from "../services/api";
import { useAuth } from "./auth";
import { updateSkill } from "./adaptive";

const STORAGE_KEY = "grammar-dojo/progress/v1";

export const XP_PER_CORRECT = 10;
export const XP_PER_LEVEL = 100;

export type TopicStat = { attempts: number; correct: number };

export type Profile = {
  goals: string[];
  focusTopics: string[];
  selfLevel: string; // beginner | intermediate | advanced
  dailyMinutes: number;
  domain: string;
  painText: string;
};

export type Progress = {
  xp: number;
  dailyStreak: number;
  lastActiveDate: string; // local YYYY-MM-DD, "" if never
  currentCorrectRun: number;
  bestCorrectRun: number;
  topics: Record<string, TopicStat>;
  achievements: string[]; // unlocked ids
  skill: Record<string, number>; // per-topic adaptive level (0..5), see store/adaptive.ts
  onboarded: boolean;
  profile: Profile | null;
};

export const DEFAULT_PROGRESS: Progress = {
  xp: 0,
  dailyStreak: 0,
  lastActiveDate: "",
  currentCorrectRun: 0,
  bestCorrectRun: 0,
  topics: {},
  achievements: [],
  skill: {},
  onboarded: false,
  profile: null,
};

// --- Derived helpers ---------------------------------------------------------

export function levelFor(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}

export function xpInLevel(xp: number): number {
  return xp % XP_PER_LEVEL;
}

export function totalCorrect(p: Progress): number {
  return Object.values(p.topics).reduce((sum, t) => sum + t.correct, 0);
}

export function totalAttempts(p: Progress): number {
  return Object.values(p.topics).reduce((sum, t) => sum + t.attempts, 0);
}

// --- Achievements ------------------------------------------------------------

export type Achievement = { id: string; label: string; predicate: (p: Progress) => boolean };

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first-correct", label: "First correct answer", predicate: (p) => totalCorrect(p) >= 1 },
  { id: "ten-correct", label: "10 correct answers", predicate: (p) => totalCorrect(p) >= 10 },
  { id: "fifty-correct", label: "50 correct answers", predicate: (p) => totalCorrect(p) >= 50 },
  { id: "streak-3", label: "3-day streak", predicate: (p) => p.dailyStreak >= 3 },
  { id: "streak-7", label: "7-day streak", predicate: (p) => p.dailyStreak >= 7 },
  { id: "run-5", label: "5 in a row", predicate: (p) => p.bestCorrectRun >= 5 },
  { id: "level-5", label: "Reached level 5", predicate: (p) => levelFor(p.xp) >= 5 },
];

// --- Date helpers ------------------------------------------------------------

/** Local calendar date as YYYY-MM-DD (not UTC — streaks follow the user's day). */
function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isYesterday(prev: string, today: Date): boolean {
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  return prev === localDate(y);
}

// --- Pure update -------------------------------------------------------------

/** Apply one answer to progress, returning a new immutable Progress. `now` is injectable for tests. */
export function recordAnswer(
  prev: Progress,
  topic: string,
  correct: boolean,
  now: Date = new Date()
): Progress {
  const today = localDate(now);

  const existing = prev.topics[topic] ?? { attempts: 0, correct: 0 };
  const topics = {
    ...prev.topics,
    [topic]: {
      attempts: existing.attempts + 1,
      correct: existing.correct + (correct ? 1 : 0),
    },
  };

  const currentCorrectRun = correct ? prev.currentCorrectRun + 1 : 0;
  const bestCorrectRun = Math.max(prev.bestCorrectRun, currentCorrectRun);

  let dailyStreak: number;
  if (prev.lastActiveDate === today) {
    dailyStreak = prev.dailyStreak; // already counted today
  } else if (isYesterday(prev.lastActiveDate, now)) {
    dailyStreak = prev.dailyStreak + 1;
  } else {
    dailyStreak = 1; // first ever, or a gap broke the streak
  }

  const next: Progress = {
    ...prev,
    xp: prev.xp + (correct ? XP_PER_CORRECT : 0),
    topics,
    currentCorrectRun,
    bestCorrectRun,
    dailyStreak,
    lastActiveDate: today,
    // Adaptive level update uses prior attempts (prev), so compute before the increment is "seen".
    skill: updateSkill(prev, topic, correct),
  };

  // Recompute unlocked achievements (idempotent union — never un-unlocks).
  const unlocked = new Set(next.achievements);
  for (const a of ACHIEVEMENTS) {
    if (a.predicate(next)) unlocked.add(a.id);
  }
  next.achievements = Array.from(unlocked);

  return next;
}

// --- Merge (sync) ------------------------------------------------------------

/** Combine two snapshots taking the "best" of each — used to reconcile local vs server on login.
 *  Scalars: max. lastActiveDate: later. Per-topic: the side with more attempts. Achievements: union. */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const topics: Record<string, TopicStat> = {};
  for (const key of new Set([...Object.keys(a.topics), ...Object.keys(b.topics)])) {
    const ta = a.topics[key];
    const tb = b.topics[key];
    if (!ta) topics[key] = tb;
    else if (!tb) topics[key] = ta;
    else topics[key] = tb.attempts > ta.attempts ? tb : ta;
  }
  // Per-topic skill: keep the value from the side with more attempts (more evidence).
  const skill: Record<string, number> = {};
  const aSkill = a.skill ?? {};
  const bSkill = b.skill ?? {};
  for (const key of new Set([...Object.keys(aSkill), ...Object.keys(bSkill)])) {
    const sa = aSkill[key];
    const sb = bSkill[key];
    if (sa === undefined) skill[key] = sb;
    else if (sb === undefined) skill[key] = sa;
    else skill[key] = (b.topics[key]?.attempts ?? 0) > (a.topics[key]?.attempts ?? 0) ? sb : sa;
  }
  return {
    xp: Math.max(a.xp, b.xp),
    dailyStreak: Math.max(a.dailyStreak, b.dailyStreak),
    lastActiveDate: a.lastActiveDate > b.lastActiveDate ? a.lastActiveDate : b.lastActiveDate,
    currentCorrectRun: Math.max(a.currentCorrectRun, b.currentCorrectRun),
    bestCorrectRun: Math.max(a.bestCorrectRun, b.bestCorrectRun),
    topics,
    achievements: Array.from(new Set([...a.achievements, ...b.achievements])),
    skill,
    onboarded: a.onboarded || b.onboarded,
    profile: b.profile ?? a.profile,
  };
}

// --- Persistence -------------------------------------------------------------

async function load(): Promise<Progress> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const stored = JSON.parse(raw) as Partial<Progress>;
    // Merge over defaults so a future shape change doesn't crash on old data.
    return {
      ...DEFAULT_PROGRESS,
      ...stored,
      topics: stored.topics ?? {},
      skill: stored.skill ?? {},
      profile: stored.profile ?? null,
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

async function save(p: Progress): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Best-effort; losing a write is non-fatal for a learning app.
  }
}

// --- React Context -----------------------------------------------------------

type ProgressContextValue = {
  progress: Progress;
  ready: boolean; // false until the first load completes
  recordAnswer: (topic: string, correct: boolean) => void;
  completeOnboarding: (profile: Profile, skill: Record<string, number>) => void;
  resetOnboarding: () => void;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { token, ready: authReady } = useAuth();
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [ready, setReady] = useState(false);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const syncedToken = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the local cache once on mount.
  useEffect(() => {
    load().then((p) => {
      setProgress(p);
      setReady(true);
    });
  }, []);

  // Debounced push of the latest snapshot to the server (only when authed).
  const schedulePush = useCallback(
    (p: Progress) => {
      if (!token) return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        void putProgress(p).catch(() => {}); // best-effort; AsyncStorage already has it
      }, 1200);
    },
    [token]
  );

  // React to login/logout: merge-on-login (server canonical), clear-on-logout (avoid mixing accounts).
  useEffect(() => {
    if (!ready || !authReady) return;
    if (token === syncedToken.current) return;
    if (!token) {
      syncedToken.current = null;
      setProgress(DEFAULT_PROGRESS);
      void save(DEFAULT_PROGRESS);
      return;
    }
    syncedToken.current = token;
    (async () => {
      try {
        const server = await getProgress();
        const merged = mergeProgress(progressRef.current, server);
        setProgress(merged);
        await save(merged);
        await putProgress(merged);
      } catch {
        // offline / server down — keep local; a later change or re-login will sync
      }
    })();
  }, [ready, authReady, token]);

  const record = useCallback(
    (topic: string, correct: boolean) => {
      setProgress((prev) => {
        const next = recordAnswer(prev, topic, correct);
        void save(next);
        schedulePush(next);
        return next;
      });
    },
    [schedulePush]
  );

  const completeOnboarding = useCallback(
    (profile: Profile, skill: Record<string, number>) => {
      setProgress((prev) => {
        const next: Progress = { ...prev, profile, skill, onboarded: true };
        void save(next);
        schedulePush(next);
        return next;
      });
    },
    [schedulePush]
  );

  const resetOnboarding = useCallback(() => {
    setProgress((prev) => {
      const next: Progress = { ...prev, onboarded: false };
      void save(next);
      schedulePush(next);
      return next;
    });
  }, [schedulePush]);

  const value = useMemo<ProgressContextValue>(
    () => ({ progress, ready, recordAnswer: record, completeOnboarding, resetOnboarding }),
    [progress, ready, record, completeOnboarding, resetOnboarding]
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used within a ProgressProvider");
  return ctx;
}
