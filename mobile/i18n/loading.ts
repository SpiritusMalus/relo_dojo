// Dojo-flavored loading messages — shown while an exercise / story / challenge card is generating.
// Deliberately playful: the loading moment is a tiny bit of brand personality, not a
// literal status. randomLoadingMessage() picks one; pass an index to keep it stable across renders.
export const LOADING_MESSAGES = [
  "Ищем уваги…",
  "Затягиваем оби…",
  "Перетаскиваем маты…",
  "Познаём итиго итиэ…",
  "Пишем хокку…",
  "Завариваем чай…",
  "Кланяемся сэнсэю…",
  "Считаем до десяти по-японски…",
  "Точим катану слов…",
  "Складываем оригами из глаголов…",
  "Медитируем над предлогами…",
  "Раздаём пояса временам…",
  "Ловим артикль сачком…",
  "Сажаем бонсай из придаточных…",
  "Настраиваем дыхание перед спаррингом…",
];

const EN_LOADING_MESSAGES = [
  "Preparing your next kata…",
  "Tying the obi…",
  "Laying out the mats…",
  "Taking a quiet moment…",
  "Writing a haiku…",
  "Brewing some tea…",
  "Bowing to Sensei…",
  "Counting to ten…",
  "Sharpening our word skills…",
  "Folding verb origami…",
  "Thinking about prepositions…",
  "Putting tenses in order…",
  "Finding the right article…",
  "Growing a sentence bonsai…",
  "Taking a breath before practice…",
];

export function randomLoadingMessage(lang: "ru" | "en" = "ru"): string {
  const messages = lang === "en" ? EN_LOADING_MESSAGES : LOADING_MESSAGES;
  return messages[Math.floor(Math.random() * messages.length)];
}

// Stable pick for a given seed (e.g. a round counter), so the message doesn't flicker on re-render.
export function loadingMessageFor(seed: number, lang: "ru" | "en" = "ru"): string {
  const messages = lang === "en" ? EN_LOADING_MESSAGES : LOADING_MESSAGES;
  const i = ((seed % messages.length) + messages.length) % messages.length;
  return messages[i];
}
