// Onboarding survey data + level seeding (pure, no React/RN imports → unit-testable).
import type { Profile } from "./progress";
import { LEVEL_MAX, LEVEL_MIN, START_LEVEL, TOPIC_PRIORS } from "./adaptive";

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
      return 3.5; // B2
    case "intermediate":
      return 1.8; // A2/B1
    default:
      return START_LEVEL;
  }
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

/** A hint string for example generation: the learner's sphere + sub-roles/interests + goals. */
export function buildContext(profile: Profile | null): string {
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
  if (goals.length) parts.push(`goals: ${goals.join(", ")}`);
  return parts.join("; ");
}

export const EXERCISES_PER_MINUTE = 1.5; // soft pace estimate (tunable)

/** Daily exercise target derived from the chosen minutes-per-day. */
export function minutesToGoal(minutes: number): number {
  if (!minutes || minutes <= 0) return 0;
  return Math.max(1, Math.round(minutes * EXERCISES_PER_MINUTE));
}
