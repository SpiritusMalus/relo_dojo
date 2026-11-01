// Progress & gamification store (Phase 3 local; Phase 4 backend sync).
//
// AsyncStorage is the working cache (offline-safe). When logged in, the store also syncs with the
// server: on login it pulls the server snapshot, merges by max with this owner's local cache, and pushes the result;
// later changes are pushed (debounced). The update logic stays a pure function (`recordAnswer`).
// Ownerless v1 data is retained in quarantine; it cannot safely identify an account while offline.
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
import { getProgress, isCurrentAuthToken, putProgress, syncLearnerProfile, type ExerciseType } from "../services/api";
import { useAuth } from "./auth";
import { isCurrentAccountScope, type AccountScope } from "./accountScope";
import { useAccountScope } from "./useAccountScope";
import { useWallet } from "./wallet";
import { effectiveSkill, LISTENING_FORMATS, RECENT_ANSWERS, updateListening, updateSkill, type AnswerEffort, type AnswerEvidence, type ListeningStat } from "./adaptive";
import { MASTERY_WINDOW, type AnswerMark } from "./curriculum";
import {
  MIN_REPAIRABLE_STREAK,
  repairOpen,
  streakStatus,
  yesterdayOf,
  type BrokenStreak,
} from "./streak";

const LEGACY_STORAGE_KEY = "relo_dojo/progress/v1";
const CACHE_PREFIX = "relo_dojo/progress/v2/";
export const PROGRESS_LEGACY_ARCHIVE_KEY = "relo_dojo/progress/quarantine/unowned-v1";

export const XP_PER_CORRECT = 10;
export const XP_PER_LEVEL = 100;
// Combo: every COMBO_EVERY-th correct answer in a row drops a bonus — the run becomes a stake.
export const COMBO_EVERY = 5;
export const COMBO_BONUS_XP = 20;
// "Kensei" boost (scroll rare drop): all XP doubles while the timer runs.
export const BOOST_MINUTES = 15;
export const BOOST_MULTIPLIER = 2;

export type TopicStat = { attempts: number; correct: number; lastSeen?: string; recent?: AnswerEvidence[] }; // lastSeen: local YYYY-MM-DD

export type Profile = {
  goals: string[];
  focusTopics: string[];
  selfLevel: string; // beginner | intermediate | advanced
  dailyMinutes: number;
  sphere: string; // top-level field of work/interest (any sphere, "" if skipped)
  domains: string[]; // optional sub-roles (only when sphere is Software & IT)
  painText: string;
  tone?: string; // feedback tone preference: soft | balanced | strict (default balanced)
  // --- Stage 2 agent outputs, cached locally (canonical copy lives in the server profile) ---
  wins?: string; // Progress Agent's encouraging line, shown on the Progress tab
  planWeights?: Record<string, number>; // Planner's per-topic urgency multipliers (0.5..2)
  planNote?: string; // Planner's one-line focus, shown on the Progress tab
  planDate?: string; // ISO date the plan was made (weekly-refresh trigger)
  planGoal?: string; // goal the plan was built for (new-goal trigger)
  planBaseline?: Record<string, number>; // correct-count per topic at plan time (quest progress)
  planBonusPaid?: string; // planDate whose completion bonus was already paid (one-shot per plan)
  remindHour?: number; // daily reminder hour (0..23); unset = default 19:00
  // Student diary: weekly baseline + last finished week's recap (see store/diary.ts).
  diary?: import("./diary").DiaryState;
};

/** Learner-set steering over the adaptive model (see store/adaptive.ts). Empty = today's behavior
 *  exactly: the model decides everything. The learner can "correct the teacher" by pinning a focus
 *  topic, muting topics/formats, or nudging difficulty. Persisted with the rest of Progress. */
export type Steering = {
  pinnedFocusTopic?: string; // a topic to over-weight (capped, never starves variety)
  mutedTopics: string[]; // canonical topic ids excluded from selection
  // Explicit per-format on/off (absent = on for text formats). "pronunciation" is the opt-in voice
  // modality (absent/false = off), gated additionally by EXPO_PUBLIC_VOICE_ENABLED + voice consent.
  formatPrefs: Partial<Record<ExerciseType | "pronunciation", boolean>>;
  difficultyBias: number; // -1..+1 shift of the served CEFR around the model's level
};

export const DEFAULT_STEERING: Steering = { mutedTopics: [], formatPrefs: {}, difficultyBias: 0 };

/** Course state (mastery-gated syllabus, store/curriculum.ts): the rolling per-topic answer
 *  evidence and the set of units already passed. `mastered` only ever grows — the path never
 *  re-locks a unit the learner has cleared, even if later answers dip. */
