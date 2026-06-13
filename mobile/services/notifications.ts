// Local notifications — the trigger layer (monetization branch 6). The whole retention loop
// starts OUTSIDE the app: these are the taps on the shoulder that bring the user back.
//
// Strategy (rescheduled wholesale on every relevant state change — local notifications can't read
// state, so we precompute the future and cancel/replace):
// - daily call    19:00 gentle Sensei line — only while today's training isn't done
// - escalation    21:30 the streak is named and counted: "N дней сгорит сегодня" (loss aversion
//                 needs a concrete number) — only if a streak exists and today isn't done
// - tomorrow      19:00 gentle (in case the app isn't opened at all)
// - win-back      +3d and +7d of silence: Sensei waits. Re-planned on every open, so they only
//                 ever fire after real absence.
//
// All texts go through the same Sensei voice — pressure, but in-character (никакой паники совы).
// NOTE: Notifications don't work in Expo Go on Android (SDK 53+). Safe to skip in dev; use
// development build for full notification testing.

import { Platform } from "react-native";
import type { Lang } from "../i18n/strings";
import type { DiaryRecap } from "../store/diary";

// Conditional import: skip if notifications aren't available (e.g., Expo Go on Android SDK 53+)
let Notifications: typeof import("expo-notifications") | null = null;
try {
  Notifications = require("expo-notifications");
} catch {
  // Notifications unavailable — functions will safely no-op below
}

export const DAILY_HOUR = 19; // default when the learner hasn't picked a time
export const ESCALATION_GAP_H = 2.5; // escalation follows the gentle call by 2.5h
export const LATEST_ESCALATION_HOUR = 23.5; // never past 23:30 — it must land before midnight
export const WINBACK_DAYS = [3, 7] as const;
export const WINBACK_HOUR = 12;
export const RECAP_DOW = 0; // Sunday (JS getDay(): 0 = Sun) — the week's results land as a reason to return
export const RECAP_HOUR = 11; // late Sunday morning, clear of the 19:00 daily call

/** Pure: the two daily hours for a chosen reminder time (default 19:00 → escalation 21:30).
 *  The escalation is capped so a late reminder still names the streak BEFORE it burns. */
export function plannedHours(remindHour?: number): { daily: number; escalation: number } {
  const daily = typeof remindHour === "number" && remindHour >= 0 && remindHour <= 23 ? remindHour : DAILY_HOUR;
  return { daily, escalation: Math.min(LATEST_ESCALATION_HOUR, daily + ESCALATION_GAP_H) };
}

const GENTLE: Record<Lang, string[]> = {
  ru: [
    "Мат разложен. Пять минут?",
    "Сэнсэй заварил чай и ждёт.",
    "Ката дня ещё не сделана.",
    "Додзё открыто. Один короткий подход.",
  ],
  en: [
    "The mat is rolled out. Five minutes?",
    "Sensei has brewed the tea and waits.",
    "Today's kata is still undone.",
    "The dojo is open. One short set.",
  ],
};

const ESCALATION: Record<Lang, (n: number) => string> = {
  ru: (n) => `🔥 Серия из ${n} дней сгорит сегодня в полночь. Сэнсэй верит, что ты успеешь.`,
  en: (n) => `🔥 Your ${n}-day streak burns out at midnight. Sensei believes you'll make it.`,
};

// Contracts-aware daily nudge (engagement v2): when contracts are still open, name them — a concrete
// reason to return beats a generic "come practice". Pure + exported so it's unit-testable.
const CONTRACTS: Record<Lang, (n: number) => string> = {
  ru: (n) => `📜 ${n} контракт(а) от Сэнсэя ждут сегодня. Выходи на мат.`,
  en: (n) => `📜 ${n} contract(s) from Sensei await today. Step onto the mat.`,
};

export function contractsReminder(lang: Lang, n: number): string {
  return CONTRACTS[lang](n);
}

const WINBACK: Record<Lang, Record<number, string>> = {
  ru: {
    3: "Сэнсэй всё ещё ждёт. Мат не тронут уже три дня.",
    7: "Додзё пустует неделю. Один урок — и путь продолжится.",
  },
  en: {
    3: "Sensei is still waiting. The mat has been untouched for three days.",
    7: "The dojo has been empty for a week. One lesson resumes the path.",
  },
};

