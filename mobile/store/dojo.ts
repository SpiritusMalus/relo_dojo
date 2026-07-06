// Presentational derivations for the dojo redesign — belt, "% to next belt", per-topic rows, and the
// Home "belt journey" path. Pure functions over the existing Progress snapshot; NOTHING is persisted
// (the README requires deriving these, not storing new data).
import { levelToCefr, skillFor, TOPIC_PRIORS } from "./adaptive";
import { CURRICULUM, masteryOf, unitDecayed, type Mastery } from "./curriculum";
import { totalAttempts, type Progress } from "./progress";
import { beltByCefr, beltByIndex, type Belt, type Cefr } from "../theme/theme";

/** Has the account produced real evidence of achievement? The seeded skill estimate (START_LEVEL ≈ A2)
 *  is fine for picking difficulty but is NOT achievement — only answered items or a passed belt exam
 *  count. Used to keep the *display* honest (never lie): no earned belt / accuracy / % before evidence. */
export function hasEvidence(p: Progress): boolean {
  return totalAttempts(p) > 0 || p.beltEarned !== undefined;
}

// Short label + dev-flavoured hint per canonical topic key (keys match backend/adaptive).
export const TOPIC_META: Record<string, { label: string; hint: string }> = {
  prepositions: { label: "Prepositions", hint: "in · on · at" },
  conditionals: { label: "Conditionals", hint: "if … then …" },
  "verb sequence (tense agreement)": { label: "Verb tenses", hint: "tense agreement" },
  vocabulary: { label: "Vocabulary", hint: "dev words" },
  articles: { label: "Articles", hint: "a · an · the" },
  "modal verbs": { label: "Modal verbs", hint: "can · must · should" },
  "phrasal verbs": { label: "Phrasal verbs", hint: "roll back, spin up" },
  "gerunds & infinitives": { label: "Gerunds & infinitives", hint: "to do · doing" },
  "comparatives & superlatives": { label: "Comparatives", hint: "faster · fastest" },
  "word order": { label: "Word order", hint: "subject · verb · object" },
  punctuation: { label: "Punctuation", hint: ", ; : —" },
};

// The journey order IS the course syllabus (store/curriculum.ts): CEFR-banded, Core-Inventory
// informed — not the TOPIC_META insertion order.
export const TOPIC_ORDER = CURRICULUM.map((u) => u.topic);

export type TopicRow = {
  id: string;
  label: string;
  hint: string;
  skill: number; // 0..5
  cefr: Cefr;
  belt: Belt;
  acc: number; // 0..100 — meaningful only when `started`; 0 otherwise (UI shows "—")
  attempts: number;
  weak: boolean;
  started: boolean; // false until the learner has answered ≥1 item in this topic (not-started row)
};


/** One display row per topic, derived from skill + attempt history. `skill`/`cefr` stay populated for
 *  internal callers (difficulty/path), but a topic with no attempts reads as not-started: no fabricated
 *  accuracy from the seeded skill estimate (display-honesty rule). */
export function topicRow(p: Progress, id: string): TopicRow {
  const meta = TOPIC_META[id] ?? { label: id, hint: "" };
  const skill = skillFor(p, id);
  const cefr = levelToCefr(skill);
  const st = p.topics[id];
  const attempts = st?.attempts ?? 0;
  const started = attempts > 0;
  // Accuracy is shown ONLY with real evidence. An untouched topic is not-started (acc 0, UI shows "—"),
  // never a skill/5 estimate masquerading as earned accuracy.
  const acc = started ? Math.round((st!.correct / attempts) * 100) : 0;
  const weak = attempts >= 3 && acc < 60;
  return { id, label: meta.label, hint: meta.hint, skill, cefr, belt: beltByCefr(cefr), acc, attempts, weak, started };
}

export function topicRows(p: Progress): TopicRow[] {
  return TOPIC_ORDER.map((id) => topicRow(p, id));
}

/** Lowest-accuracy topics with enough evidence — drives the "focus" red styling. */
export function weakTopics(p: Progress): TopicRow[] {
  return topicRows(p)
    .filter((r) => r.weak)
    .sort((a, b) => a.acc - b.acc);
}

export type BeltProgress = {
  overallSkill: number; // 0..5 mean across topics
  cefr: Cefr;
  belt: Belt;
  nextBelt: Belt;
  pctToNext: number; // 0..100 within the current band
  atMax: boolean;
  started: boolean; // false = no earned evidence yet → worn belt forced to White, pctToNext 0
};

/** Raw skill-derived belt index (0..5), BEFORE the exam cap — the exam logic compares against it. */
export function skillBeltIdx(p: Progress): number {
  const ids = Object.keys(TOPIC_PRIORS);
  const mean = ids.reduce((s, id) => s + skillFor(p, id), 0) / Math.max(1, ids.length);
  return beltByCefr(levelToCefr(Math.max(0, Math.min(4.999, mean)))).idx;
}