export type CourseState = {
  history: Record<string, AnswerMark[]>; // last MASTERY_WINDOW answers per topic
  mastered: string[]; // unit topic ids passed by the mastery criterion
};

export const DEFAULT_COURSE: CourseState = { history: {}, mastered: [] };

/** One saved Level Test result — the diagnosis trail behind the quarterly re-check. `skills` holds
 *  the per-skill estimates (grammar/vocab/reading/listening/writing, 0..5) actually sampled that run. */
export type LevelSnapshot = {
  date: string; // local YYYY-MM-DD the test was saved
  level: number; // blended overall estimate (0..5)
  cefr: string;
  skills: Record<string, number>;
  partial?: boolean; // this run explicitly omitted an unavailable modality or the writing section
};

// Keep the last 12 snapshots (~3 years at the quarterly cadence) — enough for every delta the UI
// shows, bounded so the synced payload can't grow forever.
export const LEVEL_HISTORY_MAX = 12;

/** Field-wise merge of two steering slices (used on login reconcile + the "just now" session overlay).
 *  `b` wins where it carries intent: its pin, its non-zero bias, its explicit format prefs; muted
 *  topics are unioned so a mute is never silently dropped. */
export function mergeSteering(a: Steering = DEFAULT_STEERING, b: Steering = DEFAULT_STEERING): Steering {
  return {
    pinnedFocusTopic: b.pinnedFocusTopic ?? a.pinnedFocusTopic,
    mutedTopics: Array.from(new Set([...a.mutedTopics, ...b.mutedTopics])),
    formatPrefs: { ...a.formatPrefs, ...b.formatPrefs },
    difficultyBias: b.difficultyBias !== 0 ? b.difficultyBias : a.difficultyBias,
  };
}

export type Progress = {
  xp: number;
  dailyStreak: number;
  lastActiveDate: string; // local YYYY-MM-DD, "" if never
  currentCorrectRun: number;
  bestCorrectRun: number;
  topics: Record<string, TopicStat>;
  recentFormats?: string[]; // last two actual formats across topics; avoids repeated card shapes
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
  // Highest explicitly awarded belt (exam or full Level Test; 0 = fresh White).
  // Missing/null means no recorded award: hydration/sync normalize it to 0 while preserving
  // every numeric award. Warm-up/skill estimates alone never supply an earned belt.
  beltEarned?: number;
  lastExamDate?: string; // local YYYY-MM-DD of the last exam attempt (one attempt per day)
  // Full Level Test trail: when it was last taken (drives the quarterly re-check nudge) and the saved
  // per-test snapshots (drives the "vs last time" diagnosis). Absent on accounts predating the feature.
  lastLevelTestDate?: string;
  levelHistory?: LevelSnapshot[];
  // Learner-set overrides on the adaptive model (visible, editable focus + format). Empty = default.
  steering: Steering;
  // Mastery-gated course evidence (see CourseState above / store/curriculum.ts).
  course: CourseState;
  // Live listening-modality estimate from daily listening exercises (store/adaptive.ts). Feeds the
  // Level Test diagnosis between tests; absent until the first listening answer.
  listening?: ListeningStat;
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
  beltEarned: 0,
  steering: DEFAULT_STEERING,
  course: DEFAULT_COURSE,
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
 *  partial credit (0..1); `difficulty` is the served item's difficulty on the 0..5 scale; `format`
 *  is the exercise type — course mastery weighs constructive formats above guessable ones. */
export type GradeSignal = AnswerEffort & { score?: number; difficulty?: number; format?: string };

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
  const score = Number.isFinite(grade?.score) ? Math.min(1, Math.max(0, grade!.score!)) : correct ? 1 : 0;
  const difficulty = Number.isFinite(grade?.difficulty)
    ? Math.min(5, Math.max(0, grade!.difficulty!))
    : effectiveSkill(prev, topic);
  const evidence: AnswerEvidence = { score, difficulty, format: grade?.format ?? "" };
  if (Number.isFinite(grade?.elapsedMs)) evidence.elapsedMs = Math.min(600_000, Math.max(0, Math.round(grade!.elapsedMs!)));
  if (grade?.hintUsed) evidence.hintUsed = true;
  const topics = {
    ...prev.topics,
    [topic]: {
      attempts: existing.attempts + 1,
      correct: existing.correct + (correct ? 1 : 0),
      lastSeen: today, // drives spaced-repetition review urgency (store/adaptive.ts)
      recent: [...(existing.recent ?? []), evidence].slice(-RECENT_ANSWERS),
    },
  };

  const currentCorrectRun = correct ? prev.currentCorrectRun + 1 : 0;
  const bestCorrectRun = Math.max(prev.bestCorrectRun, currentCorrectRun);

  // Course evidence: append this answer to the topic's rolling window. Meeting the criterion makes
  // the unit READY for its checkpoint (зачёт) — mastery itself is granted only by passing that quiz
  // (withUnitMastered, called from the checkpoint screen). Never granted here, never revoked.
  const prevCourse = prev.course ?? DEFAULT_COURSE;
  const marks = [...(prevCourse.history[topic] ?? []), { c: correct && !grade?.hintUsed, f: grade?.format ?? "" }].slice(
    -MASTERY_WINDOW
  );
  const course: CourseState = {
    history: { ...prevCourse.history, [topic]: marks },
    mastered: prevCourse.mastered,
  };

  let dailyStreak: number;
  let brokenStreak: BrokenStreak | null = prev.brokenStreak ?? null;
  if (prev.lastActiveDate === today) {
    // Already practiced today — keep the streak, but never below 1: a day with practice IS a streak
    // day, even if it was reset to 0 earlier today (e.g. an unrepaired break noticed on focus).
    dailyStreak = Math.max(prev.dailyStreak, 1);
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
    recentFormats: grade?.format ? [...(prev.recentFormats ?? []), grade.format].slice(-2) : prev.recentFormats,
    currentCorrectRun,
    bestCorrectRun,
    dailyStreak,
    brokenStreak,
    lastActiveDate: today,
    // Adaptive level update uses prior attempts (prev), so compute before the increment is "seen".
    // Prefer the partial score + served difficulty when available (difficulty-aware update);
    // otherwise fall back to the boolean correctness.
    skill: updateSkill(prev, topic, score, difficulty, grade),
    // Listening exercises also feed the modality estimate (Level Test diagnosis between tests).
    listening:
      grade?.format && LISTENING_FORMATS.has(grade.format)
        ? updateListening(prev.listening, score, difficulty, grade)
        : prev.listening,
    // Daily-goal counter: reset on a new local day, otherwise increment.
    todayDate: today,
    todayCount: prev.todayDate === today ? prev.todayCount + 1 : 1,
    course,
  };

  // Recompute unlocked achievements (idempotent union — never un-unlocks).
  const unlocked = new Set(next.achievements);
  for (const a of ACHIEVEMENTS) {
    if (a.predicate(next)) unlocked.add(a.id);
  }
  next.achievements = Array.from(unlocked);

  return next;
}