// Weekly recap (student diary). The summary is built from the finished week's DiaryRecap; same
// in-character Sensei voice, fired Sunday late-morning — a celebratory reason to return, not a nag.
const RECAP: Record<Lang, (r: DiaryRecap) => string> = {
  ru: (r) => `📜 Итоги недели: ${r.correct} чистых ответов, +${r.xp} XP. Новая неделя открыта — выходи на мат.`,
  en: (r) => `📜 Your week: ${r.correct} clean answers, +${r.xp} XP. A fresh week opens — step onto the mat.`,
};

/** A recap is worth announcing only if the week saw real practice (mirrors diary's idle-week guard). */
export function recapHasContent(recap?: DiaryRecap | null): recap is DiaryRecap {
  return !!recap && recap.correct + recap.slips > 0;
}

let configured = false;

function configureOnce(): void {
  if (configured || !Notifications) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync("default", {
      name: "Sensei",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/** Ask once for permission. Returns whether notifications are allowed. */
export async function ensurePermission(): Promise<boolean> {
  if (!Notifications) return false; // Notifications unavailable (e.g., Expo Go on Android)
  configureOnce();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

function at(daysFromToday: number, hour: number, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday);
  d.setMinutes(Math.round((hour % 1) * 60));
  d.setHours(Math.floor(hour));
  return d;
}

function pick(pool: string[], seed: number): string {
  return pool[seed % pool.length];
}

/** Pure: the next occurrence of weekday `dow` (0=Sun..6=Sat) at `hour`, strictly in the future. */
export function nextWeekday(dow: number, hour: number, now: Date): Date {
  const delta = (dow - now.getDay() + 7) % 7;
  const candidate = at(delta, hour, now);
  return candidate.getTime() > now.getTime() ? candidate : at(delta + 7, hour, now);
}

export type ScheduleState = {
  lang: Lang;
  trainedToday: boolean; // practiced today → today's nags are off
  dailyStreak: number;
  remindHour?: number; // learner-chosen reminder hour (0..23); default DAILY_HOUR
  recap?: DiaryRecap | null; // last finished week's diary recap → Sunday summary notification
  contractsLeft?: number; // open daily contracts → the daily nudge names them instead of a generic line
};

/** Cancel everything and re-plan the future from the current state. Safe to call often. */
export async function rescheduleAll(state: ScheduleState, now: Date = new Date()): Promise<void> {
  if (!Notifications) return; // Notifications unavailable (e.g., Expo Go on Android)
  configureOnce();
  await Notifications.cancelAllScheduledNotificationsAsync();
  const seed = now.getDate();
  const plans: { date: Date; body: string }[] = [];
  const { daily, escalation } = plannedHours(state.remindHour);

  if (!state.trainedToday) {
    const todayBody =
      state.contractsLeft && state.contractsLeft > 0
        ? contractsReminder(state.lang, state.contractsLeft)
        : pick(GENTLE[state.lang], seed);
    plans.push({ date: at(0, daily, now), body: todayBody });
    if (state.dailyStreak > 0) {
      plans.push({ date: at(0, escalation, now), body: ESCALATION[state.lang](state.dailyStreak) });
    }
  }
  // Tomorrow's gentle call (replaced with a fresh plan as soon as the app is opened again).
  plans.push({ date: at(1, daily, now), body: pick(GENTLE[state.lang], seed + 1) });
  // Win-back ladder — only fires after genuine silence (every open re-plans it away).
  for (const days of WINBACK_DAYS) {
    plans.push({ date: at(days, WINBACK_HOUR, now), body: WINBACK[state.lang][days] });
  }
  // Weekly recap — Sunday summary of the finished week (re-planned to the latest recap on each open).
  if (recapHasContent(state.recap)) {
    plans.push({ date: nextWeekday(RECAP_DOW, RECAP_HOUR, now), body: RECAP[state.lang](state.recap) });
  }

  await Promise.all(
    plans
      .filter((p) => p.date.getTime() > now.getTime())
      .map((p) =>
        Notifications.scheduleNotificationAsync({
          content: { title: "Grammar Dojo", body: p.body },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.date },
        })
      )
  );
}
