// Onboarding survey data + level seeding (pure, no React/RN imports → unit-testable).
import type { Profile } from "./progress";
import { LEVEL_MAX, LEVEL_MIN, START_LEVEL, TOPIC_PRIORS } from "./adaptive";

// --- survey option data (canonical topic keys match backend grammar.py TOPICS) ---
export const GOALS: { id: string; label: string }[] = [
  { id: "docs", label: "Read docs & code reviews" },
  { id: "writing", label: "Write better PRs & issues" },
  { id: "interviews", label: "Pass tech interviews" },
  { id: "team", label: "Talk with an international team" },
  { id: "conferences", label: "Conferences & talks" },
];

export const DOMAINS = [
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
export const DAILY_MINUTES = [5, 10, 15, 30, 60];

// Short phrases used to flavor generated examples toward the learner's goal.
export const GOAL_PHRASES: Record<string, string> = {
  docs: "reading documentation",
  writing: "writing PRs and issues",
  interviews: "tech interviews",
  team: "talking with an international team",
  conferences: "conference talks",
};

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

/** Initial per-topic skill from the survey: base from self-level, flagged topics start lower. */
export function seedSkillFromProfile(profile: Profile): Record<string, number> {
  const base = selfLevelToLevel(profile.selfLevel);
  const focus = new Set(profile.focusTopics ?? []);
  const skill: Record<string, number> = {};
  for (const topic of Object.keys(TOPIC_PRIORS)) {
    const lvl = focus.has(topic) ? base - FOCUS_PENALTY : base;
    skill[topic] = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, lvl));
  }
  return skill;
}

// --- functional effects of the profile ---

/** A hint string for example generation: the learner's domains/interests + goals (no "other"). */
export function buildContext(profile: Profile | null): string {
  if (!profile) return "";
  const domains = (profile.domains ?? []).filter((d) => d && d !== "other");
  const goals = (profile.goals ?? []).map((g) => GOAL_PHRASES[g] ?? g).filter(Boolean);
  const parts: string[] = [];
  if (domains.length) parts.push(domains.join(", "));
  if (goals.length) parts.push(`goals: ${goals.join(", ")}`);
  return parts.join("; ");
}

export const EXERCISES_PER_MINUTE = 1.5; // soft pace estimate (tunable)

/** Daily exercise target derived from the chosen minutes-per-day. */
export function minutesToGoal(minutes: number): number {
  if (!minutes || minutes <= 0) return 0;
  return Math.max(1, Math.round(minutes * EXERCISES_PER_MINUTE));
}
