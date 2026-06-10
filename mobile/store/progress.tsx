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
import { useWallet } from "./wallet";
import { updateSkill } from "./adaptive";
import {
  MIN_REPAIRABLE_STREAK,
  repairOpen,
  streakStatus,
  yesterdayOf,
  type BrokenStreak,
} from "./streak";

const STORAGE_KEY = "grammar-dojo/progress/v1";

export const XP_PER_CORRECT = 10;
export const XP_PER_LEVEL = 100;
// Combo: every COMBO_EVERY-th correct answer in a row drops a bonus — the run becomes a stake.
export const COMBO_EVERY = 5;
export const COMBO_BONUS_XP = 20;
// "Kensei" boost (scroll rare drop): all XP doubles while the timer runs.
export const BOOST_MINUTES = 15;
export const BOOST_MULTIPLIER = 2;

export type TopicStat = { attempts: number; correct: number; lastSeen?: string }; // lastSeen: local YYYY-MM-DD

export type Profile = {
  goals: string[];
  focusTopics: string[];
  selfLevel: string; // beginner | intermediate | advanced
  dailyMinutes: number;
  sphere: string; // top-level field of work/interest (any sphere, "" if skipped)
  domains: string[]; // optional sub-roles (only when sphere is Software & IT)
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
  todayDate: string; // local YYYY-MM-DD of the current day's counter
  todayCount: number; // answers given today (for the daily goal)
  // A noticed streak break that can still be repaired for koku (see store/streak.ts). null = none.
  brokenStreak?: BrokenStreak | null;
  // ISO timestamp until which the x2-XP "kensei" boost runs ("" = no boost).
  boostUntil?: string;
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
  todayDate: "",
  todayCount: 0,
  brokenStreak: null,
  boostUntil: "",
};

/** Is the x2-XP boost active at `now`? */
export function boostActive(p: Progress, now: Date = new Date()): boolean {
  return !!p.boostUntil && now.toISOString() < p.boostUntil;
}

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

/** Optional grading signal for a difficulty-aware skill update (store/adaptive.ts). `score` is the
 *  partial credit (0..1); `difficulty` is the served item's difficulty on the 0..5 scale. */
export type GradeSignal = { score?: number; difficulty?: number };

