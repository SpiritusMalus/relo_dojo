import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gateKind, type Exercise, type ResponseValue } from "../services/api";
import { createExerciseQueue, type ExerciseQueue } from "../services/exerciseQueue";
import ActivationBanner from "../components/ui/ActivationBanner";
import LimitSheet from "../components/ui/LimitSheet";
import { beltProgress } from "../store/dojo";
import ExerciseCard from "../components/ExerciseCard";
import ResultPanel from "../components/ResultPanel";
import { useProgress } from "../store/progress";
import { effectiveSkill, levelToCefr, selectNext } from "../store/adaptive";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { loadMistakes, mistakeHintsForTopic, type Mistake } from "../store/mistakes";
import { loadingMessageFor } from "../i18n/loading";
import { buildContext, TOPIC_LABELS } from "../store/onboarding";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import ProgressBar from "../components/ui/ProgressBar";
import Card from "../components/ui/Card";
import Confetti from "../components/ui/Confetti";
import Scroll from "../components/ui/Scroll";
import { boostActive } from "../store/progress";
import { ensureOffer } from "../store/offers";
import { useWallet } from "../store/wallet";

const SESSION_LEN = 10;

export default function PracticeScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress } = useProgress();
  const { t: tr } = useI18n();
  const { result, checking, error: checkError, levelUp, explained, explainLoading, check, doExplain, reset } =
    useExerciseCheck();
  const params = useLocalSearchParams<{ topic?: string }>();
  const forcedTopic = typeof params.topic === "string" ? params.topic : undefined;
  // Latest progress/topic for selecting/grading without stale closures.
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const forcedTopicRef = useRef(forcedTopic);
  forcedTopicRef.current = forcedTopic;

  // Pre-generation buffer: while the learner solves a card, the next ones are fetched in the
  // background so "Next" is instant. Params are resolved from the freshest learner model per fetch.
  // Recent misses (per device), refreshed on each load; fed back to the generator to target weak
  // points in a fresh sentence (personalized practice). Kept in a ref so selectParams stays sync.
  const mistakesRef = useRef<Mistake[]>([]);
  const queueRef = useRef<ExerciseQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createExerciseQueue({
      selectParams: () => {
        const { topic, cefr, type } = selectNext(progressRef.current, forcedTopicRef.current);
        return {
          topic,
          level: cefr,
          type,
          context: buildContext(progressRef.current.profile),
          mistakes: mistakeHintsForTopic(mistakesRef.current, topic),
        };
      },
    });
  }
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [round, setRound] = useState(0); // bumps to remount ExerciseCard on each new exercise
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [responseDisplay, setResponseDisplay] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gated, setGated] = useState(false); // 403: account not activated / starter limit reached
  const [limited, setLimited] = useState(false); // 403 "daily_limit": free-tier cap → upsell sheet
  const [solved, setSolved] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [showScroll, setShowScroll] = useState(false); // end-of-session summary + reward scroll
  const { isPremium } = useWallet();
  // XP at session start — the summary shows the delta (combo/boost included automatically).
  const startXpRef = useRef<number | null>(null);
  if (startXpRef.current === null) startXpRef.current = progress.xp;
  const error = loadError ?? checkError;

  const shake = useRef(new Animated.Value(0)).current;

  const loadExercise = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setGated(false);
    setLimited(false);
    reset();
    setResponse(null);
    setResponseDisplay("");
    setExercise(null);
    try {
      // Refresh the local miss list so freshly-refilled cards can target the latest weak points.
      mistakesRef.current = await loadMistakes();
      // Pull from the buffer (instant if prefetched); the queue handles adaptive selection and
      // refills itself in the background.
      setExercise(await queueRef.current!.next());
      setRound((r) => r + 1);
    } catch (e) {
      // 403 routes by gate kind: "limit" → limit sheet with the upsell; "gated" → the activation
      // prompt. Never a raw error.
      const gate = gateKind(e);
      if (gate === "limit") {
        setLimited(true);
        // Trigger: first limit hit ever → open the one-shot 48h double-pack offer.
        void ensureOffer("limit48");
      } else if (gate === "gated") setGated(true);
      else setLoadError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      setLoading(false);
    }
  }, [reset]);

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
    const res = await check(exercise, response, runShake);
    if (res) {
      setSolved((s) => s + 1);
      if (res.correct) setSessionCorrect((c) => c + 1);
    }
  }

  function onExplain() {
    if (!exercise) return;
    doExplain(exercise, responseDisplay);
  }

  const canSubmit = response !== null && !checking;
  const topicLabel = forcedTopic ? TOPIC_LABELS[forcedTopic] ?? forcedTopic : tr("btn.mix.title");

  // X mid-session: confirm before discarding answered cards and the end-of-session scroll.
  // Free exit before the first answer and once the summary is showing (nothing left to lose).
  function onClose() {
    if (solved === 0 || showScroll) {
      router.back();
      return;
    }
    Alert.alert(tr("exit.title"), tr("exit.msg"), [
      { text: tr("exit.stay"), style: "cancel" },
      { text: tr("exit.leave"), style: "destructive", onPress: () => router.back() },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />

      {/* Header: close, session progress, streak */}
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
          <Icon name="x" size={24} color={t.c.ink2} />
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={(Math.min(solved, SESSION_LEN) / SESSION_LEN) * 100} height={10} />
        </View>
        <Txt variant="caption" color={t.c.fire}>
          {`${boostActive(progress) ? "⚡x2 " : ""}🔥 ${progress.dailyStreak}`}
        </Txt>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Txt variant="label" style={{ marginBottom: 2 }}>
          {topicLabel}
          {exercise ? `  ·  ${levelToCefr(effectiveSkill(progress, exercise.topic))}` : ""}
        </Txt>

        {loading && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(round)}</Txt>
          </View>
        )}

        {limited && !loading && (
          <View style={{ marginTop: 20 }}>
            <LimitSheet belt={beltProgress(progress).belt} onUnlocked={loadExercise} />
          </View>
        )}

        {gated && !loading && (
          <View style={{ marginTop: 20, gap: 12 }}>
            <ActivationBanner />
            <Txt variant="secondary" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("activate.lockedMsg")}
            </Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={loadExercise} />
          </View>
        )}

        {error && !gated && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Txt variant="body" color={t.c.bad} style={{ textAlign: "center" }}>
              {error}
            </Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={loadExercise} />
          </View>
        )}

        {showScroll && (
          <View style={{ marginTop: 20, gap: 14 }}>
            {/* Session summary — the peak-end beat: stats, then the scroll, then the pitch. */}
            <Card>
              <View style={{ alignItems: "center", gap: 6, paddingVertical: 4 }}>
                <Txt variant="bodyStrong">{tr("summary.title")}</Txt>
                <Txt variant="body" color={t.c.ink2}>
                  {tr("summary.stats", { correct: sessionCorrect, total: solved })}
                </Txt>
                <Txt variant="bodyStrong" color={t.c.gold}>
                  {tr("summary.xp", { n: progress.xp - (startXpRef.current ?? progress.xp) })}
                </Txt>
              </View>
            </Card>
            <Scroll onDone={() => router.back()} />
            {!isPremium && (
              <Button label={tr("limit.premium")} variant="ghost" onPress={() => router.push("/premium")} />
            )}
          </View>
        )}

        {exercise && !loading && !showScroll && (
          <Animated.View style={{ transform: [{ translateX: shake }], gap: t.spacing.gap }}>
            <ExerciseCard key={round} exercise={exercise} locked={!!result} onChange={onChange} />
          </Animated.View>
        )}

        {result && exercise && !showScroll && (
          <ResultPanel
            result={result}
            exercise={exercise}
            levelUp={levelUp}
            explained={explained}
            explainLoading={explainLoading}
            onExplain={onExplain}
          />
        )}
      </ScrollView>

      {result?.correct && <Confetti />}

      {/* Sticky bottom action */}
      {exercise && !loading && !showScroll && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          {result ? (
            // Session complete → the reward scroll is the closing beat; otherwise next card.
            solved >= SESSION_LEN ? (
              <Button label={tr("action.finish")} onPress={() => setShowScroll(true)} />
            ) : (
              <Button label={tr("action.next")} onPress={loadExercise} />
            )
          ) : (
            <Button label={checking ? tr("action.checking") : tr("action.check")} onPress={onCheck} disabled={!canSubmit} />
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
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
