// Mistake capture — resurface the *exact* item the learner missed, not just the topic.
//
// Exercises are LLM-generated (not a fixed bank), so to replay a miss we keep the whole Exercise plus
// its sealed grading token; /check regrades it deterministically later (tokens carry no TTL, so they
// stay valid in prod where CHECK_SECRET is set). Stored locally in AsyncStorage, capped and FIFO.
//
// Spaced repetition (Leitner): each item carries a box (0..N) and a due date. A miss resets the item
// to box 0, due immediately (learning phase). A correct answer in Review promotes it one box and
// pushes the due date out by SRS_INTERVALS_D[box] days; a correct answer past the last box
// GRADUATES the item (removed — proven across 1/3/7/21-day gaps). Review sessions serve only DUE
// items, oldest first, so «повторение» means retrieval at spaced intervals, not re-reading today's
// misses forever.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Exercise } from "../services/api";

const STORAGE_KEY = "relo_dojo/mistakes/v1";
export const MISTAKES_CAP = 40;

// Days until the next review after a correct answer at box i. Box index past the end = graduated.
export const SRS_INTERVALS_D = [1, 3, 7, 21];

export type Mistake = {
  id: string;
  exercise: Exercise;
  topic: string;
  missedAt: string; // ISO timestamp of the latest miss
  misses: number; // how many times this exact item has been missed
  box?: number; // SRS box 0..SRS_INTERVALS_D.length; legacy items (undefined) read as 0
  due?: string; // ISO timestamp when the item is next due; legacy (undefined) reads as due now
};

// Stable identity for an exercise: same prompt/text/type/topic == same item (dedupes repeat misses).
export function mistakeId(ex: Exercise): string {
  return `${ex.type}|${ex.topic}|${ex.prompt}|${ex.text}`;
}

// Pure: insert or update a miss at the front, dedup by id, cap the list. Newest-first.
// A miss (re)sets the SRS state: box 0, due immediately — the item re-enters the learning phase
// however far up the ladder it had climbed.
export function upsertMistake(list: Mistake[], ex: Exercise, now: string): Mistake[] {
  const id = mistakeId(ex);
  const prev = list.find((m) => m.id === id);
  const entry: Mistake = {
    id,
    exercise: ex,
    topic: ex.topic,
    missedAt: now,
    misses: (prev?.misses ?? 0) + 1,
    box: 0,
    due: now,
  };
  const rest = list.filter((m) => m.id !== id);
  return [entry, ...rest].slice(0, MISTAKES_CAP);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** Pure: a correct answer in Review climbs the item one box and schedules the next review; past the
 *  last interval the item graduates (drops off the deck — proven across every spaced gap). */
export function promoteMistake(list: Mistake[], id: string, now: string): Mistake[] {
  const item = list.find((m) => m.id === id);
  if (!item) return list;
  const box = item.box ?? 0;
  // Correct past the last interval (box == length, i.e. the +21d review) → graduated.
  if (box >= SRS_INTERVALS_D.length) return list.filter((m) => m.id !== id);
  // Otherwise climb one box; the gap that EARNS the promotion is the one at the current box.
  const promoted: Mistake = { ...item, box: box + 1, due: addDays(now, SRS_INTERVALS_D[box]) };
  return list.map((m) => (m.id === id ? promoted : m));
}

/** Pure: items due for review at `now` (legacy items with no `due` are due immediately),
 *  longest-overdue first. */
export function dueMistakes(list: Mistake[], now: string): Mistake[] {
  return list
    .filter((m) => (m.due ?? "") <= now)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
}

/** Pure: the earliest upcoming due date among not-yet-due items, or null when nothing is scheduled. */
export function nextDueAt(list: Mistake[], now: string): string | null {
  const upcoming = list.map((m) => m.due ?? "").filter((d) => d > now);
  return upcoming.length ? upcoming.sort()[0] : null;
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

// Remove an item outright (stale/unusable token — no SRS credit).
export async function resolveMistake(id: string): Promise<void> {
  const list = await loadMistakes();
  await save(list.filter((m) => m.id !== id));
}

// Correct answer in Review: climb the SRS ladder (or graduate off the deck).
export async function promoteMistakeStored(id: string): Promise<void> {
  const list = await loadMistakes();
  await save(promoteMistake(list, id, new Date().toISOString()));
}

export async function mistakeCount(): Promise<number> {
  return (await loadMistakes()).length;
}

/** How many items are due for review right now (the number worth showing on the Review button). */
export async function dueCount(): Promise<number> {
  return dueMistakes(await loadMistakes(), new Date().toISOString()).length;
}
