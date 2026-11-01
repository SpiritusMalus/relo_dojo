import type { LearningGoal } from "../store/nextLearningGoal";

export function learningLoopCopy(lang: "ru" | "en") {
  const ru = lang === "ru";
  return {
    dojo: ru ? "Моё додзё" : "My dojo",
    dojoMilestone: (done: number, days: number) => ru ? `До следующего предмета: ${done} / ${days} дней` : `Next item: ${done} / ${days} practice days`,
    dojoReady: ru ? "Все предметы за практику собраны" : "All practice pieces collected",
    loadingGoal: ru ? "Выбираем следующий шаг…" : "Finding your next step…",
    back: ru ? "На главную" : "Back to Home",
    welcomeBack: ru ? "С возвращением" : "Welcome back",
    allModes: ru ? "Все тренировки" : "All practice modes",
    mix: ru ? "Микс дня" : "Daily mix",
    next: ru ? "Следующий шаг" : "Next step",
    withHint: ru ? "С подсказкой" : "With a hint",
    unassisted: (n: number, total: number) => ru ? `Верно без подсказок: ${n} из ${total}` : `Correct without hints: ${n} of ${total}`,
    koku: (n: number) => ru ? `+${n} коку` : `+${n} koku`,
    roomSaved: ru ? "День практики засчитан" : "Practice day recorded",
    roomPending: ru ? "Занятие закончено. Проверь запись дня, когда появится связь." : "Lesson finished. Check your saved dojo day when you're connected.",
    roomSaving: ru ? "Сохраняем день практики…" : "Saving your practice day…",
    roomExpired: ru ? "Для записи дня в додзё нужна новая тренировка." : "Start a new practice session to record a dojo day.",
    retry: ru ? "Проверить сохранение" : "Check saved practice",
    nextReview: (date: string) => ru ? `Следующее повторение — ${date}` : `Next review: ${date}`,
    reviewReady: (n: number) => ru ? `К повторению: ${n}` : `Ready to review: ${n}`,
    reviewHint: ru ? "Попробуй ещё раз без подсказки" : "Try again without a hint",
    goal: (goal: LearningGoal, topic: string) => {
      switch (goal.kind) {
        case "review": return {
          title: ru ? "Вспомнить и закрепить" : "Recall and reinforce",
          description: ru ? `К повторению: ${goal.dueCount}` : `Ready to review: ${goal.dueCount}`,
          action: ru ? "Начать повторение" : "Start review",
        };
        case "checkpoint": return {
          title: topic,
          description: ru ? "Готово к зачёту" : "Ready for a checkpoint",
          action: ru ? "Пройти зачёт" : "Take the checkpoint",
        };
        case "course": return {
          title: topic,
          description: ru ? "10 заданий по теме" : "10 exercises on this topic",
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