/** Pure: promote a unit to mastered — the checkpoint (зачёт) was passed. One-way and idempotent;
 *  the only place mastery is granted (recordAnswer only accumulates evidence). */
export function withUnitMastered(prev: Progress, topic: string): Progress {
  const course = prev.course ?? DEFAULT_COURSE;
  if (course.mastered.includes(topic)) return prev;
  return { ...prev, course: { ...course, mastered: [...course.mastered, topic] } };
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
    // Streak follows the side that practiced most recently — taking max would fabricate an
    // "active" long streak (e.g. a stale 10-day streak + a current 2-day one → "10 active today").
    // Tie on the same day → max (either snapshot is current).
    dailyStreak:
      a.lastActiveDate === b.lastActiveDate
        ? Math.max(a.dailyStreak, b.dailyStreak)
        : a.lastActiveDate > b.lastActiveDate
        ? a.dailyStreak
        : b.dailyStreak,
    lastActiveDate: a.lastActiveDate > b.lastActiveDate ? a.lastActiveDate : b.lastActiveDate,
    currentCorrectRun: Math.max(a.currentCorrectRun, b.currentCorrectRun),
    bestCorrectRun: Math.max(a.bestCorrectRun, b.bestCorrectRun),
    topics,
    recentFormats: ((totalAttempts(b) > totalAttempts(a) ? b.recentFormats : a.recentFormats) ?? a.recentFormats ?? b.recentFormats)?.slice(-2),
    achievements: Array.from(new Set([...a.achievements, ...b.achievements])),
    skill,
    onboarded: a.onboarded || b.onboarded,
    // Profile follows the more-recently-active side (same recency rule as dailyStreak/todayCount),
    // so an offline profile edit on the current device isn't clobbered by an older server snapshot.
    // Tie → server (canonical). Falls back to whichever side actually has a profile.
    profile:
      a.lastActiveDate === b.lastActiveDate
        ? b.profile ?? a.profile
        : a.lastActiveDate > b.lastActiveDate
        ? a.profile ?? b.profile
        : b.profile ?? a.profile,
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
    // Belt exam: the highest earned belt wins; the later attempt date wins.
    beltEarned: Math.max(a.beltEarned ?? 0, b.beltEarned ?? 0),
    lastExamDate: (a.lastExamDate ?? "") >= (b.lastExamDate ?? "") ? a.lastExamDate : b.lastExamDate,
    lastLevelTestDate:
      (a.lastLevelTestDate ?? "") >= (b.lastLevelTestDate ?? "") ? a.lastLevelTestDate : b.lastLevelTestDate,
    levelHistory: mergeLevelHistory(a.levelHistory, b.levelHistory),
    // Learner steering: field-wise merge (server canonical wins where it carries intent).
    steering: mergeSteering(a.steering, b.steering),
    course: mergeCourse(a.course ?? DEFAULT_COURSE, b.course ?? DEFAULT_COURSE),
    listening: mergeListening(a.listening, b.listening),
  };
}

