// Vetted placement-test item bank (pure data) — used by the onboarding warm-up instead of LLM
// generation, so level estimation is reliable. All multiple-choice, graded locally (answer known).
// Sentences are deliberately everyday and field-neutral so placement is fair for any learner
// (not only developers). `level` is the CEFR midpoint on the 0..5 scale: A1≈0.5, A2≈1.5, B1≈2.5,
// B2≈3.5, C1≈4.5. Options list the answer first here; the UI shuffles them before display.

import type { Exercise } from "../services/api";

export type CalItem = {
  id: string;
  topic: string;
  level: number;
  text: string; // sentence with a '___' blank, or an instruction for sentence-choice items
  options: string[];
  answer: string; // must be one of options
};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Render a bank item as a multiple-choice Exercise (options shuffled). Shared by the onboarding
 *  warm-up and the full Level Test so both grade locally with the known answer (no LLM call). */
export function itemToExercise(item: CalItem): Exercise {
  return {
    type: "multiple-choice",
    topic: item.topic,
    level: "",
    text: item.text,
    prompt: "",
    options: shuffle(item.options),
    tiles: [],
    tokens: [],
    left: [],
    right: [],
    blankOptions: [],
    token: null,
  };
}

export const CALIBRATION_BANK: CalItem[] = [
  // --- A1 (0.5) ---
  { id: "a1-prep1", topic: "prepositions", level: 0.5, text: "The keys are ___ the table.", options: ["on", "in", "at"], answer: "on" },
  { id: "a1-art1", topic: "articles", level: 0.5, text: "I have ___ idea.", options: ["an", "a", "the"], answer: "an" },
  { id: "a1-verb1", topic: "verb sequence (tense agreement)", level: 0.5, text: "She ___ a teacher.", options: ["is", "are", "am"], answer: "is" },
  { id: "a1-voc1", topic: "vocabulary", level: 0.5, text: "I drink coffee from a ___.", options: ["cup", "river", "cloud"], answer: "cup" },
  { id: "a1-prep2", topic: "prepositions", level: 0.5, text: "We have lunch ___ noon.", options: ["at", "in", "on"], answer: "at" },

  // --- A2 (1.5) ---
  { id: "a2-art1", topic: "articles", level: 1.5, text: "He opened ___ letter I sent yesterday.", options: ["the", "a", "an"], answer: "the" },
  { id: "a2-comp1", topic: "comparatives & superlatives", level: 1.5, text: "A train is ___ than a bicycle.", options: ["faster", "fast", "fastest"], answer: "faster" },
  { id: "a2-modal1", topic: "modal verbs", level: 1.5, text: "You ___ smoke inside the hospital.", options: ["shouldn't", "doesn't", "aren't"], answer: "shouldn't" },
  { id: "a2-prep1", topic: "prepositions", level: 1.5, text: "The result depends ___ the weather.", options: ["on", "of", "at"], answer: "on" },
  { id: "a2-verb1", topic: "verb sequence (tense agreement)", level: 1.5, text: "Yesterday I ___ to the market.", options: ["went", "go", "goes"], answer: "went" },

  // --- B1 (2.5) ---
  { id: "b1-cond1", topic: "conditionals", level: 2.5, text: "If you heat ice, it ___ to water.", options: ["turns", "turn", "turning"], answer: "turns" },
  { id: "b1-ger1", topic: "gerunds & infinitives", level: 2.5, text: "I enjoy ___ in the garden.", options: ["working", "to work", "work"], answer: "working" },
  { id: "b1-phr1", topic: "phrasal verbs", level: 2.5, text: "The car ___ when the fuel runs out.", options: ["breaks down", "breaks", "falls"], answer: "breaks down" },
  { id: "b1-word1", topic: "word order", level: 2.5, text: "Choose the correct sentence.", options: ["She often visits her parents.", "She visits often her parents.", "Often she parents visits."], answer: "She often visits her parents." },
  { id: "b1-verb1", topic: "verb sequence (tense agreement)", level: 2.5, text: "He said he ___ finished dinner.", options: ["had", "has", "have"], answer: "had" },

  // --- B2 (3.5) ---
  { id: "b2-cond1", topic: "conditionals", level: 3.5, text: "If I ___ more time, I would repaint the room.", options: ["had", "have", "will have"], answer: "had" },
  { id: "b2-modal1", topic: "modal verbs", level: 3.5, text: "The delay ___ have been caused by the storm.", options: ["could", "can", "will"], answer: "could" },
  { id: "b2-ger1", topic: "gerunds & infinitives", level: 3.5, text: "The team decided ___ the schedule.", options: ["to change", "changing", "change"], answer: "to change" },
  { id: "b2-prep1", topic: "prepositions", level: 3.5, text: "This office is responsible ___ customer support.", options: ["for", "of", "to"], answer: "for" },
  { id: "b2-comp1", topic: "comparatives & superlatives", level: 3.5, text: "This is by far the ___ meal we've had.", options: ["most delicious", "more delicious", "deliciousest"], answer: "most delicious" },

  // --- C1 (4.5) ---
  { id: "c1-cond1", topic: "conditionals", level: 4.5, text: "Had we left earlier, we ___ the traffic.", options: ["could have avoided", "could avoid", "can avoid"], answer: "could have avoided" },
  { id: "c1-verb1", topic: "verb sequence (tense agreement)", level: 4.5, text: "By the time help arrived, the fire ___ for hours.", options: ["had been burning", "has burned", "burns"], answer: "had been burning" },
  { id: "c1-word1", topic: "word order", level: 4.5, text: "Choose the correct sentence.", options: ["Rarely have I seen such a crowd.", "Rarely I have seen such a crowd.", "I have rarely seen such crowd a."], answer: "Rarely have I seen such a crowd." },
  { id: "c1-punc1", topic: "punctuation", level: 4.5, text: "Choose the correctly punctuated line.", options: ["The room was empty; therefore, we left.", "The room was empty, therefore we left.", "The room was empty therefore; we left."], answer: "The room was empty; therefore, we left." },

  // === extra items (grammar + vocabulary) so the adaptive Level Test never runs out near any θ ===
  // --- A1 (0.5) ---
  { id: "a1-voc2", topic: "vocabulary", level: 0.5, text: "A dog is an ___.", options: ["animal", "color", "day"], answer: "animal" },
  { id: "a1-voc3", topic: "vocabulary", level: 0.5, text: "I sleep in my ___ at night.", options: ["bed", "car", "shoe"], answer: "bed" },
  { id: "a1-verb2", topic: "verb sequence (tense agreement)", level: 0.5, text: "They ___ happy today.", options: ["are", "is", "am"], answer: "are" },
  { id: "a1-prep3", topic: "prepositions", level: 0.5, text: "The cat is ___ the box.", options: ["in", "on", "at"], answer: "in" },
  { id: "a1-art2", topic: "articles", level: 0.5, text: "She is ___ engineer.", options: ["an", "a", "the"], answer: "an" },

  // --- A2 (1.5) ---
  { id: "a2-voc1", topic: "vocabulary", level: 1.5, text: "I bought a ___ to read on the train.", options: ["book", "bridge", "button"], answer: "book" },
  { id: "a2-phr1", topic: "phrasal verbs", level: 1.5, text: "Please ___ your shoes before you come in.", options: ["take off", "take", "put"], answer: "take off" },
  { id: "a2-modal2", topic: "modal verbs", level: 1.5, text: "___ you help me, please?", options: ["Could", "Must", "Should"], answer: "Could" },
  { id: "a2-comp2", topic: "comparatives & superlatives", level: 1.5, text: "This box is ___ than that one.", options: ["heavier", "heavy", "heaviest"], answer: "heavier" },
  { id: "a2-verb2", topic: "verb sequence (tense agreement)", level: 1.5, text: "She ___ TV when I called.", options: ["was watching", "watched", "watches"], answer: "was watching" },

  // --- B1 (2.5) ---
  { id: "b1-voc1", topic: "vocabulary", level: 2.5, text: "He was ___ after running the whole race.", options: ["exhausted", "delighted", "curious"], answer: "exhausted" },
  { id: "b1-cond2", topic: "conditionals", level: 2.5, text: "If it rains tomorrow, we ___ stay home.", options: ["will", "would", "would have"], answer: "will" },
  { id: "b1-ger2", topic: "gerunds & infinitives", level: 2.5, text: "She's good at ___ problems.", options: ["solving", "solve", "to solve"], answer: "solving" },
  { id: "b1-prep2", topic: "prepositions", level: 2.5, text: "I apologized ___ being late.", options: ["for", "of", "to"], answer: "for" },
  { id: "b1-phr2", topic: "phrasal verbs", level: 2.5, text: "We need to ___ a solution before Friday.", options: ["come up with", "come", "bring up"], answer: "come up with" },

  // --- B2 (3.5) ---
  { id: "b2-voc1", topic: "vocabulary", level: 3.5, text: "Her argument was ___ and hard to refute.", options: ["compelling", "reluctant", "spacious"], answer: "compelling" },
  { id: "b2-cond2", topic: "conditionals", level: 3.5, text: "I wish I ___ more time yesterday.", options: ["had had", "had", "have had"], answer: "had had" },
  { id: "b2-word1", topic: "word order", level: 3.5, text: "Choose the correct sentence.", options: ["Never before had she felt so confident.", "Never before she had felt so confident.", "She never had before felt so confident."], answer: "Never before had she felt so confident." },
  { id: "b2-phr1", topic: "phrasal verbs", level: 3.5, text: "The meeting was ___ until next week.", options: ["put off", "put", "called"], answer: "put off" },
  { id: "b2-modal2", topic: "modal verbs", level: 3.5, text: "You ___ have seen her — she left an hour ago.", options: ["can't", "mustn't", "shouldn't"], answer: "can't" },

  // --- C1 (4.5) ---
  { id: "c1-voc1", topic: "vocabulary", level: 4.5, text: "The report was ___: every claim was backed by data.", options: ["meticulous", "tedious", "ample"], answer: "meticulous" },
  { id: "c1-cond2", topic: "conditionals", level: 4.5, text: "Were it not for your help, I ___ failed.", options: ["would have", "would", "will have"], answer: "would have" },
  { id: "c1-ger1", topic: "gerunds & infinitives", level: 4.5, text: "She resented ___ to justify every decision.", options: ["having", "to have", "have"], answer: "having" },
  { id: "c1-modal1", topic: "modal verbs", level: 4.5, text: "He ___ have known the risks — he's an expert.", options: ["must", "could", "might"], answer: "must" },
  { id: "c1-prep1", topic: "prepositions", level: 4.5, text: "The findings are consistent ___ earlier studies.", options: ["with", "to", "of"], answer: "with" },
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
