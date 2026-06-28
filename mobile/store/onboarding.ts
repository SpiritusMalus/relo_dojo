// Onboarding survey data + level seeding (pure, no React/RN imports → unit-testable).
import type { Profile } from "./progress";
import { LEVEL_MAX, LEVEL_MIN, START_LEVEL, TOPIC_PRIORS } from "./adaptive";
import { pickScenario } from "./scenarioPacks";

// Generation `context` is capped server-side (schemas.py: max_length=300) — keep the whole hint within it.
const CONTEXT_MAX_LEN = 300;

// --- survey option data (canonical topic keys match backend grammar.py TOPICS) ---
// Cross-field goals (not software-specific) so the survey fits any sphere. The
// interviews → relocation_life → work_comms trio frames the IT-relocation arc
// (pre-move → arrival → ongoing), but each goal is useful for any field too.
export const GOALS: { id: string; label: string }[] = [
  { id: "emails", label: "Write clearer emails & messages" },
  { id: "meetings", label: "Speak up in meetings" },
  { id: "reading", label: "Read articles & documents" },
  { id: "interviews", label: "Job interviews" },
  { id: "relocation_life", label: "Settle in after moving abroad" },
  { id: "work_comms", label: "Daily work communication" },
  { id: "customers", label: "Talk with clients & customers" },
  { id: "travel", label: "Travel & everyday talk" },
];

// Top-level field of work/interest. Feeds example flavor (context) for any learner.
export const SPHERES = [
  "Software & IT",
  "Medicine & health",
  "Business & finance",
  "Law",
  "Marketing & sales",
  "Education",
  "Science & engineering",
  "Hospitality & travel",
  "Creative & media",
  "Everyday / general",
];

// Optional sub-roles, shown only when the sphere is Software & IT (kept from the dev-first version).
export const SOFTWARE_SPHERE = "Software & IT";
export const SOFTWARE_ROLES = [
  "backend",
  "frontend",
  "fullstack",
  "mobile",
  "data / ML",
  "devops",
  "game dev",
  "QA / testing",
  "security",
  "embedded",
];
// Back-compat alias (older code referenced DOMAINS).
export const DOMAINS = SOFTWARE_ROLES;

// Niche go-to-market default ("English for IT relocation"): the survey pre-selects this
// sphere so SOFTWARE_ROLES surface up front. Every other sphere in SPHERES stays selectable
// — set this back to "" to drop the default. Fully reversible, no data removed.
// See NICHE_PIVOT_IT_RELOCATION.md.
export const DEFAULT_SPHERE = SOFTWARE_SPHERE;

// Narrowing toggle: when true, onboarding leads with the IT sphere only and tucks the other spheres
// behind a "not in tech?" disclosure (still reachable, nothing deleted). Set to false to show every
// sphere up front again. Fully reversible.
export const COLLAPSE_NON_IT_SPHERES = true;

export const DAILY_MINUTES = [5, 10, 15, 30, 60];

// Short phrases used to flavor generated examples toward the learner's goal.
export const GOAL_PHRASES: Record<string, string> = {
  emails: "writing emails and messages",
  meetings: "speaking in meetings",
  reading: "reading articles and documents",
  interviews: "job interviews",
  relocation_life: "settling in abroad — banking, renting, appointments, small talk",
  work_comms: "everyday work communication — standups, code reviews, chat messages",
  customers: "talking with clients and customers",
  travel: "travelling and everyday conversation",
};

// Feedback tone (Praktika adoption Stage 1): how the Sensei talks about slips.
export const TONES: { id: string; label: string }[] = [
  { id: "soft", label: "Soft — cheer me on" },
  { id: "balanced", label: "Balanced — friendly and clear" },
  { id: "strict", label: "Strict — straight to the point" },
];
export const DEFAULT_TONE = "balanced";

export const SELF_LEVELS: { id: string; label: string }[] = [
  { id: "beginner", label: "Beginner — I rely on a dictionary" },
  { id: "intermediate", label: "Intermediate — I read docs okay" },
  { id: "advanced", label: "Advanced — I'm fairly comfortable" },
];

export const TOPIC_LABELS: Record<string, string> = {
  prepositions: "Prepositions (in / on / at)",
  conditionals: "Conditionals (if …)",
  "verb sequence (tense agreement)": "Verb tenses & agreement",
  vocabulary: "Vocabulary",
  articles: "Articles (a / an / the)",
  "modal verbs": "Modal verbs (can / must …)",
  "phrasal verbs": "Phrasal verbs",
  "gerunds & infinitives": "Gerunds & infinitives",
  "comparatives & superlatives": "Comparatives & superlatives",
  "word order": "Word order",
  punctuation: "Punctuation",
};

// --- seeding ---
const FOCUS_PENALTY = 0.7; // weak/flagged topics start a bit lower than the base self-level

export function selfLevelToLevel(self: string): number {
  switch (self) {
    case "beginner":
      return 0.5; // A1
    case "advanced":
      // B1 (was 3.5 = inside B2, one good answer from C1). The self-claim is only a starting prior;
      // the calibration quiz must EARN B2+. Down-weighted so the test dominates, not the self-rating.
      return 2.8;
    case "intermediate":
      return 1.8; // A2/B1
    default:
      return START_LEVEL;
  }
}

