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

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Lang } from "../i18n/strings";

export const DAILY_HOUR = 19;
export const ESCALATION_HOUR = 21.5; // 21:30
export const WINBACK_DAYS = [3, 7] as const;
export const WINBACK_HOUR = 12;

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

let configured = false;

function configureOnce(): void {
  if (configured) return;
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

export type ScheduleState = {
  lang: Lang;
  trainedToday: boolean; // practiced today → today's nags are off
  dailyStreak: number;
};

/** Cancel everything and re-plan the future from the current state. Safe to call often. */
export async function rescheduleAll(state: ScheduleState, now: Date = new Date()): Promise<void> {
  configureOnce();
  await Notifications.cancelAllScheduledNotificationsAsync();
  const seed = now.getDate();
  const plans: { date: Date; body: string }[] = [];

  if (!state.trainedToday) {
    plans.push({ date: at(0, DAILY_HOUR, now), body: pick(GENTLE[state.lang], seed) });
    if (state.dailyStreak > 0) {
      plans.push({ date: at(0, ESCALATION_HOUR, now), body: ESCALATION[state.lang](state.dailyStreak) });
    }
  }
  // Tomorrow's gentle call (replaced with a fresh plan as soon as the app is opened again).
  plans.push({ date: at(1, DAILY_HOUR, now), body: pick(GENTLE[state.lang], seed + 1) });
  // Win-back ladder — only fires after genuine silence (every open re-plans it away).
  for (const days of WINBACK_DAYS) {
    plans.push({ date: at(days, WINBACK_HOUR, now), body: WINBACK[state.lang][days] });
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