/** Listening estimate: the side with more evidence wins (same rule as the per-topic skill). */
function mergeListening(a?: ListeningStat, b?: ListeningStat): ListeningStat | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.attempts > a.attempts ? b : a;
}

/** Level-test snapshots merge as a union keyed by date (each side may hold tests the other missed);
 *  on a same-day collision `b` (the server-canonical side on login) wins. Sorted, capped to the tail. */
function mergeLevelHistory(a?: LevelSnapshot[], b?: LevelSnapshot[]): LevelSnapshot[] | undefined {
  if (!a?.length && !b?.length) return a ?? b;
  const byDate = new Map<string, LevelSnapshot>();
  for (const s of [...(a ?? []), ...(b ?? [])]) byDate.set(s.date, s);
  return Array.from(byDate.values())
    .sort((x, y) => (x.date < y.date ? -1 : 1))
    .slice(-LEVEL_HISTORY_MAX);
}

/** Course merge: mastered units are a one-way set (union); per-topic history keeps the side with
 *  more evidence (longer window) — interleaving two devices' windows would fabricate an order. */
function mergeCourse(a: CourseState, b: CourseState): CourseState {
  const history: Record<string, AnswerMark[]> = {};
  for (const key of new Set([...Object.keys(a.history), ...Object.keys(b.history)])) {
    const ha = a.history[key] ?? [];
    const hb = b.history[key] ?? [];
    // Keep the side with more evidence, capped to the window so an oversized legacy/corrupt stored
    // array can't win the merge and persist unbounded (masteryOf re-slices on read anyway).
    history[key] = (hb.length > ha.length ? hb : ha).slice(-MASTERY_WINDOW);
  }
  return { history, mastered: Array.from(new Set([...a.mastered, ...b.mastered])) };
}

function pickLaterBreak(a: BrokenStreak | null, b: BrokenStreak | null): BrokenStreak | null {
  if (!a) return b;
  if (!b) return a;
  return a.date >= b.date ? a : b;
}

// --- Persistence -------------------------------------------------------------

function normalizeProgress(value: unknown): Progress {
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<Progress> : {};
  // Merge over defaults so a future shape change doesn't crash on old data.
  return {
    ...DEFAULT_PROGRESS,
    ...stored,
    topics: stored.topics ?? {},
    skill: stored.skill ?? {},
    profile: stored.profile ?? null,
    brokenStreak: stored.brokenStreak ?? null,
    boostUntil: stored.boostUntil ?? "",
    beltEarned: stored.beltEarned ?? 0,
    steering: stored.steering ? { ...DEFAULT_STEERING, ...stored.steering } : DEFAULT_STEERING,
    course: stored.course
      ? { history: stored.course.history ?? {}, mastered: stored.course.mastered ?? [] }
      : DEFAULT_COURSE,
  };
}

type PendingClaim = { id: string; progress: Progress };
type ProgressCache = { owner: string; progress: Progress; pendingClaims?: Record<string, PendingClaim> };
// One queue also covers remounts and the atomic guest-claim outbox. User data still has separate
// immutable keys, so an already-dispatched A native write can never replace B's cache.
let cacheIO: Promise<void> = Promise.resolve();
let claimSequence = 0;
function storageTask<T>(run: () => Promise<T>): Promise<T> {
  const task = cacheIO.then(run);
  cacheIO = task.then(() => {}, () => {});
  return task;
}
const cacheKey = (owner: string) => CACHE_PREFIX + encodeURIComponent(owner);

async function preserveUnknown(raw: string, key: string): Promise<void> {
  if (await AsyncStorage.getItem(key) === null) await AsyncStorage.setItem(key, raw);
}

