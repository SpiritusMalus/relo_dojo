// Vetted placement-test item bank (pure data) — used by the onboarding warm-up instead of LLM
// generation, so level estimation is reliable. All multiple-choice, graded locally (answer known).
// `level` is the CEFR midpoint on the 0..5 scale: A1≈0.5, A2≈1.5, B1≈2.5, B2≈3.5, C1≈4.5.

export type CalItem = {
  id: string;
  topic: string;
  level: number;
  text: string; // sentence with a '___' blank, or an instruction for sentence-choice items
  options: string[];
  answer: string; // must be one of options
};

export const CALIBRATION_BANK: CalItem[] = [
  // --- A1 (0.5) ---
  { id: "a1-prep1", topic: "prepositions", level: 0.5, text: "The file is ___ the desktop.", options: ["on", "in", "at"], answer: "on" },
  { id: "a1-art1", topic: "articles", level: 0.5, text: "I have ___ idea.", options: ["an", "a", "the"], answer: "an" },
  { id: "a1-verb1", topic: "verb sequence (tense agreement)", level: 0.5, text: "She ___ a developer.", options: ["is", "are", "am"], answer: "is" },
  { id: "a1-voc1", topic: "vocabulary", level: 0.5, text: "I write code on my ___.", options: ["computer", "banana", "river"], answer: "computer" },
  { id: "a1-prep2", topic: "prepositions", level: 0.5, text: "We start work ___ 9 a.m.", options: ["at", "in", "on"], answer: "at" },

  // --- A2 (1.5) ---
  { id: "a2-art1", topic: "articles", level: 1.5, text: "He opened ___ file I sent yesterday.", options: ["the", "a", "an"], answer: "the" },
  { id: "a2-comp1", topic: "comparatives & superlatives", level: 1.5, text: "Python is ___ to read than assembly.", options: ["easier", "easy", "easiest"], answer: "easier" },
  { id: "a2-modal1", topic: "modal verbs", level: 1.5, text: "You ___ push to main without a review.", options: ["shouldn't", "doesn't", "aren't"], answer: "shouldn't" },
  { id: "a2-prep1", topic: "prepositions", level: 1.5, text: "The result depends ___ the input.", options: ["on", "of", "at"], answer: "on" },
  { id: "a2-verb1", topic: "verb sequence (tense agreement)", level: 1.5, text: "Yesterday I ___ all the tests.", options: ["ran", "run", "runs"], answer: "ran" },

  // --- B1 (2.5) ---
  { id: "b1-cond1", topic: "conditionals", level: 2.5, text: "If the input is null, the function ___ an error.", options: ["throws", "throw", "throwing"], answer: "throws" },
  { id: "b1-ger1", topic: "gerunds & infinitives", level: 2.5, text: "I enjoy ___ unit tests.", options: ["writing", "to write", "write"], answer: "writing" },
  { id: "b1-phr1", topic: "phrasal verbs", level: 2.5, text: "The script ___ when memory runs out.", options: ["breaks down", "breaks", "falls"], answer: "breaks down" },
  { id: "b1-word1", topic: "word order", level: 2.5, text: "Choose the correct sentence.", options: ["She often commits code.", "She commits often code.", "Often she code commits."], answer: "She often commits code." },
  { id: "b1-verb1", topic: "verb sequence (tense agreement)", level: 2.5, text: "He said he ___ finished the task.", options: ["had", "has", "have"], answer: "had" },

  // --- B2 (3.5) ---
  { id: "b2-cond1", topic: "conditionals", level: 3.5, text: "If I ___ more time, I would refactor this module.", options: ["had", "have", "will have"], answer: "had" },
  { id: "b2-modal1", topic: "modal verbs", level: 3.5, text: "The outage ___ have been caused by the cache.", options: ["could", "can", "will"], answer: "could" },
  { id: "b2-ger1", topic: "gerunds & infinitives", level: 3.5, text: "The team decided ___ the database.", options: ["to migrate", "migrating", "migrate"], answer: "to migrate" },
  { id: "b2-prep1", topic: "prepositions", level: 3.5, text: "This service is responsible ___ authentication.", options: ["for", "of", "to"], answer: "for" },
  { id: "b2-comp1", topic: "comparatives & superlatives", level: 3.5, text: "This is by far the ___ approach we've tried.", options: ["most efficient", "more efficient", "efficientest"], answer: "most efficient" },

  // --- C1 (4.5) ---
  { id: "c1-cond1", topic: "conditionals", level: 4.5, text: "Had we caught the bug earlier, we ___ the rollback.", options: ["could have avoided", "could avoid", "can avoid"], answer: "could have avoided" },
  { id: "c1-verb1", topic: "verb sequence (tense agreement)", level: 4.5, text: "By the time the patch shipped, the issue ___ for weeks.", options: ["had been occurring", "has occurred", "occurs"], answer: "had been occurring" },
  { id: "c1-word1", topic: "word order", level: 4.5, text: "Choose the correct sentence.", options: ["Rarely have I seen such clean code.", "Rarely I have seen such clean code.", "I have rarely seen such code clean."], answer: "Rarely have I seen such clean code." },
  { id: "c1-punc1", topic: "punctuation", level: 4.5, text: "Choose the correctly punctuated line.", options: ["The list is empty; therefore, we skip it.", "The list is empty, therefore we skip it.", "The list is empty therefore; we skip it."], answer: "The list is empty; therefore, we skip it." },
];

/** Pick the unused bank item whose level is closest to `target` (random tie-break). */
export function pickItem(target: number, usedIds: Set<string>): CalItem | null {
  const pool = CALIBRATION_BANK.filter((it) => !usedIds.has(it.id));
  if (pool.length === 0) return null;
  let best = Infinity;
  for (const it of pool) best = Math.min(best, Math.abs(it.level - target));
  const closest = pool.filter((it) => Math.abs(it.level - target) === best);
  return closest[Math.floor(Math.random() * closest.length)];
}
