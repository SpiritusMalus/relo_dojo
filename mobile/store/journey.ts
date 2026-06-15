// Relocation journey stages (NICHE_PIVOT_IT_RELOCATION.md — retention feature). The niche is a
// JOURNEY, not a single need: interview prep is an *event*, workplace English is the *recurring* need
// that survives the move. We track which stage the learner is in so generated content follows the arc
// (pre-move → arrived → settled) and we can gently nudge them onward. Handing the learner from the
// event-need to the recurring-need is the D7-retention mechanism (relocation ends; work doesn't).
//
// Pure logic + tiny AsyncStorage persistence, mirroring store/registerWall.ts. Its own storage key,
// fully decoupled from the synced Progress/Profile → zero server-schema risk. Each stage maps 1:1 onto
// a journey goal id and its scenario pack (store/scenarioPacks.ts), so examples track the stage.
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "grammar-dojo/journey/v1";

/** The arc, in order. Each stage emphasizes one journey goal's scenario pack. */
export const JOURNEY_STAGES = ["pre_move", "arrived", "settled"] as const;
export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** stage → the journey goal id it emphasizes (keys match onboarding goals + scenarioPacks). */
export const STAGE_GOAL: Record<JourneyStage, string> = {
  pre_move: "interviews",
  arrived: "relocation_life",
  settled: "work_comms",
};

/** The journey goal ids (the niche goals). A learner is "on the journey" if they picked one. */
export const JOURNEY_GOAL_IDS: readonly string[] = Object.values(STAGE_GOAL);

/** True when the learner selected at least one relocation-journey goal (gates niche-only UI). Pure. */
export function hasJourneyGoal(goals: string[] | null | undefined): boolean {
  const set = new Set(goals ?? []);
  return JOURNEY_GOAL_IDS.some((g) => set.has(g));
}

/** Finished sessions in a stage before we *suggest* (never force) moving on — the come-back hook.
 *  Advancing stays the learner's choice: the app can't know when they actually relocated. */
export const SUGGEST_ADVANCE_AFTER = 5;

export type JourneyState = { stage: JourneyStage; sessions: number };

/** Initial stage inferred from selected goals: the earliest arc stage the learner picked (they start
 *  at the front of the journey). Falls back to pre_move. Pure. */
export function stageFromGoals(goals: string[] | null | undefined): JourneyStage {
  const set = new Set(goals ?? []);
  return JOURNEY_STAGES.find((s) => set.has(STAGE_GOAL[s])) ?? "pre_move";
}

export function defaultJourney(goals?: string[] | null): JourneyState {
  return { stage: stageFromGoals(goals), sessions: 0 };
}

/** Next stage along the arc; clamps at the last stage. Pure. */
export function nextStage(s: JourneyStage): JourneyStage {
  const i = JOURNEY_STAGES.indexOf(s);
  return JOURNEY_STAGES[Math.min(i + 1, JOURNEY_STAGES.length - 1)];
}

export function isLastStage(s: JourneyStage): boolean {
  return s === JOURNEY_STAGES[JOURNEY_STAGES.length - 1];
}

/** Count one finished session in the current stage. Pure. */
export function countSession(s: JourneyState): JourneyState {
  return { ...s, sessions: s.sessions + 1 };
}

/** Advance to the next stage, resetting the in-stage counter. No-op at the last stage. Pure. */
export function advance(s: JourneyState): JourneyState {
  if (isLastStage(s.stage)) return s;
  return { stage: nextStage(s.stage), sessions: 0 };
}

/** Should we nudge toward the next stage? Only once enough sessions are invested and there is a next
 *  stage to move to. Pure. */
export function shouldSuggestAdvance(s: JourneyState, after: number = SUGGEST_ADVANCE_AFTER): boolean {
  return !isLastStage(s.stage) && s.sessions >= after;
}

// --- persistence (best-effort; losing a write is non-fatal) ---

export async function loadJourney(): Promise<JourneyState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<JourneyState>;
    const stage = (JOURNEY_STAGES as readonly string[]).includes(v.stage ?? "")
      ? (v.stage as JourneyStage)
      : "pre_move";
    return { stage, sessions: Math.max(0, Math.floor(v.sessions ?? 0)) };
  } catch {
    return null;
  }
}

export async function saveJourney(s: JourneyState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** Clear journey state (called on logout so a fresh learner on the device starts clean). */
export async function resetJourney(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Convenience used at session finish: load (seed from goals if absent) → countSession → save. */
export async function recordJourneySession(goals?: string[] | null): Promise<JourneyState> {
  const cur = (await loadJourney()) ?? defaultJourney(goals);
  const next = countSession(cur);
  await saveJourney(next);
  return next;
}

/** Convenience used by the nudge: advance the stage and persist it. Returns the new state. */
export async function advanceAndSave(s: JourneyState): Promise<JourneyState> {
  const next = advance(s);
  await saveJourney(next);
  return next;
}
