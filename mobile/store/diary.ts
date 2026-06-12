// Student diary (pure, unit-testable): a weekly auto-recap built from snapshot deltas.
//
// Stats are cumulative, so the diary keeps a weekly BASELINE in the profile (xp / per-topic
// correct & attempts at week start). When ≥7 days have passed, the finished week becomes a
// human recap (XP earned, answers right, slips reframed as material, the week's best topic)
// and a fresh baseline starts. tickDiary is called from Home; the recap renders on Progress.
import type { Progress } from "./progress";

export const DIARY_WEEK_DAYS = 7;

export type DiaryRecap = {
  from: string;
  to: string;
  xp: number;
  correct: number;
  slips: number;
  topTopic: string; // topic with the most correct answers this week ("" if none)
};

export type DiaryState = {
  date: string; // current week's baseline date
  baseXp: number;
  baseTopics: Record<string, { attempts: number; correct: number }>;
  last?: DiaryRecap; // the finished week's recap (what the card shows)
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / 86400000
  );
}

function snapshot(p: Progress, today: string, last?: DiaryRecap): DiaryState {
  const baseTopics: DiaryState["baseTopics"] = {};
  for (const [t, st] of Object.entries(p.topics)) {
    baseTopics[t] = { attempts: st.attempts, correct: st.correct };
  }
  return { date: today, baseXp: p.xp, baseTopics, ...(last ? { last } : {}) };
}

/** Build the recap of the week that started at `diary.date`, from cumulative deltas. */
export function buildRecap(p: Progress, diary: DiaryState, today: string): DiaryRecap {
  let correct = 0;
  let attempts = 0;
  let topTopic = "";
  let topCorrect = 0;
  for (const [t, st] of Object.entries(p.topics)) {
    const base = diary.baseTopics[t] ?? { attempts: 0, correct: 0 };
    const dc = Math.max(0, st.correct - base.correct);
    correct += dc;
    attempts += Math.max(0, st.attempts - base.attempts);
    if (dc > topCorrect) {
      topCorrect = dc;
      topTopic = t;
    }
  }
  return {
    from: diary.date,
    to: today,
    xp: Math.max(0, p.xp - diary.baseXp),
    correct,
    slips: Math.max(0, attempts - correct),
    topTopic,
  };
}

/** The weekly tick: returns the new DiaryState to store, or null when nothing changes.
 *  - no diary yet → start the first baseline (no recap to show)
 *  - week finished → recap it (only if the week saw any practice) and start a new baseline */
export function tickDiary(p: Progress, today: string): DiaryState | null {
  if (!p.onboarded) return null;
  const diary = p.profile?.diary;
  if (!diary) return snapshot(p, today);
  if (daysBetween(diary.date, today) < DIARY_WEEK_DAYS) return null;
  const recap = buildRecap(p, diary, today);
  // An idle week produces no diary entry — the previous recap stays on display.
  return snapshot(p, today, recap.correct + recap.slips > 0 ? recap : diary.last);
}
