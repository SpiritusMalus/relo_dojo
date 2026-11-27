import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import ProgressBar from "../components/ui/ProgressBar";
import Screen from "../components/ui/Screen";
import Txt from "../components/ui/Txt";
import { RU_TOPIC_LABELS } from "../i18n/strings";
import { ApiError, type Exercise, type ResponseValue } from "../services/api";
import {
  getPersonalPracticeExercise, personalPracticeTargets, PERSONAL_PRACTICE_COUNT, PERSONAL_TEST_COUNT,
  PERSONAL_TEST_PASS, type PersonalPracticeTarget,
} from "../services/personalPractice";
import { personalPracticeEnabled } from "../services/personalPracticeEnabled";
import { isCurrentAccountScope, type AccountScope } from "../store/accountScope";
import { effectiveSkill, levelToCefr } from "../store/adaptive";
import { deliverGuestExercise, loadGuestLimit, remaining } from "../store/guestLimit";
import { useI18n } from "../store/i18n";
import { loadMistakes } from "../store/mistakes";
import { TOPIC_LABELS } from "../store/onboarding";
import { useProgress } from "../store/progress";
import { localDate } from "../store/streak";
import { useAccountScope } from "../store/useAccountScope";
import { useExerciseCheck, type Result } from "../store/useExerciseCheck";
import { useTheme } from "../theme/theme";

type Phase = "intro" | "practice" | "ready" | "test" | "finished";
type Stage = "practice" | "test";
type TestAnswer = { exercise: Exercise; result: Result };
type CardResult = { exercise: Exercise } | { error: unknown };
type CardRequest = {
  target: PersonalPracticeTarget;
  stage: Stage;
  round: number;
  controller: AbortController;
  result: Promise<CardResult>;
};

const stageCount = (stage: Stage) => stage === "practice" ? PERSONAL_PRACTICE_COUNT : PERSONAL_TEST_COUNT;

export default function PersonalPracticeScreen() {
  const scope = useAccountScope();
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const requestedTopic = typeof topic === "string" ? topic : undefined;
  if (!personalPracticeEnabled()) return <Redirect href="/(tabs)/train" />;
  return <PracticeSession key={JSON.stringify([scope.epoch, requestedTopic])} scope={scope} requestedTopic={requestedTopic} />;
}