async function readCache(owner: string): Promise<ProgressCache> {
  const raw = await AsyncStorage.getItem(cacheKey(owner));
  if (raw) {
    try {
      const envelope = JSON.parse(raw) as ProgressCache;
      if (envelope.owner === owner && envelope.progress && typeof envelope.progress === "object") {
        return { owner, progress: normalizeProgress(envelope.progress), pendingClaims: owner === "guest" ? envelope.pendingClaims : undefined };
      }
    } catch { /* Preserve an unreadable/misowned envelope before replacing its key. */ }
    await preserveUnknown(raw, `relo_dojo/progress/quarantine/invalid-${encodeURIComponent(owner)}`);
  }
  return { owner, progress: DEFAULT_PROGRESS };
}

function meaningfulGuest(p: Progress): boolean {
  return p.onboarded || p.xp > 0 || p.profile !== null || (p.beltEarned ?? 0) > 0
    || Object.keys(p.topics).length > 0 || Object.keys(p.skill).length > 0;
}

async function loadCache(scope: AccountScope, guestSeed?: Progress, localSeed?: Progress): Promise<{ progress: Progress; claimId?: string } | null> {
  return storageTask(async () => {
    const legacy = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) await preserveUnknown(legacy, PROGRESS_LEGACY_ARCHIVE_KEY);
    if (!scope.owner || !isCurrentAccountScope(scope)) return null;
    const owner = scope.owner;
    const own = await readCache(owner);
    let progress = own.progress;
    let claimId: string | undefined;
    if (owner !== "guest") {
      let guest = await readCache("guest");
      if (guestSeed && meaningfulGuest(guestSeed)) {
        if (!isCurrentAccountScope(scope)) return null;
        const previous = guest.pendingClaims?.[owner];
        const donation = mergeProgress(guest.progress, guestSeed);
        const claim = { id: `${Date.now().toString(36)}-${++claimSequence}`, progress: previous ? mergeProgress(previous.progress, donation) : donation };
        // Consume the live guest snapshot and pin its recovery payload to this owner in ONE write.
        // A crash before the account save can only recover it for this same account, never B.
        guest = { owner: "guest", progress: DEFAULT_PROGRESS, pendingClaims: { ...guest.pendingClaims, [owner]: claim } };
        await AsyncStorage.setItem(cacheKey("guest"), JSON.stringify(guest));
      }
      const claim = guest.pendingClaims?.[owner];
      if (claim) {
        progress = mergeProgress(progress, normalizeProgress(claim.progress));
        claimId = claim.id;
      }
    }
    if (localSeed) progress = mergeProgress(progress, localSeed);
    return isCurrentAccountScope(scope) ? { progress, claimId } : null;
  });
}

async function saveCache(p: Progress, scope: AccountScope, claimId?: string): Promise<void> {
  await storageTask(async () => {
    if (!scope.owner || !isCurrentAccountScope(scope)) return;
    const owner = scope.owner;
    const previous = owner === "guest" ? await readCache("guest") : undefined;
    if (!isCurrentAccountScope(scope)) return;
    await AsyncStorage.setItem(cacheKey(owner), JSON.stringify({ owner, progress: p, ...(previous?.pendingClaims ? { pendingClaims: previous.pendingClaims } : {}) }));
    // Acknowledge only the exact claim included in this saved snapshot. Keep any newer donation.
    if (owner !== "guest" && claimId) {
      const guest = await readCache("guest");
      if (guest.pendingClaims?.[owner]?.id === claimId) {
        const pendingClaims = { ...guest.pendingClaims };
        delete pendingClaims[owner];
        await AsyncStorage.setItem(cacheKey("guest"), JSON.stringify({ ...guest, pendingClaims }));
      }
    }
  });
}

// --- React Context -----------------------------------------------------------

