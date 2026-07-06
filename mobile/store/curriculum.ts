// The standards layer of the course (owner decision 2026-07-03: rebuild the loop around real
// ELT practice — see PR #93).
//
// Three ideas from mainstream language pedagogy, mapped onto what the app already had:
//  1. SYLLABUS — a fixed unit order per CEFR band (informed by the British Council–EAQUALS Core
//     Inventory and the Cambridge English Grammar Profile), instead of weighted-random topics.
//     The same topic deepens with the learner's level (the generator already serves items at the
//     personal skill), so an advanced learner clears early units quickly but still evidences them.
//  2. PRESENTATION (the first P of PPP) — every unit carries a learner-facing rule card shown
//     BEFORE drilling. Until now the rules existed only server-side as LLM anchors; the learner
//     was tested on rules nobody had shown them.
//  3. MASTERY GATE (Bloom) — the next unit unlocks only after demonstrated mastery: enough recent
//     correct answers, with a minimum in formats that can't be guessed. Placement/seeded skill
//     never counts as mastery (display-honesty rule, store/dojo.ts).
//
// Pure data + pure functions. No imports from progress/dojo (they import from here).
import type { Cefr } from "../theme/theme";

// --- mastery criterion ---------------------------------------------------------
// One answered item, as recorded in Progress.course.history (store/progress.tsx).
export type AnswerMark = { c: boolean; f: string }; // c = correct, f = exercise format (type)

export const MASTERY_WINDOW = 10; // rolling evidence window per topic
export const MASTERY_MIN_CORRECT = 8; // correct answers required inside the window
export const MASTERY_MIN_HARD = 2; // of them, at least this many in non-guessable formats

// Formats a learner can pass by tapping around: one pick out of 3-6 visible options. Constructive
// formats (build/transform/order/match/blanks/tap-the-error) require producing or locating the
// answer, so correct answers there are stronger evidence of mastery. The listening types also sit
// here — not because retell is guessable (it isn't), but because both grade COMPREHENSION of a
// topic-flavored passage, not production of the unit's grammar, so they never count as the "hard"
// mastery evidence (they still count toward the correct total like any answer).
export const GUESSABLE_FORMATS = new Set([
  "multiple-choice",
  "odd-one-out",
  "listen-and-answer",
  "listen-and-retell",
]);

export type Mastery = {
  correct: number; // correct answers in the window
  hard: number; // correct answers in non-guessable formats
  met: boolean; // criterion satisfied
  pct: number; // 0..100 progress toward the correct-count bar (for meters)
};

// --- checkpoint (зачёт): the ceremony that turns evidence into mastery -------------
// Meeting the mastery criterion makes the unit READY; the unit is MASTERED only after passing a
// short closed-book quiz — CHECKPOINT_ITEMS fresh items in constructive formats, at most
// CHECKPOINT_MAX_MISSES misses, no rule card mid-quiz. Failing costs nothing beyond the answers
// themselves: quiz answers feed the same evidence window, so a failed run naturally lowers the
// meter and re-earning it is the retry cooldown (no day-locks needed).
export const CHECKPOINT_ITEMS = 5;
export const CHECKPOINT_MAX_MISSES = 1;
// Served formats: constructive only (a checkpoint must not be guessable), and available at every
// CEFR band (transform/order are gated to B1+ in the normal mix).
export const CHECKPOINT_FORMATS = ["build-the-sentence", "tap-the-error", "multiple-blanks"];

export function checkpointPassed(misses: number): boolean {
  return misses <= CHECKPOINT_MAX_MISSES;
}

/** Early abort: one miss past the allowance already decides the run. */
export function checkpointFailedNow(misses: number): boolean {
  return misses > CHECKPOINT_MAX_MISSES;
}

// --- recertification (переаттестация): the re-зачёт for a decayed mastered unit -----
// Mastery stays one-way (a unit never re-locks), but skills fade — a mastered unit whose RECENT
// answers dip reads as "в просадке" and offers a heavier checkpoint. The run spans the whole
// evidence window on purpose: RECERT_ITEMS == MASTERY_WINDOW, so the quiz marks REPLACE the window
// entirely and a passed run (≤2 misses = ≥80% in-window) clears the decay flag purely derived —
// no new persisted state, nothing extra to sync or merge.
export const RECERT_ITEMS = MASTERY_WINDOW;
export const RECERT_MAX_MISSES = 2;
export const REVIEW_MIN_EVIDENCE = 6; // recent marks needed before a dip counts as decay
export const REVIEW_MAX_ACC = 0.6; // window accuracy below this = decayed

export function recertPassed(misses: number): boolean {
  return misses <= RECERT_MAX_MISSES;
}