function PracticeSession({ scope, requestedTopic }: { scope: AccountScope; requestedTopic?: string }) {
  const router = useRouter();
  const theme = useTheme();
  const { lang, t } = useI18n();
  const { progress } = useProgress();
  const defaultLevel = useRef(levelToCefr(effectiveSkill(progress, requestedTopic ?? ""))).current;
  const ru = lang === "ru";
  const topicLabel = (id: string) => (ru ? RU_TOPIC_LABELS[id] : TOPIC_LABELS[id]) ?? TOPIC_LABELS[id] ?? id;
  const grade = useExerciseCheck();

  const [targets, setTargets] = useState<PersonalPracticeTarget[] | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceError, setSourceError] = useState(false);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [round, setRound] = useState(1);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [testAnswers, setTestAnswers] = useState<TestAnswer[]>([]);

  const opened = useRef(true);
  const sourceRequest = useRef(false);
  const pendingCard = useRef<CardRequest | null>(null);
  const delivering = useRef(false);
  const visibleCard = useRef<Exercise | null>(null);
  const seen = useRef<Exercise[]>([]);
  const turning = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const open = () => opened.current && isCurrentAccountScope(scope);
  const target = targets?.[selected];

  useEffect(() => {
    opened.current = true;
    void readSources();
    return () => {
      opened.current = false;
      visibleCard.current = null;
      discardPendingCard();
    };
    // Scope and requested topic are keyed by the route wrapper. Load a single snapshot per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function readSources() {
    if (sourceRequest.current || !open()) return;
    sourceRequest.current = true;
    setSourceLoading(true);
    setSourceError(false);
    try {
      const stored = await loadMistakes(scope);
      if (open()) setTargets(personalPracticeTargets(stored, defaultLevel, requestedTopic));
    } catch {
      if (open()) setSourceError(true);
    } finally {
      sourceRequest.current = false;
      if (open()) setSourceLoading(false);
    }
  }

  function discardPendingCard() {
    pendingCard.current?.controller.abort();
    pendingCard.current = null;
  }

  function startCardRequest(selection: PersonalPracticeTarget, stage: Stage, number: number): CardRequest {
    const controller = new AbortController();
    const result = getPersonalPracticeExercise(selection, stage, seen.current.slice(), controller.signal)
      .then<CardResult, CardResult>((exercise) => ({ exercise }), (error: unknown) => ({ error }));
    const request = { target: selection, stage, round: number, controller, result };
    pendingCard.current = request;
    return request;
  }

  async function warmNextCard(selection: PersonalPracticeTarget, stage: Stage, number: number, shown: Exercise) {
    if (number >= stageCount(stage)) return;
    if (scope.owner === "guest" && remaining(await loadGuestLimit(), localDate(new Date())) === 0) return;
    // The quota read may finish after Next, a replacement, or a return to the previous screen.
    if (!open() || delivering.current || pendingCard.current || visibleCard.current !== shown) return;
    startCardRequest(selection, stage, number + 1);
  }

  function close() {
    opened.current = false;
    visibleCard.current = null;
    discardPendingCard();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/train");
  }

  function explainLoadError(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.code === "daily_limit" || error.code === "starter_limit") {
        return ru ? "Сегодняшний лимит упражнений исчерпан. Возвращайся завтра." : "You’ve reached today’s exercise limit. Come back tomorrow.";
      }
      if (error.code === "learning_offline") {
        return ru ? "Нет интернета. Восстанови связь и повтори." : "You’re offline. Reconnect and try again.";
      }
      if (error.code === "learning_timeout") {
        return ru ? "Задание готовится дольше обычного. Попробуй ещё раз." : "The exercise is taking longer than usual. Try again.";
      }
      if (error.code === "personal_practice_unavailable" || error.code === "assessment_unavailable") {
        return ru ? "Не удалось подобрать новый пример по этой теме. Попробуй ещё раз." : "Could not find a fresh example for this topic. Try again.";
      }
      if (error.status === 429) return ru ? "Слишком много запросов. Повтори чуть позже." : "Too many requests. Try again shortly.";
    }
    return ru ? "Не удалось загрузить задание. Попробуй ещё раз." : "Could not load the exercise. Try again.";
  }

  async function load(stage: Stage, number: number) {
    if (!target || !open() || delivering.current || turning.current) return;
    delivering.current = true;
    visibleCard.current = null;
    let request = pendingCard.current;
    if (request && (request.target !== target || request.stage !== stage || request.round !== number)) {
      discardPendingCard();
      request = null;
    }
    setPhase(stage);
    setRound(number);
    setLoading(true);
    setLoadError("");
    setExercise(null);
    setResponse(null);
    setResponseDisplay("");
    grade.reset();
    scroll.current?.scrollTo({ y: 0, animated: false });
    const fetchForDelivery = async () => {
      if (!open()) throw new ApiError("Request cancelled.", 409, "request_aborted");
      request ??= startCardRequest(target, stage, number);
      const result = await request.result;
      if (!open() || request.controller.signal.aborted) {
        throw new ApiError("Request cancelled.", 409, "request_aborted");
      }
      if ("error" in result) throw result.error;
      return result.exercise;
    };
    let shown: Exercise | null = null;
    try {
      const next = scope.owner === "guest"
        ? await deliverGuestExercise(localDate(new Date()), fetchForDelivery)
        : await fetchForDelivery();
      if (!open()) return;
      if (!next) throw new ApiError("Daily exercise limit reached.", 403, "daily_limit");
      seen.current.push(next);
      visibleCard.current = next;
      grade.beginAttempt(next);
      setExercise(next);
      shown = next;
    } catch (error) {
      if (open()) setLoadError(explainLoadError(error));
    } finally {
      if (pendingCard.current === request) discardPendingCard();
      delivering.current = false;
      if (open()) setLoading(false);
    }
    if (shown) void warmNextCard(target, stage, number, shown);
  }

  async function submit() {
    if (!open() || turning.current || !exercise || visibleCard.current !== exercise ||
      response === null || grade.result || grade.checking) return;
    turning.current = true;
    try {
      const result = await grade.check(exercise, response, undefined, responseDisplay);
      if (!result || !open()) return;
      if (phase === "test") setTestAnswers((answers) => [...answers, { exercise, result }]);
    } finally {
      turning.current = false;
    }
  }

  function advance(stage: Stage) {
    if (!open() || !exercise || visibleCard.current !== exercise || !grade.result || turning.current || delivering.current) return;
    const count = stageCount(stage);
    if (round < count) void load(stage, round + 1);
    else {
      visibleCard.current = null;
      setPhase(stage === "practice" ? "ready" : "finished");
      scroll.current?.scrollTo({ y: 0, animated: false });
    }
  }

  function restart() {
    if (delivering.current) return;
    setTestAnswers([]);
    void load("practice", 1);
  }

  const stage = phase === "practice" || phase === "test" ? phase : null;
  const practice = stage === "practice";
  const expired = grade.errorCode === "exercise_expired";
  const count = practice ? PERSONAL_PRACTICE_COUNT : PERSONAL_TEST_COUNT;
  const right = testAnswers.filter((answer) => answer.result.correct).length;
  const passed = right >= PERSONAL_TEST_PASS;
  const title = phase === "ready" || phase === "test" ? (ru ? "Зачёт" : "Checkpoint")
    : phase === "finished" ? (ru ? "Результат зачёта" : "Checkpoint result")
    : (ru ? "Тренировка по ошибкам" : "Practise your mistakes");

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={ru ? "Закрыть тренировку" : "Close practice"} style={styles.close}>
          <Icon name="x" color={theme.c.ink2} />
        </Pressable>
        <Txt variant="screenTitle" style={styles.title}>{title}</Txt>
      </View>
      {!!stage && (
        <View style={styles.status}>
          <View style={styles.bar}><ProgressBar pct={100 * (round - 1 + (grade.result ? 1 : 0)) / count} /></View>
          <Txt variant="caption" color={theme.c.ink2} accessibilityLabel={ru ? `Задание ${round} из ${count}` : `Exercise ${round} of ${count}`}>
            {round} / {count}
          </Txt>
        </View>
      )}
      <ScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {phase === "intro" && (
          <>
            {sourceLoading && <ActivityIndicator color={theme.c.accent} accessibilityLabel={ru ? "Ищем сохранённые ошибки" : "Finding saved mistakes"} />}
            {sourceError && <Txt variant="body" accessibilityRole="alert">{ru ? "Не удалось открыть сохранённые ошибки." : "Could not open your saved mistakes."}</Txt>}
            {!sourceLoading && !sourceError && !targets?.length && (
              <>
                <Txt variant="cardTitle">{ru ? "Пока нет ошибок для тренировки" : "No mistakes to practise yet"}</Txt>
                <Txt variant="body" color={theme.c.ink2}>{ru ? "Ошибись в обычном упражнении или выбери тему после проверки своего текста." : "Miss an exercise in regular practice or choose a topic after checking your own text."}</Txt>
              </>
            )}
            {!sourceLoading && !!targets?.length && (
              <>
                <Txt variant="body" color={theme.c.ink2}>
                  {ru ? `${PERSONAL_PRACTICE_COUNT} задания с разбором, затем ${PERSONAL_TEST_COUNT} новых примера на зачёте.`
                    : `${PERSONAL_PRACTICE_COUNT} exercises with feedback, followed by ${PERSONAL_TEST_COUNT} fresh examples in a checkpoint.`}
                </Txt>
                {targets.map((item, index) => (
                  <Pressable key={item.topic} onPress={() => setSelected(index)} accessibilityRole="radio"
                    accessibilityState={{ checked: selected === index }} accessibilityLabel={topicLabel(item.topic)}
                    style={[styles.topic, { borderColor: selected === index ? theme.c.accent : theme.c.line, backgroundColor: theme.c.surface }]}>
                    <Txt variant="bodyStrong">{topicLabel(item.topic)}</Txt>
                    <Txt variant="caption" color={theme.c.ink2}>{item.level}</Txt>
                  </Pressable>
                ))}
              </>
            )}
          </>
        )}
        {!!stage && !!target && <Txt variant="label" color={theme.c.ink2}>{topicLabel(target.topic)}</Txt>}
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.c.accent} />
            <Txt variant="body" accessibilityLiveRegion="polite">{ru ? "Готовим новый пример…" : "Preparing a fresh example…"}</Txt>
          </View>
        )}
        {!!loadError && <Txt variant="body" color={theme.c.bad} accessibilityRole="alert">{loadError}</Txt>}
        {!!stage && !!exercise && (
          <>
            <ExerciseCard key={exercise.token ?? `${stage}-${round}`} exercise={exercise} translationEnabled={practice}
              onHint={practice ? grade.markHintUsed : undefined} locked={grade.submissionLocked}
              feedback={practice ? grade.result ?? undefined : undefined} onChange={(value, display) => {
                if (visibleCard.current !== exercise || turning.current || grade.submissionLocked) return;
                setResponse(value);
                setResponseDisplay(display);
              }} />
            {!!grade.error && <Txt variant="body" accessibilityRole="alert" color={theme.c.bad}>
              {expired ? (ru ? "Срок задания истёк. Можно получить новый пример." : "This exercise expired. You can get a fresh example.")
                : t(grade.checkErrorKey)}
            </Txt>}
            {practice && !!grade.result && <ResultPanel result={grade.result} exercise={exercise} levelUp={grade.levelUp}
              explained={grade.explained} explainLoading={grade.explainLoading} explainError={grade.explainError}
              onExplain={() => void grade.doExplain(exercise, responseDisplay)} />}
            {!practice && !!grade.result && <Txt variant="body" accessibilityLiveRegion="polite">{ru ? "Ответ принят" : "Answer recorded"}</Txt>}
          </>
        )}
        {phase === "ready" && (
          <>
          <Txt variant="cardTitle">{target ? topicLabel(target.topic) : ""}</Txt>
            <Txt variant="body" color={theme.c.ink2}>
              {ru ? `${PERSONAL_TEST_COUNT} новых примера без подсказок. Для зачёта достаточно ${PERSONAL_TEST_PASS} верных ответов.`
                : `${PERSONAL_TEST_COUNT} fresh examples with no hints. Answer ${PERSONAL_TEST_PASS} correctly to pass.`}
            </Txt>
          </>
        )}
        {phase === "finished" && (
          <>
            <Txt variant="cardTitle" color={passed ? theme.c.accent : theme.c.ink} accessibilityLiveRegion="polite">
              {ru ? (passed ? "Зачёт пройден" : "Тему стоит повторить") : (passed ? "Checkpoint passed" : "Keep practising this topic")}
            </Txt>
            <Txt variant="body">{ru ? `Верно ${right} из ${PERSONAL_TEST_COUNT}` : `${right} of ${PERSONAL_TEST_COUNT} correct`}</Txt>
            {testAnswers.map(({ exercise: card, result }, index) => !result.correct && (
              <View key={index} style={[styles.correction, { borderColor: theme.c.line }]}>
                <Txt variant="label" color={theme.c.ink2}>{ru ? `Задание ${index + 1}` : `Exercise ${index + 1}`}</Txt>
                {!!(card.prompt || card.text) && <Txt variant="body">{card.prompt || card.text}</Txt>}
                <Txt variant="bodyStrong">{result.correct_answer}</Txt>
                {!!result.explanation && <Txt variant="body" color={theme.c.ink2}>{result.explanation}</Txt>}
              </View>
            ))}
          </>
        )}
      </ScrollView>
      {phase === "intro" && (sourceError ? <Button label={t("action.tryAgain")} onPress={readSources} />
        : !sourceLoading && target ? <Button label={ru ? "Начать тренировку" : "Start practice"} onPress={() => void load("practice", 1)} />
        : !sourceLoading ? <Button label={ru ? "К упражнениям" : "Back to exercises"} onPress={close} /> : null)}
      {!!stage && !!loadError && <Button label={t("action.tryAgain")} onPress={() => void load(stage, round)} />}
      {!!stage && !!exercise && (grade.result
        ? <Button label={ru ? (round === count ? (practice ? "К зачёту" : "Показать результат") : "Следующее задание")
          : (round === count ? (practice ? "Go to checkpoint" : "Show result") : "Next exercise")} onPress={() => advance(stage)} />
        : expired ? <Button label={ru ? "Новый пример" : "Get a fresh example"} onPress={() => {
          if (visibleCard.current === exercise) void load(stage, round);
        }} />
          : <Button label={grade.checking ? (ru ? "Проверяем…" : "Checking…") : grade.error ? t("action.tryAgain") : (ru ? "Проверить" : "Check")}
            disabled={grade.checking || response === null} onPress={submit} />)}
      {phase === "ready" && <Button label={ru ? "Начать зачёт" : "Start checkpoint"} onPress={() => void load("test", 1)} />}
      {phase === "finished" && (
        <>
          {!passed && <Button label={ru ? "Потренироваться ещё" : "Practise again"} onPress={restart} />}
          <Button label={ru ? "Завершить" : "Finish"} variant={passed ? "primary" : "ghost"} onPress={close} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { flex: 1 },
  close: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  status: { flexDirection: "row", alignItems: "center", gap: 10 },
  bar: { flex: 1 },
  scroll: { flex: 1 },
  content: { gap: 16, paddingTop: 8, paddingBottom: 16 },
  topic: { minHeight: 56, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderRadius: 12,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  loading: { flexDirection: "row", alignItems: "center", gap: 10 },
  correction: { borderTopWidth: 1, paddingTop: 10, gap: 6 },
});