type ProgressContextValue = {
  progress: Progress;
  ready: boolean; // false until the first local load completes
  synced: boolean; // false until the post-login server reconciliation settles (success or offline)
  recordAnswer: (topic: string, correct: boolean, grade?: GradeSignal) => Progress;
  completeOnboarding: (profile: Profile, skill: Record<string, number>) => void;
  resetOnboarding: () => void;
  /** Merge a partial change into the profile (e.g. tone or a new goal from settings). */
  updateProfile: (patch: Partial<Profile>) => void;
  /** Record a belt-exam attempt; on pass the target belt becomes the worn (earned) one. */
  recordExamResult: (passed: boolean, targetIdx: number, date: string) => void;
  /** Promote a course unit to mastered — called by the checkpoint screen on a passed зачёт. */
  masterUnit: (topic: string) => void;
  /** Apply a completed full Level Test (store/levelTest.ts): set the (uncapped) skill estimate and
   *  raise the worn belt to the placed one. This is the path that lifts the onboarding B2 cap.
   *  `snapshot` is the per-skill diagnosis appended to the level history (quarterly re-check trail). */
  applyLevelTest: (skill: Record<string, number>, beltIdx: number, date: string, snapshot?: LevelSnapshot) => void;
  /** Pay the weekly-quest completion bonus: +xp once, and mark the plan as paid. */
  awardQuestBonus: (xp: number, profilePatch: Partial<Profile>) => void;
  /** Buy back the broken streak ("отработка у Сэнсэя"). Charges koku server-side; throws on 409. */
  repairStreak: () => Promise<void>;
  /** Let the broken streak go (closes the repair offer). */
  dismissBrokenStreak: () => void;
  /** Start the x2-XP "kensei" boost (scroll rare drop): BOOST_MINUTES from now. */
  activateBoost: () => void;
  /** Replace the persisted learner-steering slice (the "remember" path of the swerve lever). */
  setSteering: (next: Steering) => void;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);