/** Early abort: one miss past the recert allowance already decides the run. */
export function recertFailedNow(misses: number): boolean {
  return misses > RECERT_MAX_MISSES;
}

/** Has a MASTERED unit visibly decayed? Judged on the recent evidence window only — lifetime
 *  accuracy is too sticky for heavy users (hundreds of old answers drown a real current dip). */
export function unitDecayed(history: AnswerMark[] | undefined): boolean {
  const window = (history ?? []).slice(-MASTERY_WINDOW);
  if (window.length < REVIEW_MIN_EVIDENCE) return false;
  return window.filter((m) => m.c).length / window.length < REVIEW_MAX_ACC;
}

/** Mastery evidence over the last MASTERY_WINDOW answers of one topic. Pure; tolerant of missing
 *  history (a fresh topic reads as 0/0, not-met). */
export function masteryOf(history: AnswerMark[] | undefined): Mastery {
  const window = (history ?? []).slice(-MASTERY_WINDOW);
  const correct = window.filter((m) => m.c).length;
  const hard = window.filter((m) => m.c && !GUESSABLE_FORMATS.has(m.f)).length;
  const met = correct >= MASTERY_MIN_CORRECT && hard >= MASTERY_MIN_HARD;
  return { correct, hard, met, pct: Math.round((Math.min(correct, MASTERY_MIN_CORRECT) / MASTERY_MIN_CORRECT) * 100) };
}

// --- syllabus --------------------------------------------------------------------
export type CourseUnit = { topic: string; band: Cefr };

// Unit order per CEFR band. Topic ids are the canonical strings shared with the backend
// (backend/app/services/_grammar_prompts.TOPICS) — the order here is the COURSE, the ids are not.
// Band placement follows the Core Inventory / English Grammar Profile: SVO word order and basic
// time prepositions open A1-A2; articles, comparisons and basic modals fill A2; tense agreement,
// gerund/infinitive patterns, phrasal verbs and conditionals are the B1 core; punctuation
// conventions (a written-register skill) close the track at B2.
export const CURRICULUM: CourseUnit[] = [
  { topic: "word order", band: "A1" },
  { topic: "prepositions", band: "A2" },
  { topic: "articles", band: "A2" },
  { topic: "vocabulary", band: "A2" },
  { topic: "comparatives & superlatives", band: "A2" },
  { topic: "modal verbs", band: "A2" },
  { topic: "verb sequence (tense agreement)", band: "B1" },
  { topic: "gerunds & infinitives", band: "B1" },
  { topic: "phrasal verbs", band: "B1" },
  { topic: "conditionals", band: "B1" },
  { topic: "punctuation", band: "B2" },
];

export function unitFor(topic: string): CourseUnit | undefined {
  return CURRICULUM.find((u) => u.topic === topic);
}

// --- rule cards (the Presentation step) -------------------------------------------
// Learner-facing: short enough to read in ~30 seconds, concrete examples first-class. The RU text
// is the primary audience (the app's niche); EN mirrors it for the English-UI setting. These are
// NOT the LLM anchors from backend/_grammar_rules.py — those are compressed for a model, these are
// written for a person.
export type RuleCard = {
  rule: { ru: string; en: string };
  examples: { en: string; ru: string }[];
};

