import type { LearningGoal } from "../store/nextLearningGoal";

export function learningLoopCopy(lang: "ru" | "en") {
  const ru = lang === "ru";
  return {
    dojo: ru ? "Моё додзё" : "My dojo",
    dojoMilestone: (done: number, days: number) => ru ? `Дни практики: ${done} из ${days} до следующего предмета` : `Practice days: ${done} of ${days} toward your next item`,
    dojoPreview: ru ? "Устрой место для своей практики" : "Make a place for your practice",
    dojoReady: ru ? "Твои предметы и дни практики" : "Your items and practice days",
    loadingGoal: ru ? "Выбираем следующий шаг…" : "Finding your next step…",
    back: ru ? "На главную" : "Back to Home",
    welcomeBack: ru ? "Рад тебя видеть. Начнём с небольшого шага." : "Good to see you. Let's start with a small step.",
    allModes: ru ? "Все тренировки" : "All practice modes",
    mix: ru ? "Микс дня" : "Daily mix",
    next: ru ? "Следующий шаг" : "Next step",
    withHint: ru ? "С подсказкой" : "With a hint",
    unassisted: (n: number, total: number) => ru ? `Верно без подсказок: ${n} из ${total}` : `Correct without hints: ${n} of ${total}`,
    koku: (n: number) => ru ? `+${n} коку` : `+${n} koku`,
    roomSaved: ru ? "День практики записан в додзё" : "Practice day saved in your dojo",
    roomPending: ru ? "Занятие закончено. Проверь запись дня, когда появится связь." : "Lesson finished. Check your saved dojo day when you're connected.",
    roomSaving: ru ? "Сохраняем день практики…" : "Saving your practice day…",
    roomExpired: ru ? "Для записи дня в додзё нужна новая тренировка." : "Start a new practice session to record a dojo day.",
    retry: ru ? "Проверить сохранение" : "Check saved practice",
    nextReview: (date: string) => ru ? `Следующее повторение — ${date}` : `Next review: ${date}`,
    reviewReady: (n: number) => ru ? `К повторению: ${n}` : `Ready to review: ${n}`,
    reviewHint: ru ? "Повторим ещё раз без подсказки — тогда перенесём задание дальше." : "Try it again without a hint before moving its next review forward.",
    goal: (goal: LearningGoal, topic: string) => {
      switch (goal.kind) {
        case "review": return {
          title: ru ? "Вспомнить и закрепить" : "Recall and reinforce",
          description: ru ? `Повторим то, что пора вспомнить. Заданий: ${goal.dueCount}.` : `${goal.dueCount} items from your mistakes are due today.`,
          action: ru ? "Начать повторение" : "Start review",
        };
        case "checkpoint": return {
          title: topic,
          description: ru ? "Практики достаточно. Закрепим результат коротким зачётом." : "Your practice is ready. Confirm it with a short checkpoint.",
          action: ru ? "Пройти зачёт" : "Take the checkpoint",
        };
        case "course": return {
          title: topic,
          description: ru ? "Десять заданий по следующей теме твоего пути." : "Ten exercises for the next topic on your path.",
          action: ru ? "Начать тренировку" : "Start practice",
        };
        case "weak": return {
          title: topic,
          description: ru ? "Разберём тему, которая пока даётся труднее." : "Work on a topic that needs a little more practice.",
          action: ru ? "Потренироваться" : "Practise this topic",
        };
        default: return {
          title: ru ? "Микс дня" : "Daily mix",
          description: ru ? "Десять заданий по твоим темам." : "Ten exercises across your topics.",
          action: ru ? "Начать тренировку" : "Start practice",
        };
      }
    },
  };
}