type ProgressSession = {
  token: string | null; scope: AccountScope; loaded: boolean; synced: boolean; reconciled: boolean;
  guestSeed?: Progress; localSeed?: Progress; claimId?: string;
};

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { token, ready: authReady } = useAuth();
  const scope = useAccountScope();
  const { freezes, spend, ready: walletReady } = useWallet();
  const [snapshot, setSnapshot] = useState<{ session: ProgressSession | null; progress: Progress; ready: boolean; synced: boolean }>({ session: null, progress: DEFAULT_PROGRESS, ready: false, synced: false });
  const progressRef = useRef<Progress>(DEFAULT_PROGRESS);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = useRef<ProgressSession>({ token, scope, loaded: false, synced: false, reconciled: false });
  if (session.current.token !== token || session.current.scope !== scope) {
    const previous = session.current;
    const sameScope = previous.scope === scope;
    const guestSeed = sameScope ? previous.guestSeed
      : previous.scope.owner === "guest" && previous.loaded ? progressRef.current
      : previous.scope.owner === null && previous.token === token && token && isCurrentAuthToken(token) ? previous.guestSeed : undefined;
    const localSeed = previous.scope.owner === scope.owner && scope.owner && previous.loaded ? progressRef.current : sameScope ? previous.localSeed : undefined;
    session.current = { token, scope, loaded: false, synced: false, reconciled: false, guestSeed: scope.owner === "guest" ? undefined : guestSeed, localSeed };
    progressRef.current = DEFAULT_PROGRESS;
  }
  const active = session.current;
  const current = useCallback(() => session.current === active && isCurrentAccountScope(active.scope) && isCurrentAuthToken(active.token), [active]);
  const visible = snapshot.session === active && current();
  // Never render the previous owner's raw state while waiting for a reset effect or native read.
  const progress = visible ? snapshot.progress : DEFAULT_PROGRESS;
  const ready = visible && snapshot.ready;
  const synced = visible && snapshot.synced;
  const canMutate = useCallback(() => active.loaded && current(), [active, current]);
  const setProgress = useCallback((update: Progress | ((prev: Progress) => Progress)) => {
    if (!canMutate()) return;
    const next = typeof update === "function" ? update(progressRef.current) : update;
    if (!current()) return;
    progressRef.current = next;
    setSnapshot({ session: active, progress: next, ready: true, synced: active.synced });
  }, [active, canMutate, current]);
  const persist = useCallback(async (p: Progress) => {
    if (!canMutate()) return;
    await saveCache(p, active.scope, active.claimId).catch(() => {});
  }, [active, canMutate]);

  // Reload the correct durable owner cache on every account epoch, including offline restart.
  useEffect(() => {
    if (!authReady || !scope.owner || !current()) return;
    let disposed = false;
    loadCache(scope, active.guestSeed, active.localSeed).catch(() => ({ progress: DEFAULT_PROGRESS })).then((loaded) => {
      if (disposed || !current() || !loaded) return;
      active.loaded = true;
      active.claimId = "claimId" in loaded ? loaded.claimId : undefined;
      active.synced = !token;
      progressRef.current = loaded.progress;
      setSnapshot({ session: active, progress: loaded.progress, ready: true, synced: active.synced });
      // Complete an interrupted guest claim locally even if the server is offline.
      if (active.claimId) void persist(loaded.progress);
    });
    return () => { disposed = true; };
  }, [active, authReady, scope, token, current, persist]);

  // Debounced push of the latest snapshot to the server (only when authed).
  const schedulePush = useCallback(
    (_p: Progress) => {
      if (!token || !canMutate()) return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        pushTimer.current = null;
        if (!canMutate()) return;
        void putProgress(progressRef.current, token).catch(() => {});
      }, 1200);
    },
    [token, canMutate]
  );

  // Reconcile only this owner's cache with this owner's server snapshot.
  useEffect(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = null;
    if (!ready || !authReady || !token || !canMutate()) return;
    let disposed = false;
    const stillCurrent = () => !disposed && current();
    (async () => {
      try {
        const server = await getProgress(token);
        if (!stillCurrent()) return;
        const merged = mergeProgress(progressRef.current, server);
        progressRef.current = merged;
        setProgress(merged);
        await persist(merged);
        if (!stillCurrent()) return;
        // An answer may have landed while the local cache was saving. Push the latest snapshot.
        await putProgress(progressRef.current, token);
      } catch {
        // offline / server down — keep local; a later change or re-login will sync
      } finally {
        if (stillCurrent()) {
          active.synced = true;
          setSnapshot({ session: active, progress: progressRef.current, ready: true, synced: true });
        }
      }
    })();
    return () => {
      disposed = true;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = null;
    };
  }, [active, ready, authReady, token, persist, current, canMutate, setProgress]);

  // Streak reconciliation on launch / after sync: a gap is either bridged by an owned omamori
  // (consumed server-side — the charm exists to be silently useful) or surfaced as a BREAK event
  // with a paid repair window. Without this, a missed day would only be noticed mid-practice.
  useEffect(() => {
    if (!ready || !walletReady || active.reconciled || !canMutate()) return;
    active.reconciled = true;
    const now = new Date();
    const p = progressRef.current;
    // Expire a stale repair offer first (the window closed — the loss is final). The break was
    // already finalized when it was first recorded, so we clear the offer and STOP: falling through
    // to the break-detection below would read the just-cleared brokenStreak as null and re-open a
    // fresh repair offer for the same, already-finalized loss (the offer would spring back to life).
    if (p.brokenStreak && !repairOpen(p.brokenStreak, now)) {
      setProgress((prev) => {
        const next = { ...prev, brokenStreak: null };
        void persist(next);
        schedulePush(next);
        return next;
      });
      return;
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
      if (!current()) return;
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
          void persist(next);
          schedulePush(next);
        }
        return next;
      });
    })();
  }, [active, ready, walletReady, freezes, spend, schedulePush, canMutate, current, setProgress]);

  const repairStreak = useCallback(async () => {
    const captured = active;
    if (!canMutate() || !captured.token) return;
    const broken = progressRef.current.brokenStreak;
    if (!broken || !repairOpen(broken, new Date())) return;
    // Flush the snapshot first so the server prices the repair off ITS copy of brokenStreak.streak
    // (server-authoritative — a patched client can't understate the lost streak to pay less).
    // Best-effort: if the push fails the server falls back to the qty below, so repair never blocks.
    await putProgress(progressRef.current, captured.token).catch(() => {});
    if (!current()) return;
    // Server charges koku (price scales with the lost streak); throws ApiError 409 if short.
    await spend("streak_repair", broken.streak);
    if (!current()) return;
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
      void persist(next);
      schedulePush(next);
      return next;
    });
  }, [active, canMutate, current, spend, schedulePush]);

  const dismissBrokenStreak = useCallback(() => {
    setProgress((prev) => {
      if (!prev.brokenStreak) return prev;
      const next: Progress = { ...prev, brokenStreak: null };
      void persist(next);
      schedulePush(next);
      return next;
    });
  }, [schedulePush]);

  const activateBoost = useCallback(() => {
    setProgress((prev) => {
      const until = new Date(Date.now() + BOOST_MINUTES * 60000).toISOString();
      const next: Progress = { ...prev, boostUntil: until };
      void persist(next);
      schedulePush(next);
      return next;
    });
  }, [schedulePush]);

  const record = useCallback(
    (topic: string, correct: boolean, grade?: GradeSignal) => {
      if (!canMutate()) return DEFAULT_PROGRESS;
      // The caller can select the next card immediately after grading, before React re-renders.
      // Keeping this ref current also prevents two same-tick answers from sharing a stale snapshot.
      const next = recordAnswer(progressRef.current, topic, correct, new Date(), grade);
      progressRef.current = next;
      setProgress(next);
      void persist(next);
      schedulePush(next);
      return next;
    },
    [canMutate, schedulePush]
  );

  const completeOnboarding = useCallback(
    (profile: Profile, skill: Record<string, number>) => {
      if (!canMutate()) return;
      setProgress((prev) => {
        const next: Progress = { ...prev, profile, skill, onboarded: true, beltEarned: prev.beltEarned ?? 0 };
        void persist(next);
        schedulePush(next);
        return next;
      });
      // Mirror the survey into the server-side learner profile (memory layer for feedback).
      // The free-text goal itself is persisted by /profile/analyze when authenticated.
      void syncLearnerProfile({
        sphere: profile.sphere,
        domains: profile.domains,
        tone: profile.tone || "balanced",
      });
    },
    [canMutate, schedulePush]
  );

  const updateProfile = useCallback(
    (patch: Partial<Profile>) => {
      if (!canMutate()) return;
      setProgress((prev) => {
        if (!prev.profile) return prev;
        const next: Progress = { ...prev, profile: { ...prev.profile, ...patch } };
        void persist(next);
        schedulePush(next);
        return next;
      });
      // Keep the server-side memory layer in step for the fields it owns.
      const serverPatch: Record<string, unknown> = {};
      if (patch.tone !== undefined) serverPatch.tone = patch.tone;
      if (patch.sphere !== undefined) serverPatch.sphere = patch.sphere;
      if (patch.domains !== undefined) serverPatch.domains = patch.domains;
      if (Object.keys(serverPatch).length) void syncLearnerProfile(serverPatch);
    },
    [canMutate, schedulePush]
  );

  const masterUnit = useCallback(
    (topic: string) => {
      setProgress((prev) => {
        const next = withUnitMastered(prev, topic);
        if (next !== prev) {
          void persist(next);
          schedulePush(next);
        }
        return next;
      });
    },
    [schedulePush]
  );

  const recordExamResult = useCallback(
    (passed: boolean, targetIdx: number, date: string) => {
      setProgress((prev) => {
        const next: Progress = {
          ...prev,
          lastExamDate: date,
          beltEarned: passed ? Math.max(prev.beltEarned ?? 0, targetIdx) : prev.beltEarned,
        };
        void persist(next);
        schedulePush(next);
        return next;
      });
    },
    [schedulePush]
  );

  const applyLevelTest = useCallback(
    (skill: Record<string, number>, beltIdx: number, date: string, snapshot?: LevelSnapshot) => {
      // The full adaptive test is legitimate evidence, so it both re-seeds the skill estimate
      // (uncapped — can place at C1) and raises the worn belt. Only RAISES the belt (max) so a
      // retake never strips a belt already earned via exams.
      setProgress((prev) => {
        const next: Progress = {
          ...prev,
          skill,
          lastExamDate: date,
          lastLevelTestDate: date,
          levelHistory: snapshot
            ? [...(prev.levelHistory ?? []), snapshot].slice(-LEVEL_HISTORY_MAX)
            : prev.levelHistory,
          beltEarned: Math.max(prev.beltEarned ?? 0, beltIdx),
          // A test that measured listening re-anchors the live modality estimate to the saved
          // (already practice-blended) value; the evidence count stays — it keeps weighting the
          // next diagnosis blend and the step decay.
          listening:
            snapshot?.skills?.listening !== undefined
              ? { level: snapshot.skills.listening, attempts: prev.listening?.attempts ?? 0 }
              : prev.listening,
        };
        void persist(next);
        schedulePush(next);
        return next;
      });
    },
    [schedulePush]
  );

  const awardQuestBonus = useCallback(
    (xp: number, profilePatch: Partial<Profile>) => {
      setProgress((prev) => {
        if (!prev.profile) return prev;
        const next: Progress = {
          ...prev,
          xp: prev.xp + xp,
          profile: { ...prev.profile, ...profilePatch },
        };
        void persist(next);
        schedulePush(next);
        return next;
      });
    },
    [schedulePush]
  );

  const setSteering = useCallback(
    (next: Steering) => {
      setProgress((prev) => {
        const p: Progress = { ...prev, steering: next };
        void persist(p);
        schedulePush(p);
        return p;
      });
    },
    [schedulePush]
  );

  const resetOnboarding = useCallback(() => {
    setProgress((prev) => {
      const next: Progress = { ...prev, onboarded: false };
      void persist(next);
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
      updateProfile,
      recordExamResult,
      masterUnit,
      applyLevelTest,
      awardQuestBonus,
      repairStreak,
      dismissBrokenStreak,
      activateBoost,
      setSteering,
    }),
    [progress, ready, synced, record, completeOnboarding, resetOnboarding, updateProfile, recordExamResult, masterUnit, applyLevelTest, awardQuestBonus, repairStreak, dismissBrokenStreak, activateBoost, setSteering]
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error("useProgress must be used within a ProgressProvider");
  return ctx;
}
