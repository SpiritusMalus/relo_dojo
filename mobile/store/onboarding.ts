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

export const DOMAINS = ["backend", "frontend", "data", "devops", "other"];
export const DAILY_MINUTES = [5, 10, 15];

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
