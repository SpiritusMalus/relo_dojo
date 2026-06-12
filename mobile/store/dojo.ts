// Presentational derivations for the dojo redesign — belt, "% to next belt", per-topic rows, and the
// Home "belt journey" path. Pure functions over the existing Progress snapshot; NOTHING is persisted
// (the README requires deriving these, not storing new data).
import { levelToCefr, skillFor, TOPIC_PRIORS } from "./adaptive";
import type { Progress } from "./progress";
import { beltByCefr, beltByIndex, type Belt, type Cefr } from "../theme/theme";

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

// Stable curriculum order for the journey path.
export const TOPIC_ORDER = Object.keys(TOPIC_META);

export type TopicRow = {
  id: string;
  label: string;
  hint: string;
  skill: number; // 0..5
  cefr: Cefr;
  belt: Belt;
  acc: number; // 0..100
  attempts: number;
  weak: boolean;
};

const MASTERED_SKILL = 3.5; // ≈ B2 — counts as "mastered" on the path

/** One display row per topic, derived from skill + attempt history. */
export function topicRow(p: Progress, id: string): TopicRow {
  const meta = TOPIC_META[id] ?? { label: id, hint: "" };
  const skill = skillFor(p, id);
  const cefr = levelToCefr(skill);
  const st = p.topics[id];
  const attempts = st?.attempts ?? 0;
  // Accuracy: real ratio once there's evidence, otherwise a skill-based estimate.
  const acc = attempts > 0 ? Math.round((st!.correct / attempts) * 100) : Math.round((skill / 5) * 100);
  const weak = attempts >= 3 && acc < 60;
  return { id, label: meta.label, hint: meta.hint, skill, cefr, belt: beltByCefr(cefr), acc, attempts, weak };
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
};

/** Raw skill-derived belt index (0..5), BEFORE the exam cap — the exam logic compares against it. */
export function skillBeltIdx(p: Progress): number {
  const ids = Object.keys(TOPIC_PRIORS);
  const mean = ids.reduce((s, id) => s + skillFor(p, id), 0) / Math.max(1, ids.length);
  return beltByCefr(levelToCefr(Math.max(0, Math.min(4.999, mean)))).idx;
}

/** Overall belt + progress toward the next, from the mean per-topic skill.
 *  Belt-exam cap: once `beltEarned` exists, the WORN belt is the earned one — skill past it shows
 *  a full bar (the exam is the gate). `cefr` stays skill-derived: exercise difficulty must keep
 *  adapting even while a promotion is pending. Legacy snapshots (no beltEarned) are unchanged. */
export function beltProgress(p: Progress): BeltProgress {
  const ids = Object.keys(TOPIC_PRIORS);
  const mean = ids.reduce((s, id) => s + skillFor(p, id), 0) / Math.max(1, ids.length);
  const overallSkill = Math.max(0, Math.min(4.999, mean));
  const cefr = levelToCefr(overallSkill);
  let belt = beltByCefr(cefr);
  let pctToNext = Math.round((overallSkill - Math.floor(overallSkill)) * 100);
  const earned = p.beltEarned;
  if (earned !== undefined && earned < belt.idx) {
    belt = beltByIndex(earned);
    pctToNext = 100; // skill has outgrown the worn belt — the exam node is "ready"
  } else if (earned !== undefined && earned > belt.idx) {
    belt = beltByIndex(Math.min(earned, 5)); // earned is authoritative once set (sync quirks)
  }
  const nextBelt = beltByIndex(belt.idx + 1);
  return { overallSkill: mean, cefr, belt, nextBelt, pctToNext, atMax: belt.idx >= 5 };
}

export type NodeState = "done" | "current" | "next" | "locked" | "test";
export type PathNode = { state: NodeState; topic?: TopicRow };

/** The Home "belt journey": the first `count` topics as a rail of nodes + a final belt-test node.
 *  States: done (mastered) → current (first unmastered) → next (the one after) → locked (rest). */
export function buildPath(p: Progress, count = 6): { nodes: PathNode[]; doneCount: number; total: number } {
  const rows = TOPIC_ORDER.slice(0, count).map((id) => topicRow(p, id));
  const currentIdx = rows.findIndex((r) => r.skill < MASTERED_SKILL);

  const nodes: PathNode[] = rows.map((r, i) => {
    let state: NodeState;
    if (currentIdx === -1) state = "done"; // everything mastered
    else if (i < currentIdx) state = "done";
    else if (i === currentIdx) state = "current";
    else if (i === currentIdx + 1) state = "next";
    else state = "locked";
    return { state, topic: r };
  });
  nodes.push({ state: "test" });

  const doneCount = nodes.filter((n) => n.state === "done").length;
  return { nodes, doneCount, total: rows.length };
}
