// Local progress & gamification store (Phase 3).
//
// Client-only this phase: everything lives in AsyncStorage. Backend sync + accounts come in Phase 4.
// The update logic is kept as a pure function (`recordAnswer`) so it's easy to reason about and test;
// the React Context just loads on mount, persists on change, and shares state across the two tabs.
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

const STORAGE_KEY = "grammar-dojo/progress/v1";

export const XP_PER_CORRECT = 10;
export const XP_PER_LEVEL = 100;

export type TopicStat = { attempts: number; correct: number };

export type Progress = {
  xp: number;
  dailyStreak: number;
  lastActiveDate: string; // local YYYY-MM-DD, "" if never
  currentCorrectRun: number;
  bestCorrectRun: number;
  topics: Record<string, TopicStat>;
  achievements: string[]; // unlocked ids
};

const DEFAULT_PROGRESS: Progress = {
  xp: 0,
  dailyStreak: 0,
  lastActiveDate: "",
  currentCorrectRun: 0,
  bestCorrectRun: 0,
  topics: {},
  achievements: [],
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
  };

  // Recompute unlocked achievements (idempotent union — never un-unlocks).
  const unlocked = new Set(next.achievements);
  for (const a of ACHIEVEMENTS) {
    if (a.predicate(next)) unlocked.add(a.id);
  }
  next.achievements = Array.from(unlocked);

  return next;
}

// --- Persistence -------------------------------------------------------------

async function load(): Promise<Progress> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const stored = JSON.parse(raw) as Partial<Progress>;
    // Merge over defaults so a future shape change doesn't crash on old data.
    return { ...DEFAULT_PROGRESS, ...stored, topics: stored.topics ?? {} };
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
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    load().then((p) => {
      setProgress(p);
      loaded.current = true;
      setReady(true);
    });
  }, []);

  const record = useCallback((topic: string, correct: boolean) => {
    setProgress((prev) => {
      const next = recordAnswer(prev, topic, correct);
      void save(next);
      return next;
    });
  }, []);

  const value = useMemo<ProgressContextValue>(
    () => ({ progress, ready, recordAnswer: record }),
    [progress, ready, record]
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used within a ProgressProvider");
  return ctx;
}
