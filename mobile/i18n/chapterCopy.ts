import type { ChapterId, ChapterSummary } from "../services/chapters";

const CHAPTERS = {
  en: {
    introduction: {
      title: "Introduce yourself",
      goal: "Meet someone new and tell them a little about yourself.",
      final: "Write a short introduction in English. Say who you are, what you do and something you enjoy. Two to four sentences are enough.",
      placeholder: "Hi, I'm…",
    },
    experience: {
      title: "Share an experience",
      goal: "Describe something you did and how it turned out.",
      final: "Write about an experience in English: what was happening, what you did and how it turned out. It can be from work, study or everyday life. Aim for two to four sentences.",
      placeholder: "Last…",
    },
    clarification: {
      title: "Ask for clarification",
      goal: "Ask a useful question when a message is unclear.",
      final: "Someone writes: “Let's meet at the usual place a bit earlier.” Reply in English and ask which place or time they mean.",
      placeholder: "Could you…",
    },
  },
  ru: {
    introduction: {
      title: "Познакомиться",
      goal: "Начать разговор и немного рассказать о себе.",
      final: "Представься по-английски: кто ты, чем занимаешься и что тебе нравится. Достаточно двух–четырёх предложений.",
      placeholder: "Hi, I'm…",
    },
    experience: {
      title: "Рассказать об опыте",
      goal: "Описать, что ты сделал и чем всё закончилось.",
      final: "Расскажи по-английски о прошлом опыте: что происходило, что ты сделал и чем всё закончилось. Подойдёт история из работы, учёбы или обычной жизни. Достаточно двух–четырёх предложений.",
      placeholder: "Last…",
    },
    clarification: {
      title: "Переспросить",
      goal: "Задать полезный вопрос, если сообщение непонятно.",
      final: "Тебе пишут: “Let's meet at the usual place a bit earlier.” Ответь по-английски: уточни, какое место или время имеется в виду.",
      placeholder: "Could you…",
    },
  },
};
export function chapterCopy(lang: string) {
  const ru = lang === "ru";
  return {
    title: ru ? "Главы" : "Chapters",
    accountDeleted: ru ? "Аккаунт удалён" : "Account deleted",
    erasePending: ru ? "Не удалось стереть черновики глав на этом устройстве. Доступ к ним заблокирован. Повтори очистку." : "Chapter drafts couldn't be erased from this device. Access is blocked. Try erasing them again.",
    retryErasure: ru ? "Повторить очистку" : "Retry erasing drafts",
    draftsErased: ru ? "Черновики удалены" : "Drafts erased",
    close: ru ? "Закрыть" : "Close",
    intro: ru ? "Потренируйся и примени английский в коротком разговоре." : "Practise, then use your English in a short exchange.",
    back: ru ? "Назад" : "Back",
    open: ru ? "Открыть главу" : "Open chapter",
    start: ru ? "Начать" : "Start",
    continue: ru ? "Продолжить" : "Continue",
    complete: ru ? "Пройдено" : "Completed",
    preparation: (n: number, total: number) => ru ? `Подготовка · ${n} из ${total}` : `Preparation · ${n} of ${total}`,
    finalTask: ru ? "Твой ответ" : "Your reply",
    path: ru ? "3 коротких задания и твой ответ" : "3 short exercises, then your reply",
    reward: ru ? "Предмет для додзё" : "A piece for your dojo",
    loading: ru ? "Открываем главу…" : "Opening your chapter…",
    checking: ru ? "Проверяем ответ…" : "Checking your reply…",
    check: ru ? "Проверить" : "Check",
    next: ru ? "Продолжить" : "Continue",
    tryAgain: ru ? "Повторить" : "Try again",
    checkSaved: ru ? "Проверить сохранение" : "Check saved result",
    pending: ru ? "Ответ отправлен. Проверим, сохранился ли результат." : "Your reply was sent. Check whether the result was saved.",
    offline: ru ? "Не удалось открыть главу. Проверь связь и попробуй ещё раз." : "The chapter couldn't load. Check your connection and try again.",
    draft: ru ? "Черновик" : "Draft",
    sendFailed: ru ? "Не удалось проверить ответ. Попробуй ещё раз." : "Your reply couldn't be checked. Try again.",
    draftFailed: ru ? "Не удалось сохранить черновик на устройстве. Не закрывай экран, пока не отправишь ответ." : "Your draft couldn't be saved on this device. Keep this screen open until you send it.",
    unavailable: ru ? "Эта глава пока недоступна." : "This chapter isn't available yet.",
    guest: ru ? "Войди, чтобы проходить главы, сохранять прогресс и получать предметы для додзё." : "Sign in to work through chapters, save your progress and earn pieces for your dojo.",
    login: ru ? "Войти" : "Sign in",
    done: ru ? "Глава пройдена" : "Chapter completed",
    saved: ru ? "Предмет сохранён в твоей коллекции." : "Your piece is saved in your collection.",
    openDojo: ru ? "Открыть додзё" : "Open my dojo",
    otherChapters: ru ? "К другим главам" : "Other chapters",
    edit: ru ? "Дополнить ответ" : "Add to your reply",
    example: ru ? "Один из вариантов" : "One way to say it",
    progress: (chapter: ChapterSummary) => chapter.completed ? (ru ? "Пройдено" : "Completed") : chapter.run_id ? (ru ? "Начата" : "In progress") : (ru ? "3 задания и твой ответ" : "3 exercises and your reply"),
    chapter: (id: ChapterId) => CHAPTERS[ru ? "ru" : "en"][id],
  };
}