/** Apply one answer to progress, returning a new immutable Progress. `now` is injectable for tests. */
export function recordAnswer(
  prev: Progress,
  topic: string,
  correct: boolean,
  now: Date = new Date(),
  grade?: GradeSignal
): Progress {
  const today = localDate(now);

  const existing = prev.topics[topic] ?? { attempts: 0, correct: 0 };
  const topics = {
    ...prev.topics,
    [topic]: {
      attempts: existing.attempts + 1,
      correct: existing.correct + (correct ? 1 : 0),
      lastSeen: today, // drives spaced-repetition review urgency (store/adaptive.ts)
    },
  };

  const currentCorrectRun = correct ? prev.currentCorrectRun + 1 : 0;
  const bestCorrectRun = Math.max(prev.bestCorrectRun, currentCorrectRun);

  let dailyStreak: number;
  let brokenStreak: BrokenStreak | null = prev.brokenStreak ?? null;
  if (prev.lastActiveDate === today) {
    dailyStreak = prev.dailyStreak; // already counted today
  } else if (isYesterday(prev.lastActiveDate, now)) {
    dailyStreak = prev.dailyStreak + 1;
  } else {
    // First ever, or a gap broke the streak. A streak worth repairing becomes a visible BREAK
    // event (repair offer, store/streak.ts) instead of vanishing silently — the loss must be felt.
    if (prev.dailyStreak >= MIN_REPAIRABLE_STREAK && prev.lastActiveDate && !brokenStreak) {
      brokenStreak = { streak: prev.dailyStreak, date: today };
    }
    dailyStreak = 1;
  }

  // XP: base + combo bonus (every COMBO_EVERY-th in a row), doubled while the kensei boost runs.
  const comboHit = correct && currentCorrectRun > 0 && currentCorrectRun % COMBO_EVERY === 0;
  const mult = boostActive(prev, now) ? BOOST_MULTIPLIER : 1;
  const earnedXp = correct ? (XP_PER_CORRECT + (comboHit ? COMBO_BONUS_XP : 0)) * mult : 0;

  const next: Progress = {
    ...prev,
    xp: prev.xp + earnedXp,
    topics,
    currentCorrectRun,
    bestCorrectRun,
    dailyStreak,
    brokenStreak,
    lastActiveDate: today,
    // Adaptive level update uses prior attempts (prev), so compute before the increment is "seen".
    // Prefer the partial score + served difficulty when available (difficulty-aware update);
    // otherwise fall back to the boolean correctness.
    skill: updateSkill(prev, topic, grade?.score ?? correct, grade?.difficulty),
    // Daily-goal counter: reset on a new local day, otherwise increment.
    todayDate: today,
    todayCount: prev.todayDate === today ? prev.todayCount + 1 : 1,
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
    else {
      const chosen = tb.attempts > ta.attempts ? tb : ta;
      // Keep the most recent practice date so spaced-repetition timing isn't reset by a sync.
      const lastSeen = [ta.lastSeen, tb.lastSeen].filter(Boolean).sort().pop();
      topics[key] = lastSeen ? { ...chosen, lastSeen } : chosen;
    }
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
    // Daily counter: keep the later day; if the same day, the higher count.
    todayDate: a.todayDate >= b.todayDate ? a.todayDate : b.todayDate,
    todayCount:
      a.todayDate === b.todayDate
        ? Math.max(a.todayCount, b.todayCount)
        : a.todayDate > b.todayDate
        ? a.todayCount
        : b.todayCount,
    // Keep the later break event (or null when both sides are clean).
    brokenStreak: pickLaterBreak(a.brokenStreak ?? null, b.brokenStreak ?? null),
    // Boost: the later expiry wins (ISO strings compare lexicographically).
    boostUntil: (a.boostUntil ?? "") >= (b.boostUntil ?? "") ? a.boostUntil ?? "" : b.boostUntil ?? "",
  };
}