/** Overall belt + progress toward the next, from the mean per-topic skill.
 *  Honesty gate: the WORN belt must be earned. With no evidence yet (no attempts, no passed exam) the
 *  seeded skill estimate (≈A2) must NOT raise the worn belt above White — that would fabricate
 *  achievement for a brand-new account. Once there's evidence the belt may rise with skill.
 *  Belt-exam cap: once `beltEarned` exists, the WORN belt is the earned one — skill past it shows
 *  a full bar (the exam is the gate). `cefr`/`overallSkill` stay skill-derived: exercise difficulty
 *  must keep adapting (a fresh user still gets sensible A2-ish items). */
export function beltProgress(p: Progress): BeltProgress {
  const ids = Object.keys(TOPIC_PRIORS);
  const mean = ids.reduce((s, id) => s + skillFor(p, id), 0) / Math.max(1, ids.length);
  const overallSkill = Math.max(0, Math.min(4.999, mean));
  const cefr = levelToCefr(overallSkill);
  const earned = p.beltEarned;
  const started = hasEvidence(p);
  let belt = beltByCefr(cefr);
  let pctToNext = Math.round((overallSkill - Math.floor(overallSkill)) * 100);
  if (!started) {
    belt = beltByIndex(0); // White — the honest default before any earned evidence
    pctToNext = 0;
  } else if (earned !== undefined && earned < belt.idx) {
    belt = beltByIndex(earned);
    pctToNext = 100; // skill has outgrown the worn belt — the exam node is "ready"
  } else if (earned !== undefined && earned > belt.idx) {
    belt = beltByIndex(Math.min(earned, 5)); // earned is authoritative once set (sync quirks)
  }
  const nextBelt = beltByIndex(belt.idx + 1);
  // Return the CLAMPED skill (same min(4.999, mean) that cefr/belt/pct are derived from) so every field
  // in this object is consistent — the raw uncapped mean could read as C1 (5.0) while cefr caps at 4.999.
  return { overallSkill, cefr, belt, nextBelt, pctToNext, atMax: belt.idx >= 5, started };
}

// "review" = a passed unit whose RECENT answers dipped (unitDecayed) — mastery stays (one-way),
// but the node visibly asks for a recertification (the re-зачёт on the checkpoint screen).
export type NodeState = "done" | "review" | "ready" | "current" | "next" | "locked" | "test";
export type PathNode = { state: NodeState; topic?: TopicRow; band?: Cefr; mastery?: Mastery };

/** The Home "belt journey" = the course track: syllabus-ordered units + a final belt-test node.
 *  States: done → ready/current (first unmastered) → next → locked.
 *
 *  Mastery is EVIDENCE + a CEREMONY (store/curriculum.ts): enough recent correct answers with a
 *  minimum in non-guessable formats makes the unit "ready" — then a closed-book checkpoint (зачёт)
 *  promotes it to mastered (progress.course.mastered, one-way, via the checkpoint screen). Neither
 *  a seeded/placement skill estimate nor a lucky single answer reads as mastered (display-honesty
 *  rule) — and the gate is the point: the next unit opens only after this one is actually learned
 *  and sealed.
 *
 *  The path is computed over the WHOLE syllabus and windowed to `count` rows so the current unit is
 *  always visible (before: slicing first-N hid the current unit once the learner passed N topics). */
export function buildPath(p: Progress, count = 6): { nodes: PathNode[]; doneCount: number; total: number } {
  const mastered = new Set(p.course?.mastered ?? []);
  const currentIdx = TOPIC_ORDER.findIndex((id) => !mastered.has(id));

  const all: PathNode[] = TOPIC_ORDER.map((id, i) => {
    const mastery = masteryOf(p.course?.history[id]);
    let state: NodeState;
    if (currentIdx === -1 || i < currentIdx) {
      // Passed units stay passed — but one whose recent answers dipped surfaces as "review"
      // (просадка): the node offers the recertification instead of reading as quietly done.
      state = unitDecayed(p.course?.history[id]) ? "review" : "done";
    }
    else if (i === currentIdx) state = mastery.met ? "ready" : "current"; // meter full → зачёт awaits
    else if (i === currentIdx + 1) state = "next";
    else state = "locked";
    return {
      state,
      topic: topicRow(p, id),
      band: CURRICULUM[i].band,
      mastery: state === "ready" || state === "current" || state === "next" ? mastery : undefined,
    };
  });

  const total = all.length;
  // A decayed ("review") unit is still a PASSED unit — the счётчик must not un-count it.
  const doneCount = all.filter((n) => n.state === "done" || n.state === "review").length;
  // Window `count` rows with the current unit in view (one done row of context above it).
  const anchor = currentIdx === -1 ? total : currentIdx;
  const start = Math.max(0, Math.min(anchor - 1, total - count));
  const nodes = all.slice(start, start + count);
  nodes.push({ state: "test" });
  return { nodes, doneCount, total };
}