export const RULE_CARDS: Record<string, RuleCard> = {
  "word order": {
    rule: {
      ru:
        "В английском утверждении порядок жёсткий: Подлежащее → Глагол → Дополнение (SVO). " +
        "Наречия частоты (always, usually, never) стоят перед смысловым глаголом, но после be. " +
        "Место обычно идёт раньше времени: «где» → «когда».",
      en:
        "English statements keep a fixed order: Subject → Verb → Object (SVO). " +
        "Frequency adverbs (always, usually, never) go before the main verb but after 'be'. " +
        "Place usually comes before time: where → when.",
    },
    examples: [
      { en: "I deploy the release on Fridays.", ru: "Я выкатываю релиз по пятницам. (S → V → O)" },
      { en: "She always tests her code.", ru: "Она всегда тестирует свой код. (always перед глаголом)" },
      { en: "He is never late.", ru: "Он никогда не опаздывает. (после be)" },
    ],
  },
  prepositions: {
    rule: {
      ru:
        "Время: at — точное время (at 10 am), on — дни и даты (on Monday, on May 5), " +
        "in — месяцы, годы, части дня (in May, in 2026, in the morning; но at night). " +
        "Место: at — точка (at the door), on — поверхность (on the table), in — внутри (in the room).",
      en:
        "Time: 'at' for clock times (at 10 am), 'on' for days and dates (on Monday, on May 5), " +
        "'in' for months, years and parts of day (in May, in 2026, in the morning; but at night). " +
        "Place: 'at' a point (at the door), 'on' a surface (on the table), 'in' an enclosed space (in the room).",
    },
    examples: [
      { en: "The standup is at 10 am on Monday.", ru: "Стендап в 10 утра в понедельник." },
      { en: "I started this job in 2024.", ru: "Я начал эту работу в 2024 году." },
      { en: "The sticker is on the laptop, the laptop is in the bag.", ru: "Стикер на ноутбуке, ноутбук в сумке." },
    ],
  },
  articles: {
    rule: {
      ru:
        "a/an — «один из многих», первое упоминание (an — перед гласным ЗВУКОМ: an hour, но a university). " +
        "the — конкретный, уже известный или единственный (the sun, the CEO). " +
        "Без артикля — обобщения во множественном числе и неисчисляемые (I like music).",
      en:
        "'a/an' = one of many, first mention ('an' before a vowel SOUND: an hour, but a university). " +
        "'the' = specific, already known, or unique (the sun, the CEO). " +
        "No article for general plurals and uncountables (I like music).",
    },
    examples: [
      { en: "We found a bug. The bug was in the login form.", ru: "Мы нашли баг (какой-то). Этот баг был в форме входа (уже известный)." },
      { en: "She is an engineer at a startup.", ru: "Она инженер в стартапе." },
      { en: "Advice is free; the advice you gave me was great.", ru: "Советы (вообще) бесплатны; тот твой совет был отличным." },
    ],
  },
  vocabulary: {
    rule: {
      ru:
        "Слова живут в устойчивых сочетаниях — учите пары, а не отдельные слова: make a decision (не do), " +
        "do homework (не make). Осторожно с «ложными друзьями»: accurate — точный (не аккуратный), " +
        "actual — фактический (не актуальный). Следите за формой слова: advice — неисчисляемое.",
      en:
        "Words live in collocations — learn pairs, not single words: make a decision (not 'do'), " +
        "do homework (not 'make'). Watch false friends and word forms: 'advice' is uncountable, " +
        "'accurate' means precise.",
    },
    examples: [
      { en: "We made a decision to migrate.", ru: "Мы приняли решение мигрировать. (make a decision)" },
      { en: "Can you give me some advice?", ru: "Дашь пару советов? (advice — без -s)" },
      { en: "The estimate turned out to be accurate.", ru: "Оценка оказалась точной. (accurate ≠ аккуратный)" },
    ],
  },
  "comparatives & superlatives": {
    rule: {
      ru:
        "Короткие прилагательные: -er / the -est (bigger, the biggest). Длинные (2+ слога): " +
        "more / the most (more useful, the most useful). Сравнение — с than, превосходная — с the. " +
        "Исключения: good → better → the best; bad → worse → the worst.",
      en:
        "Short adjectives: -er / the -est (bigger, the biggest). Longer ones: more / the most " +
        "(more useful, the most useful). Comparatives take 'than', superlatives take 'the'. " +
        "Irregular: good → better → the best; bad → worse → the worst.",
    },
    examples: [
      { en: "This laptop is faster than mine.", ru: "Этот ноутбук быстрее моего." },
      { en: "It was the most useful meeting this week.", ru: "Это была самая полезная встреча за неделю." },
      { en: "The new build is better, not worse.", ru: "Новый билд лучше, а не хуже." },
    ],
  },
  "modal verbs": {
    rule: {
      ru:
        "После модального — голый инфинитив: без to и без -s (she can swim). " +
        "must / have to — обязанность; should — совет; can / could — умение и разрешение; " +
        "may / might — вероятность; would — гипотетическое. Отрицание: can't, shouldn't, don't have to.",
      en:
        "A modal takes the bare infinitive: no 'to', no -s (she can swim). " +
        "must / have to = obligation; should = advice; can / could = ability and permission; " +
        "may / might = possibility; would = hypothetical.",
    },
    examples: [
      { en: "You should rest before the interview.", ru: "Тебе стоит отдохнуть перед собеседованием." },
      { en: "She can review the PR today.", ru: "Она может посмотреть PR сегодня. (can + review, без to)" },
      { en: "We must ship it by Friday.", ru: "Мы обязаны выкатить это к пятнице." },
    ],
  },
  "verb sequence (tense agreement)": {
    rule: {
      ru:
        "Держите времена согласованными. В косвенной речи после прошедшего — сдвиг назад: " +
        "say → said, is → was, will → would, can → could. После главного глагола в прошедшем " +
        "придаточное обычно тоже в прошедшем: She said she WAS tired (не is).",
      en:
        "Keep tenses consistent. In reported speech after a past verb, shift back: " +
        "say → said, is → was, will → would, can → could. After a past main verb the subordinate " +
        "clause is usually past too: She said she WAS tired (not 'is').",
    },
    examples: [
      { en: "He said the deploy was ready.", ru: "Он сказал, что деплой готов. (was, не is)" },
      { en: "She told me she would join later.", ru: "Она сказала, что подключится позже. (will → would)" },
      { en: "I thought I could fix it quickly.", ru: "Я думал, что смогу быстро это починить. (can → could)" },
    ],
  },
  "gerunds & infinitives": {
    rule: {
      ru:
        "После предлогов и глаголов enjoy, avoid, finish, keep, mind — форма на -ing (герундий). " +
        "После want, need, decide, hope, plan и большинства прилагательных — to + глагол. " +
        "Некоторые (start, like, continue) принимают обе формы почти без разницы.",
      en:
        "After prepositions and after enjoy, avoid, finish, keep, mind — use the -ing form (gerund). " +
        "After want, need, decide, hope, plan and most adjectives — use to + verb. " +
        "Some verbs (start, like, continue) take either with little change of meaning.",
    },
    examples: [
      { en: "I enjoy solving hard bugs.", ru: "Мне нравится решать сложные баги. (enjoy + -ing)" },
      { en: "We decided to rewrite the module.", ru: "Мы решили переписать модуль. (decide + to)" },
      { en: "She is good at explaining things.", ru: "Она хорошо объясняет. (после предлога — -ing)" },
    ],
  },
  "phrasal verbs": {
    rule: {
      ru:
        "Фразовый глагол = глагол + частица, смысл часто идиоматический (find out — узнать). " +
        "Разделяемые: дополнение можно вставить внутрь (turn the light off / turn it off — " +
        "местоимение ТОЛЬКО внутри). Неразделяемые: всегда вместе (look after them, run into a friend).",
      en:
        "A phrasal verb = verb + particle, often idiomatic (find out = learn). " +
        "Separable: the object can go inside (turn the light off / turn it off — a pronoun MUST go " +
        "inside). Inseparable: always together (look after them, run into a friend).",
    },
    examples: [
      { en: "Please turn it off before the demo.", ru: "Выключи это перед демо. (it — только внутри)" },
      { en: "We found out the cause yesterday.", ru: "Мы выяснили причину вчера." },
      { en: "I ran into my old teammate.", ru: "Я случайно встретил старого коллегу. (неразделяемый)" },
    ],
  },
  conditionals: {
    rule: {
      ru:
        "Zero: if + настоящее, настоящее — общие истины. First: if + настоящее, will + глагол — " +
        "реальное будущее. Second: if + прошедшее, would + глагол — нереальное настоящее. " +
        "Third: if + past perfect, would have + V3 — нереальное прошлое. " +
        "Главное правило: will/would НЕ ставятся в if-часть.",
      en:
        "Zero: if + present, present — general truths. First: if + present, will + verb — a real " +
        "future. Second: if + past, would + verb — an unreal present. Third: if + past perfect, " +
        "would have + V3 — an unreal past. Key rule: no will/would inside the if-clause.",
    },
    examples: [
      { en: "If the tests fail, the pipeline stops.", ru: "Если тесты падают, пайплайн останавливается. (zero)" },
      { en: "If it rains, we will stay home.", ru: "Если пойдёт дождь, мы останемся дома. (first)" },
      { en: "If I had known, I would have called.", ru: "Если бы я знал, я бы позвонил. (third)" },
    ],
  },
  punctuation: {
    rule: {
      ru:
        "Запятая — после придаточного в начале (If you push, CI runs), между однородными, " +
        "и ПЕРЕД and/but при соединении двух полных предложений. НЕ ставится между подлежащим и " +
        "глаголом. Точка с запятой соединяет два близких предложения без союза. " +
        "В английском НЕТ запятой перед that в значении «что».",
      en:
        "Comma: after a fronted clause (If you push, CI runs), between list items, and BEFORE " +
        "and/but joining two full sentences. Never between subject and verb. A semicolon joins two " +
        "related sentences without a conjunction. English takes NO comma before 'that'.",
    },
    examples: [
      { en: "If the build breaks, we roll back.", ru: "Если билд ломается, мы откатываемся. (запятая после if-части)" },
      { en: "She said that the fix worked.", ru: "Она сказала, что фикс сработал. (по-английски — без запятой перед that)" },
      { en: "The demo went well; the client was happy.", ru: "Демо прошло хорошо; клиент был доволен." },
    ],
  },
};
