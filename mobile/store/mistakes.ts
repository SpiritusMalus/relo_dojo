// Mistake capture — resurface the *exact* item the learner missed, not just the topic.
//
// Exercises are LLM-generated (not a fixed bank), so to replay a miss we keep the whole Exercise plus
// its sealed grading token; /check regrades it deterministically later (tokens carry no TTL, so they
// stay valid in prod where CHECK_SECRET is set). Stored locally in AsyncStorage, capped and FIFO.
// A correct answer in Review resolves (removes) the item; missing it again just bumps the counter.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Exercise } from "../services/api";

const STORAGE_KEY = "grammar-dojo/mistakes/v1";
export const MISTAKES_CAP = 40;

export type Mistake = {
  id: string;
  exercise: Exercise;
  topic: string;
  missedAt: string; // ISO timestamp of the latest miss
  misses: number; // how many times this exact item has been missed
};

// Stable identity for an exercise: same prompt/text/type/topic == same item (dedupes repeat misses).
export function mistakeId(ex: Exercise): string {
  return `${ex.type}|${ex.topic}|${ex.prompt}|${ex.text}`;
}

// Pure: insert or update a miss at the front, dedup by id, cap the list. Newest-first.
export function upsertMistake(list: Mistake[], ex: Exercise, now: string): Mistake[] {
  const id = mistakeId(ex);
  const prev = list.find((m) => m.id === id);
  const entry: Mistake = {
    id,
    exercise: ex,
    topic: ex.topic,
    missedAt: now,
    misses: (prev?.misses ?? 0) + 1,
  };
  const rest = list.filter((m) => m.id !== id);
  return [entry, ...rest].slice(0, MISTAKES_CAP);
}

// Exercise types whose `text` is a real example sentence (so it's useful to feed back to the
// generator). build/match/order use a generic instruction in `text`, so they're skipped here.
const SENTENCE_TYPES = new Set(["multiple-choice", "tap-the-error", "multiple-blanks", "odd-one-out"]);
export const MAX_MISTAKE_HINTS = 3;

/** Recent missed example sentences for one topic (newest-first, deduped, capped) — fed to /exercise
 *  so a new item drills the same weak point. Pure: takes the already-loaded list. */
export function mistakeHintsForTopic(list: Mistake[], topic: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of list) {
    if (m.topic !== topic || !SENTENCE_TYPES.has(m.exercise.type)) continue;
    const text = (m.exercise.text ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= MAX_MISTAKE_HINTS) break;
  }
  return out;
}

async function save(list: Mistake[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // best-effort cache; a failed write just means this miss isn't remembered
  }
}

export async function loadMistakes(): Promise<Mistake[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(data) ? (data as Mistake[]) : [];
  } catch {
    return [];
  }
}

// Capture a missed exercise. Only interactive (token-bearing) items can be replayed/regraded.
export async function captureMistake(ex: Exercise): Promise<void> {
  if (!ex.token) return;
  const list = await loadMistakes();
  await save(upsertMistake(list, ex, new Date().toISOString()));
}

// Remove an item once it's been answered correctly (or is stale/unusable).
export async function resolveMistake(id: string): Promise<void> {
  const list = await loadMistakes();
  await save(list.filter((m) => m.id !== id));
}

export async function mistakeCount(): Promise<number> {
  return (await loadMistakes()).length;
}
