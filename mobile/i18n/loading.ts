// Dojo-flavored loading messages — shown while an exercise / story / challenge card is generating.
// Deliberately playful and in Russian: the loading moment is a tiny bit of brand personality, not a
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

export function randomLoadingMessage(): string {
  return LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
}

// Stable pick for a given seed (e.g. a round counter), so the message doesn't flicker on re-render.
export function loadingMessageFor(seed: number): string {
  const i = ((seed % LOADING_MESSAGES.length) + LOADING_MESSAGES.length) % LOADING_MESSAGES.length;
  return LOADING_MESSAGES[i];
}
