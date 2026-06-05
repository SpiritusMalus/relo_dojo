import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams } from "expo-router";
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
import { useProgress } from "../store/progress";
import { cefrMidpoint, isCefr, levelToCefr, selectNext, skillFor, updateSkill } from "../store/adaptive";
import { buildContext, TOPIC_LABELS } from "../store/onboarding";

type Result = {
  correct: boolean;
  correct_answer: string;
  score?: number;
  detail?: string;
  explanation?: string;
  tip?: string;
};

export default function PracticeScreen() {
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
  // Show an Explain button only for interactive misses without an explanation already.
  const canExplain =
    !!result && !result.correct && !result.explanation && !explained && !!exercise?.token;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        {forcedTopic ? TOPIC_LABELS[forcedTopic] ?? forcedTopic : "Daily practice"}
      </Text>

      {loading && <ActivityIndicator style={{ marginTop: 40 }} />}

      {error && !loading && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={loadExercise}>
            <Text style={styles.secondaryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}

      {exercise && !loading && (
        <View style={styles.card}>
          <Text style={styles.topic}>
            {exercise.topic} · {levelToCefr(skillFor(progress, exercise.topic))}
          </Text>

          <ExerciseCard
            key={round}
            exercise={exercise}
            locked={!!result}
            onChange={onChange}
          />

          {!result && (
            <TouchableOpacity
              style={[styles.primaryBtn, !canSubmit && styles.btnDisabled]}
              onPress={onCheck}
              disabled={!canSubmit}
            >
              {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Check</Text>}
            </TouchableOpacity>
          )}

          {result && (
            <View style={styles.result}>
              <Text style={[styles.verdict, result.correct ? styles.ok : styles.bad]}>
                {result.correct ? "✓ Correct" : "✗ Not quite"}
              </Text>
              {result.correct && progress.currentCorrectRun >= 3 && (
                <Text style={styles.combo}>🔥 {progress.currentCorrectRun} in a row!</Text>
              )}
              {/* Partial credit: encourage when the learner got some (but not all) elements right. */}
              {!result.correct && !!result.detail && (result.score ?? 0) > 0 && (
                <Text style={styles.partial}>Almost — {result.detail} right</Text>
              )}
              {!result.correct && (
                <Text style={styles.answerLine}>Answer: {result.correct_answer}</Text>
              )}

              {!!levelUp && <Text style={styles.levelUp}>⬆ {levelUp}</Text>}

              {/* Free-text comes with an explanation already. */}
              {!!result.explanation && <Text style={styles.explanation}>{result.explanation}</Text>}
              {!!result.tip && <Text style={styles.tip}>💡 {result.tip}</Text>}

              {/* Interactive miss: explanation on demand. */}
              {canExplain && (
                <TouchableOpacity style={styles.secondaryBtn} onPress={onExplain} disabled={explainLoading}>
                  {explainLoading ? (
                    <ActivityIndicator />
                  ) : (
                    <Text style={styles.secondaryText}>Explain</Text>
                  )}
                </TouchableOpacity>
              )}
              {explained && (
                <>
                  <Text style={styles.explanation}>{explained.explanation}</Text>
                  {!!explained.tip && <Text style={styles.tip}>💡 {explained.tip}</Text>}
                </>
              )}

              <TouchableOpacity style={styles.primaryBtn} onPress={loadExercise}>
                <Text style={styles.primaryText}>Next exercise</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 60, gap: 16 },
  title: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  card: { gap: 14 },
  topic: {
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: "600",
    color: "#0a7d28",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  primaryBtn: {
    backgroundColor: "#0a7d28",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  btnDisabled: { backgroundColor: "#9bbfa5" },
  secondaryBtn: { paddingVertical: 10, alignItems: "center" },
  secondaryText: { color: "#0a7d28", fontWeight: "600", fontSize: 16 },
  result: { gap: 8, marginTop: 4 },
  verdict: { fontSize: 18, fontWeight: "700" },
  ok: { color: "#0a7d28" },
  bad: { color: "#c0392b" },
  answerLine: { fontSize: 16, fontWeight: "600", color: "#111" },
  partial: { fontSize: 15, fontWeight: "600", color: "#e67e22" },
  combo: { fontSize: 16, fontWeight: "700", color: "#e67e22" },
  levelUp: { fontSize: 15, fontWeight: "700", color: "#0a7d28" },
  explanation: { fontSize: 16, lineHeight: 22, color: "#333" },
  tip: { fontSize: 15, color: "#555", fontStyle: "italic" },
  errorBox: { gap: 8, marginTop: 20 },
  errorText: { fontSize: 15, color: "#c0392b", textAlign: "center" },
});
