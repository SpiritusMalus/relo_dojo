import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  checkFreeText,
  checkInteractive,
  explain,
  type Exercise,
  type ExplainResult,
  type ResponseValue,
} from "../services/api";
import { createExerciseQueue, type ExerciseQueue } from "../services/exerciseQueue";
import ExerciseCard from "../components/ExerciseCard";
import { useProgress, XP_PER_CORRECT } from "../store/progress";
import { cefrMidpoint, isCefr, levelToCefr, selectNext, skillFor, updateSkill } from "../store/adaptive";
import { buildContext, TOPIC_LABELS } from "../store/onboarding";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import Sensei from "../components/ui/Sensei";
import ProgressBar from "../components/ui/ProgressBar";
import Confetti from "../components/ui/Confetti";

type Result = {
  correct: boolean;
  correct_answer: string;
  score?: number;
  detail?: string;
  explanation?: string;
  tip?: string;
};

const SESSION_LEN = 10;

export default function PracticeScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress, recordAnswer } = useProgress();
  const params = useLocalSearchParams<{ topic?: string }>();
  const forcedTopic = typeof params.topic === "string" ? params.topic : undefined;
  // Latest progress/topic for selecting/grading without stale closures.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const forcedTopicRef = useRef(forcedTopic);
  forcedTopicRef.current = forcedTopic;

  // Pre-generation buffer: while the learner solves a card, the next ones are fetched in the
  // background so "Next" is instant. Params are resolved from the freshest learner model per fetch.
  const queueRef = useRef<ExerciseQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createExerciseQueue({
      selectParams: () => {
        const { topic, cefr, type } = selectNext(progressRef.current, forcedTopicRef.current);
        return { topic, level: cefr, type, context: buildContext(progressRef.current.profile) };
      },
    });
  }
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [levelUp, setLevelUp] = useState<string | null>(null);
  const [round, setRound] = useState(0); // bumps to remount ExerciseCard on each new exercise
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explained, setExplained] = useState<ExplainResult | null>(null);
  const [solved, setSolved] = useState(0);

  const shake = useRef(new Animated.Value(0)).current;

  const loadExercise = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setResponse(null);
    setResponseDisplay("");
    setExplained(null);
    setLevelUp(null);
    setExercise(null);
    try {
      // Pull from the buffer (instant if prefetched); the queue handles adaptive selection and
      // refills itself in the background.
      setExercise(await queueRef.current!.next());
      setRound((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // On mount, or when the drilled topic changes, drop any buffered cards (they may be off-topic)
    // and load fresh. clear() on an empty queue is a no-op.
    queueRef.current!.clear();
    loadExercise();
  }, [forcedTopic, loadExercise]);

  function onChange(value: ResponseValue | null, display: string) {
    setResponse(value);
    setResponseDisplay(display);
  }

  function runShake() {
    if (t.reduceMotion) return;
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: -7, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -4, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 3, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  async function onCheck() {
    if (!exercise || response === null || checking) return;
    setChecking(true);
    setError(null);
    try {
      let res: Result;
      if (exercise.token) {
        res = await checkInteractive(exercise.token, response);
      } else {
        res = await checkFreeText(exercise.text, String(response));
      }
      setResult(res);
      setSolved((s) => s + 1);
      if (!res.correct) runShake();
      // Difficulty-aware skill signal: partial score + the difficulty of the served item.
      const outcome = res.score ?? (res.correct ? 1 : 0);
      const difficulty = cefrMidpoint(levelToCefr(skillFor(progressRef.current, exercise.topic)));
      const servedDifficulty = isCefr(exercise.level) ? cefrMidpoint(exercise.level) : difficulty;
      // Detect a CEFR level-up for this topic (compute the would-be new level before state updates).
      const before = skillFor(progressRef.current, exercise.topic);
      const after = updateSkill(
        progressRef.current,
        exercise.topic,
        outcome,
        servedDifficulty
      )[exercise.topic];
      // gamification + difficulty-aware skill: once per answer.
      recordAnswer(exercise.topic, res.correct, { score: res.score, difficulty: servedDifficulty });
      if (after > before && levelToCefr(after) !== levelToCefr(before)) {
        setLevelUp(`${exercise.topic} is now ${levelToCefr(after)}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check answer");
    } finally {
      setChecking(false);
    }
  }

  async function onExplain() {
    if (!exercise || !result || explainLoading) return;
    setExplainLoading(true);
    try {
      setExplained(await explain(exercise.text, result.correct_answer, responseDisplay));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to explain");
    } finally {
      setExplainLoading(false);
    }
  }

  const canSubmit = response !== null && !checking;
  const canExplain = !!result && !result.correct && !result.explanation && !explained && !!exercise?.token;
  const topicLabel = forcedTopic ? TOPIC_LABELS[forcedTopic] ?? forcedTopic : "Daily mix";

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />

      {/* Header: close, session progress, streak */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
          <Icon name="x" size={24} color={t.c.ink2} />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={(Math.min(solved, SESSION_LEN) / SESSION_LEN) * 100} height={10} />
        </View>
        <Txt variant="caption" color={t.c.fire}>{`🔥 ${progress.dailyStreak}`}</Txt>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Txt variant="label" style={{ marginBottom: 2 }}>
          {topicLabel}
          {exercise ? `  ·  ${levelToCefr(skillFor(progress, exercise.topic))}` : ""}
        </Txt>

        {loading && <ActivityIndicator style={{ marginTop: 40 }} color={t.c.accent} />}

        {error && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Txt variant="body" color={t.c.bad} style={{ textAlign: "center" }}>
              {error}
            </Txt>
            <Button label="Try again" variant="ghost" onPress={loadExercise} />
          </View>
        )}

        {exercise && !loading && (
          <Animated.View style={{ transform: [{ translateX: shake }], gap: t.spacing.gap }}>
            <ExerciseCard key={round} exercise={exercise} locked={!!result} onChange={onChange} />
          </Animated.View>
        )}

        {result && (
          <View
            style={[
              styles.panel,
              {
                backgroundColor: result.correct ? t.c.accentSoft : t.c.badSoft,
                borderColor: result.correct ? t.c.accent : t.c.bad,
                borderRadius: t.spacing.radius,
              },
            ]}
          >
            <View style={styles.panelHead}>
              <Sensei size={44} mood={result.correct ? "cheer" : "think"} />
              <View style={{ flex: 1 }}>
                <Txt variant="cardTitle" color={result.correct ? t.c.accent : t.c.bad}>
                  {result.correct ? "Clean strike!" : "Not quite"}
                </Txt>
                {result.correct ? (
                  <Txt variant="bodyStrong" color={t.c.gold}>{`+${XP_PER_CORRECT} XP`}</Txt>
                ) : (result.score ?? 0) > 0 && !!result.detail ? (
                  <Txt variant="bodyStrong" color={t.c.fire}>{`Almost — ${result.detail} right`}</Txt>
                ) : null}
              </View>
            </View>

            {!result.correct && (
              <Txt variant="mono" color={t.c.ink} style={{ marginTop: 4 }}>
                {result.correct_answer}
              </Txt>
            )}
            {result.correct && progress.currentCorrectRun >= 3 && (
              <Txt variant="bodyStrong" color={t.c.fire}>{`🔥 ${progress.currentCorrectRun} correct in a row!`}</Txt>
            )}
            {!!levelUp && <Txt variant="bodyStrong" color={t.c.accent}>{`⬆ ${levelUp}`}</Txt>}
            {!!result.explanation && <Txt variant="body" color={t.c.ink2}>{`💡 ${result.explanation}`}</Txt>}
            {!!result.tip && <Txt variant="secondary" color={t.c.ink2}>{result.tip}</Txt>}

            {canExplain && (
              <Pressable onPress={onExplain} disabled={explainLoading} style={{ paddingVertical: 6 }}>
                {explainLoading ? <ActivityIndicator color={t.c.accent} /> : <Txt variant="bodyStrong" color={t.c.accent}>Explain</Txt>}
              </Pressable>
            )}
            {explained && (
              <>
                <Txt variant="body" color={t.c.ink2}>{`💡 ${explained.explanation}`}</Txt>
                {!!explained.tip && <Txt variant="secondary" color={t.c.ink2}>{explained.tip}</Txt>}
              </>
            )}
          </View>
        )}
      </ScrollView>

      {result?.correct && <Confetti />}

      {/* Sticky bottom action */}
      {exercise && !loading && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          {result ? (
            <Button label="Next exercise" onPress={loadExercise} />
          ) : (
            <Button label={checking ? "Checking…" : "Check"} onPress={onCheck} disabled={!canSubmit} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  panel: { borderWidth: 2, padding: 16, gap: 8 },
  panelHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