function pickLaterBreak(a: BrokenStreak | null, b: BrokenStreak | null): BrokenStreak | null {
  if (!a) return b;
  if (!b) return a;
  return a.date >= b.date ? a : b;
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
      brokenStreak: stored.brokenStreak ?? null,
      boostUntil: stored.boostUntil ?? "",
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
  ready: boolean; // false until the first local load completes
  synced: boolean; // false until the post-login server reconciliation settles (success or offline)
  recordAnswer: (topic: string, correct: boolean, grade?: GradeSignal) => void;
  completeOnboarding: (profile: Profile, skill: Record<string, number>) => void;
  resetOnboarding: () => void;
  /** Buy back the broken streak ("отработка у Сэнсэя"). Charges koku server-side; throws on 409. */
  repairStreak: () => Promise<void>;
  /** Let the broken streak go (closes the repair offer). */
  dismissBrokenStreak: () => void;
  /** Start the x2-XP "kensei" boost (scroll rare drop): BOOST_MINUTES from now. */
  activateBoost: () => void;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { token, ready: authReady } = useAuth();
  const { freezes, spend, ready: walletReady } = useWallet();
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  const [ready, setReady] = useState(false);
  // Gates onboarding routing: stays false from a token change until the server snapshot is merged
  // in (or the attempt fails offline), so we never flash onboarding using the reset local default.
  const [synced, setSynced] = useState(false);
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
      setSynced(true); // logged-out state is settled (gate falls through to /login)
      setProgress(DEFAULT_PROGRESS);
      void save(DEFAULT_PROGRESS);
      return;
    }
    syncedToken.current = token;
    setSynced(false); // new token → hold onboarding routing until the server snapshot lands
    (async () => {
      try {
        const server = await getProgress();
        const merged = mergeProgress(progressRef.current, server);
        setProgress(merged);
        await save(merged);
        await putProgress(merged);
      } catch {
        // offline / server down — keep local; a later change or re-login will sync
      } finally {
        setSynced(true);
      }
    })();
  }, [ready, authReady, token]);

  // Streak reconciliation on launch / after sync: a gap is either bridged by an owned omamori
  // (consumed server-side — the charm exists to be silently useful) or surfaced as a BREAK event
  // with a paid repair window. Without this, a missed day would only be noticed mid-practice.
  const reconciled = useRef(false);
  useEffect(() => {
    if (!ready || !walletReady || reconciled.current) return;
    reconciled.current = true;
    const now = new Date();
    const p = progressRef.current;
    // Expire a stale repair offer first (the window closed — the loss is final).
    if (p.brokenStreak && !repairOpen(p.brokenStreak, now)) {
      setProgress((prev) => {
        const next = { ...prev, brokenStreak: null };
        void save(next);
        schedulePush(next);
        return next;
      });
    }
    const status = streakStatus(p.dailyStreak, p.lastActiveDate, now);
    if (status.kind !== "broken") return;
    void (async () => {
      let bridged = false;
      if (freezes > 0) {
        try {
          await spend("use_freeze"); // omamori auto-saves the streak
          bridged = true;
        } catch {
          // 409 (charm raced away) / offline → fall through to the break event
        }
      }
      setProgress((prev) => {
        const next: Progress = bridged
          ? { ...prev, lastActiveDate: yesterdayOf(now) } // gap bridged — practicing today extends it
          : prev.brokenStreak
          ? prev // a break is already recorded — don't double-fire
          : {
              ...prev,
              brokenStreak: { streak: prev.dailyStreak, date: localDate(now) },
              dailyStreak: 0,
            };
        if (next !== prev) {
          void save(next);
          schedulePush(next);
        }
        return next;
      });
    })();
  }, [ready, walletReady, freezes, spend, schedulePush]);

  const repairStreak = useCallback(async () => {
    const broken = progressRef.current.brokenStreak;
    if (!broken || !repairOpen(broken, new Date())) return;
    // Server charges koku (price scales with the lost streak); throws ApiError 409 if short.
    await spend("streak_repair", broken.streak);
    const now = new Date();
    setProgress((prev) => {
      const practicedToday = prev.lastActiveDate === localDate(now);
      const next: Progress = {
        ...prev,
        // Restored; if they already practiced today, today's session extends the revived streak.
        dailyStreak: broken.streak + (practicedToday ? 1 : 0),
        lastActiveDate: practicedToday ? prev.lastActiveDate : yesterdayOf(now),
        brokenStreak: null,
      };
      void save(next);
      schedulePush(next);
      return next;
    });
  }, [spend, schedulePush]);

  const dismissBrokenStreak = useCallback(() => {
    setProgress((prev) => {
      if (!prev.brokenStreak) return prev;
      const next: Progress = { ...prev, brokenStreak: null };
      void save(next);
      schedulePush(next);
      return next;
    });
  }, [schedulePush]);

  const activateBoost = useCallback(() => {
    setProgress((prev) => {
      const until = new Date(Date.now() + BOOST_MINUTES * 60000).toISOString();
      const next: Progress = { ...prev, boostUntil: until };
      void save(next);
      schedulePush(next);
      return next;
    });
  }, [schedulePush]);

  const record = useCallback(
    (topic: string, correct: boolean, grade?: GradeSignal) => {
      setProgress((prev) => {
        const next = recordAnswer(prev, topic, correct, new Date(), grade);
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
    () => ({
      progress,
      ready,
      synced,
      recordAnswer: record,
      completeOnboarding,
      resetOnboarding,
      repairStreak,
      dismissBrokenStreak,
      activateBoost,
    }),
    [progress, ready, synced, record, completeOnboarding, resetOnboarding, repairStreak, dismissBrokenStreak, activateBoost]
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used within a ProgressProvider");
  return ctx;
}
