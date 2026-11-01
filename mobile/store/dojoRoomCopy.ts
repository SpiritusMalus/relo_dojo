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
};
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
    daysHint: "Finish a daily mix or topic practice: 10 exercises.",
    allEarned: "All practice pieces are yours", allEarnedHint: "Keep training. Your next goal is a skill.",
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
    daysHint: "Заверши микс дня или тренировку по теме — 10 заданий.",
    allEarned: "Все предметы за практику собраны", allEarnedHint: "Продолжай тренироваться и осваивать новые темы.",
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