// --- calibration (onboarding placement quiz) ---
// Onboarding placement is a short, low-evidence quiz, so its verdict is deliberately conservative:
//  1. the per-answer step DECAYS as items accumulate (one item is weak evidence — never a whole CEFR
//     band of swing), mirroring the gentle runtime model in adaptive.ts; and
//  2. the result is CAPPED at high-B2 — a 10-item multiple-choice quiz never awards C1. C1 is reserved
//     for sustained performance in real practice / the belt exam (adaptive.ts can climb above this).
// This is the fix for placement over-estimation ("C1 with a couple of mistakes, can't actually speak").

// Largest level the onboarding quiz can output (inside the B2 band [3,4) → levelToCefr = "B2").
export const ONBOARDING_MAX_LEVEL = 3.9;

/** Per-answer calibration step, decaying with the number of items already answered. Starts at 0.6
 *  (well under a 1.0-wide CEFR band) and shrinks toward a 0.2 floor so later items fine-tune. */
export function calibrationStep(answered: number): number {
  return Math.max(0.2, 0.6 / (1 + Math.max(0, answered) / 3));
}

/** Clamp an onboarding-derived level so placement never overshoots into C1 (see ONBOARDING_MAX_LEVEL). */
export function capOnboardingLevel(level: number): number {
  return Math.min(ONBOARDING_MAX_LEVEL, Math.max(LEVEL_MIN, level));
}

/** Per-topic skill from a base level: every topic starts at `level`, flagged topics a bit lower. */
export function seedSkillFromLevel(level: number, focusTopics: string[]): Record<string, number> {
  const focus = new Set(focusTopics ?? []);
  const skill: Record<string, number> = {};
  for (const topic of Object.keys(TOPIC_PRIORS)) {
    const lvl = focus.has(topic) ? level - FOCUS_PENALTY : level;
    skill[topic] = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, lvl));
  }
  return skill;
}

/** Initial per-topic skill from the survey self-assessment (fallback when the test is skipped). */
export function seedSkillFromProfile(profile: Profile): Record<string, number> {
  return seedSkillFromLevel(selfLevelToLevel(profile.selfLevel), profile.focusTopics ?? []);
}

// --- functional effects of the profile ---

/** A hint string for example generation: the learner's sphere + sub-roles/interests + goals, plus one
 *  curated journey scenario when a relocation goal is set (see scenarioPacks). `preferGoal` biases the
 *  scenario toward the learner's current journey stage (see store/journey.ts). `rng` is injectable for
 *  deterministic tests; production uses Math.random so the scenario rotates for variety. */
export function buildContext(
  profile: Profile | null,
  rng: () => number = Math.random,
  preferGoal?: string | null
): string {
  if (!profile) return "";
  const sphere = (profile.sphere ?? "").trim();
  const domains = (profile.domains ?? []).filter((d) => d && d !== "other");
  const goals = (profile.goals ?? []).map((g) => GOAL_PHRASES[g] ?? g).filter(Boolean);
  const parts: string[] = [];
  // Field first (e.g. "Medicine & health — emergency nursing"), then goals.
  if (sphere && sphere !== "Everyday / general") {
    parts.push(domains.length ? `${sphere} — ${domains.join(", ")}` : sphere);
  } else if (domains.length) {
    parts.push(domains.join(", "));
  }
  // Add goal phrases greedily up to the server cap — many long phrases (e.g. the whole journey arc:
  // interviews + relocation_life + work_comms) could otherwise push `context` past 300 chars and 422
  // the generation request. The field part (short, most specific) is kept first.
  if (goals.length) {
    const head = parts.join("; ");
    const budget = CONTEXT_MAX_LEN - (head ? head.length + 2 : 0) - "goals: ".length;
    const kept: string[] = [];
    let used = 0;
    for (const g of goals) {
      const cost = (kept.length ? 2 : 0) + g.length; // ", " separator + phrase
      if (used + cost > budget) break;
      kept.push(g);
      used += cost;
    }
    if (kept.length) parts.push(`goals: ${kept.join(", ")}`);
  }
  let base = parts.join("; ");
  // Belt-and-suspenders: even a huge free-text field/role can't blow the cap.
  if (base.length > CONTEXT_MAX_LEN) base = base.slice(0, CONTEXT_MAX_LEN).trimEnd();
  // Weave in a concrete journey scenario when one applies and it still fits the server cap; bias it
  // toward the learner's current journey stage when the caller passes one.
  const scenario = pickScenario(profile.goals, rng, preferGoal);
  if (scenario) {
    const withScenario = base ? `${base}; e.g. ${scenario}` : `e.g. ${scenario}`;
    if (withScenario.length <= CONTEXT_MAX_LEN) return withScenario;
  }
  return base;
}

export const EXERCISES_PER_MINUTE = 1.5; // soft pace estimate (tunable)

/** Daily exercise target derived from the chosen minutes-per-day. */
export function minutesToGoal(minutes: number): number {
  if (!minutes || minutes <= 0) return 0;
  return Math.max(1, Math.round(minutes * EXERCISES_PER_MINUTE));
}
