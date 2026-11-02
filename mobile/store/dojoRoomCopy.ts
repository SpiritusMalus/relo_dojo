type Language = "en" | "ru";
const ITEM_NAMES: Record<string, Record<Language, string>> = {
  dojo_light_paper: { en: "Paper light", ru: "Бумажный светильник" },
  dojo_display_blank: { en: "Empty scroll", ru: "Чистый свиток" },
  dojo_plant_seedling: { en: "Seedling", ru: "Росток" },
  dojo_display_first_scroll: { en: "First scroll", ru: "Первый свиток" },
  dojo_plant_bamboo: { en: "Bamboo", ru: "Бамбук" },
  dojo_light_lantern: { en: "Practice lantern", ru: "Фонарь практики" },
  dojo_light_sunset: { en: "Sunset light", ru: "Свет заката" },
  dojo_display_wave: { en: "The wave", ru: "Волна" },
  dojo_display_introduction: { en: "Open window", ru: "Открытое окно" },
  dojo_display_experience: { en: "The path", ru: "Пройденный путь" },
  dojo_display_clarification: { en: "Conversation", ru: "Разговор" },
};
const CHAPTER_ITEMS: Record<string, { id: string; en: string; ru: string }> = {
  dojo_display_introduction: { id: "introduction", en: "Introduce yourself", ru: "Познакомиться" },
  dojo_display_experience: { id: "experience", en: "Share an experience", ru: "Рассказать об опыте" },
  dojo_display_clarification: { id: "clarification", en: "Ask for clarity", ru: "Переспросить" },
};
export function dojoItemChapter(id: string) { return CHAPTER_ITEMS[id]; }
export function dojoChapterReward(id: string, lang: string): string | null {
  const chapter = CHAPTER_ITEMS[id];
  return chapter ? (lang === "ru" ? `За главу «${chapter.ru}»` : `From “${chapter.en}”`) : null;
}
export function dojoItemName(id: string, lang: string): string {
  return ITEM_NAMES[id]?.[lang === "ru" ? "ru" : "en"] ?? (lang === "ru" ? "Предмет додзё" : "Dojo item");
}
const COPY = {
  en: {
    title: "My dojo", back: "Back", practice: "Start practice", collection: "Make it yours",
    light: "Light", display: "Scroll", plant: "Plant", equip: "Place", equipped: "Placed",
    buy: "Buy for", koku: "koku", busy: "Saving…", target: "Your next piece", choose: "Set as goal",
    selected: "Your goal", earned: "Earned through practice", owned: "In your collection", starter: "Yours from the start",
    preview: "Your dojo starts here", guest: "Sign in to keep your collection and earn new pieces.",
    login: "Sign in", offline: "Showing your saved dojo. Connect to make changes.",
    unavailable: "Your dojo could not load.", retry: "Try again", error: "Could not save. Try again.",
    uncertain: "Checking your dojo…", walletUnknown: "Connect to check your koku.",
    insufficient: "Keep practising to earn more koku.", day: "practice day", days: "practice days",
    daysHint: "Finish 10 practice exercises or a chapter.",
    allEarned: "Your next scroll is in a chapter", allEarnedHint: "Use your English in a new situation.", chapters: "Open chapters", openChapter: "Open chapter",
    welcome: "New in your dojo", placeNew: "View collection", emptyBalance: "Koku —",
    progress: "Practice days", close: "Done", selectedPreview: "Preview", collectionHint: "Pick a piece to see it in your dojo.",
  },
  ru: {
    title: "Моё додзё", back: "Назад", practice: "Начать практику", collection: "Обустроить додзё",
    light: "Свет", display: "Свиток", plant: "Растение", equip: "Поставить", equipped: "На месте",
    buy: "Купить за", koku: "коку", busy: "Сохраняем…", target: "Следующий предмет", choose: "Выбрать целью",
    selected: "Твоя цель", earned: "За дни практики", owned: "В коллекции", starter: "С тобой с первого дня",
    preview: "Здесь начинается твоё додзё", guest: "Войди, чтобы сохранять коллекцию и получать новые предметы.",
    login: "Войти", offline: "Показываем сохранённое додзё. Для изменений нужен интернет.",
    unavailable: "Не удалось загрузить додзё.", retry: "Повторить", error: "Не удалось сохранить. Попробуй ещё раз.",
    uncertain: "Проверяем додзё…", walletUnknown: "Подключись, чтобы проверить коку.",
    insufficient: "Продолжай практику, чтобы накопить коку.", day: "день практики", days: "дней практики",
    daysHint: "Заверши 10 заданий практики или главу.",
    allEarned: "Следующий свиток — в главах", allEarnedHint: "Попробуй английский в новой ситуации.", chapters: "Открыть главы", openChapter: "Открыть главу",
    welcome: "Новое в твоём додзё", placeNew: "Открыть коллекцию", emptyBalance: "Коку —",
    progress: "Дни практики", close: "Готово", selectedPreview: "Примерка", collectionHint: "Выбери предмет, чтобы примерить его в додзё.",
  },
};
export function dojoCopy(lang: string) { return COPY[lang === "ru" ? "ru" : "en"]; }
export function dojoDays(days: number, lang: string): string {
  if (lang !== "ru") return `${days} practice ${days === 1 ? "day" : "days"}`;
  const n = days % 100;
  const word = n >= 11 && n <= 14 ? "дней" : days % 10 === 1 ? "день" : days % 10 >= 2 && days % 10 <= 4 ? "дня" : "дней";
  return `${days} ${word} практики`;
}
