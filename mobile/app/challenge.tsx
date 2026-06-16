// Daily Challenge screen: a fast, timed run with scored combos.
//
// Answer as many cards as you can before the clock runs out. Each correct answer builds a combo that
// multiplies the points of the next one; a miss resets it. Cards come from the same adaptive queue as
// Practice and every answer goes through useExerciseCheck, so XP / streak / the adaptive model update
// just like normal practice — the score and best are the only challenge-local extras (store/challenge.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gateKind, type Exercise, type ResponseValue } from "../services/api";
import { createExerciseQueue, type ExerciseQueue } from "../services/exerciseQueue";
import { trackExerciseAnswered } from "../services/analytics";
import ActivationBanner from "../components/ui/ActivationBanner";
import LimitSheet from "../components/ui/LimitSheet";
import RegisterWall from "../components/ui/RegisterWall";
import ExerciseCard from "../components/ExerciseCard";
import { beltProgress } from "../store/dojo";
import { ensureOffer } from "../store/offers";
import { useProgress } from "../store/progress";
import { useAuth } from "../store/auth";
import { consumeGuestExercise } from "../store/guestLimit";
import { localDate } from "../store/streak";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { loadingMessageFor } from "../i18n/loading";
import { selectNext } from "../store/adaptive";
import { buildContext } from "../store/onboarding";
import {
  CHALLENGE_SECONDS,
  comboMultiplier,
  loadBestScore,
  recordBestScore,
  scoreAnswer,
} from "../store/challenge";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";
import Sensei from "../components/ui/Sensei";
import ProgressBar from "../components/ui/ProgressBar";
import Confetti from "../components/ui/Confetti";

type Phase = "intro" | "solving" | "feedback" | "done";
const FEEDBACK_MS = 1100; // brief flash before auto-advancing to the next card

export default function ChallengeScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress } = useProgress();
  const { token } = useAuth();
  const { t: tr } = useI18n();
  const { result, checking, error: checkError, check, reset } = useExerciseCheck();

  const progressRef = useRef(progress);
  progressRef.current = progress;

  const queueRef = useRef<ExerciseQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createExerciseQueue({
      selectParams: () => {
        const { topic, cefr, type } = selectNext(progressRef.current);
        return { topic, level: cefr, type, context: buildContext(progressRef.current.profile) };
      },
    });
  }

  const [phase, setPhase] = useState<Phase>("intro");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [round, setRound] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false); // 403 "daily_limit": free-tier cap → upsell sheet
  const [gated, setGated] = useState(false); // 403 starter/activation → activation prompt
  const [guestLimited, setGuestLimited] = useState(false); // anon hit today's shared client cap → register wall

  const [timeLeft, setTimeLeft] = useState(CHALLENGE_SECONDS);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [best, setBest] = useState(0);
  const [isRecord, setIsRecord] = useState(false);

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadBestScore().then(setBest);
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  const loadExercise = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLimited(false);
    setGated(false);
    setGuestLimited(false);
    reset();
    setResponse(null);
    setExercise(null);
    // Guests get the same daily allowance as Practice (store/guestLimit.ts). The Challenge draws from
    // the same LLM-backed queue, so it must consume the SHARED cap too — otherwise it's a free,
    // unmetered way for anon users to burn model calls. On exhaustion: pause the run, show the wall.
    if (!token && !(await consumeGuestExercise(localDate(new Date())))) {
      setGuestLimited(true);
      setLoading(false);
      return;
    }
    try {
      setExercise(await queueRef.current!.next());
      setRound((r) => r + 1);
      setPhase("solving");
    } catch (e) {
      // Same routing as Practice: the daily cap and the activation gate are product states, not
      // errors — show the sheet/prompt (and pause the clock) instead of a raw failure.
      const gate = gateKind(e);
      if (gate === "limit") {
        setLimited(true);
        void ensureOffer("limit48");
      } else if (gate === "gated") setGated(true);
      else setError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      setLoading(false);
    }
  }, [reset, token]);

  // Countdown: only ticks while the learner is actively solving / reading feedback, so a slow fetch
  // (cold model), an error, or a gate sheet doesn't eat the clock. Hitting zero ends the run.
  useEffect(() => {
    if (phase !== "solving" && phase !== "feedback") return;
    if (loading || error || limited || gated || guestLimited) return;
    if (timeLeft <= 0) return;
    const id = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, timeLeft, loading, error, limited, gated, guestLimited]);

  const finish = useCallback(async () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setPhase("done");
    const { best: newBest, isRecord: rec } = await recordBestScore(score);
    setBest(newBest);
    setIsRecord(rec);
  }, [score]);

  useEffect(() => {
    if (timeLeft <= 0 && (phase === "solving" || phase === "feedback")) finish();
  }, [timeLeft, phase, finish]);

  function start() {
    setPhase("solving");
    setTimeLeft(CHALLENGE_SECONDS);
    setScore(0);
    setCombo(0);
    setBestCombo(0);
    setAnswered(0);
    setCorrect(0);
    setIsRecord(false);
    queueRef.current!.clear();
    loadExercise();
  }

  function onChange(value: ResponseValue | null) {
    setResponse(value);
  }

  function runFlash() {
    if (t.reduceMotion) return;
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 400, useNativeDriver: true }).start();
  }

  async function onCheck() {
    if (!exercise || response === null || checking || phase !== "solving") return;
    const res = await check(exercise, response);
    if (!res) return; // network error — surfaced via checkError
    // Funnel + daily contracts: a Challenge answer is an answered exercise too (mode tags it), so it
    // counts toward the "answer N / N correct" contracts exactly like Practice (same event).
    trackExerciseAnswered({ topic: exercise.topic, correct: res.correct, level: exercise.level, mode: "challenge" });
    const step = scoreAnswer(combo, res.correct, res.score ?? (res.correct ? 1 : 0));
    setScore((s) => s + step.points);
    setCombo(step.combo);
    setBestCombo((b) => Math.max(b, step.combo));
    setAnswered((n) => n + 1);
    if (res.correct) setCorrect((n) => n + 1);
    setPhase("feedback");
    runFlash();
    advanceTimer.current = setTimeout(() => {
      if (timeLeft > 0) loadExercise();
    }, FEEDBACK_MS);
  }

  const canSubmit = response !== null && !checking;
  const mult = comboMultiplier(combo);

  // --- Intro ---
  if (phase === "intro") {
    return (
      <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
        <StatusBar style={t.name === "dark" ? "light" : "dark"} />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
            <Icon name="x" size={24} color={t.c.ink2} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { alignItems: "center", paddingBottom: insets.bottom + 120 }]}>
          <Sensei size={108} mood="cheer" bob />
          <Txt variant="hero" style={{ marginTop: 8 }}>{tr("ch.title")}</Txt>
          <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
            {tr("ch.intro", { seconds: CHALLENGE_SECONDS, max: comboMultiplier(Infinity) })}
          </Txt>
          <Card style={{ width: "100%", alignItems: "center", gap: 4, marginTop: 8 }}>
            <Txt variant="label" color={t.c.ink3}>{tr("ch.best")}</Txt>
            <Txt variant="hero" color={t.c.gold}>{best}</Txt>
          </Card>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          <Button label={tr("ch.start")} onPress={start} />
        </View>
      </View>
    );
  }

  // --- Done ---
  if (phase === "done") {
    return (
      <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
        <StatusBar style={t.name === "dark" ? "light" : "dark"} />
        <ScrollView contentContainerStyle={[styles.content, { alignItems: "center", paddingBottom: insets.bottom + 120 }]}>
          <Sensei size={112} mood={isRecord ? "cheer" : "happy"} bob />
          <Txt variant="hero" style={{ marginTop: 8 }}>{tr("ch.time")}</Txt>
          {isRecord && <Txt variant="bodyStrong" color={t.c.gold}>{tr("ch.newBest")}</Txt>}
          <Txt variant="hero" color={t.c.accent}>{score}</Txt>
          <Txt variant="secondary" color={t.c.ink3}>{tr("ch.bestLabel", { n: best })}</Txt>
          <View style={styles.statRow}>
            <Stat label={tr("ch.correct")} value={`${correct}/${answered}`} />
            <Stat label={tr("ch.bestCombo")} value={`${bestCombo}×`} />
          </View>
        </ScrollView>
        {isRecord && <Confetti />}
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          <Button label={tr("ch.playAgain")} onPress={start} />
          <Pressable onPress={() => router.back()} style={{ paddingVertical: 10, alignItems: "center" }}>
            <Txt variant="bodyStrong" color={t.c.ink2}>{tr("ch.backHome")}</Txt>
          </Pressable>
        </View>
      </View>
    );
  }

  // --- Solving / feedback ---
  const flashColor = result?.correct ? t.c.accent : t.c.bad;
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: flashColor, opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.18] }) }]}
      />

      {/* Header: timer bar + score */}
      <View style={styles.header}>
        <Txt variant="bodyStrong" color={timeLeft <= 10 ? t.c.bad : t.c.ink}>{`⏱ ${timeLeft}s`}</Txt>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={(timeLeft / CHALLENGE_SECONDS) * 100} height={10} color={timeLeft <= 10 ? t.c.bad : t.c.accent} />
        </View>
        <Txt variant="bodyStrong" color={t.c.gold}>{score}</Txt>
      </View>

      {/* Combo banner */}
      <View style={styles.comboRow}>
        <Txt variant="caption" color={t.c.ink3}>
          {combo >= 1 ? tr("ch.combo", { n: combo }) : tr("ch.buildCombo")}
        </Txt>
        <Txt variant="caption" color={mult > 1 ? t.c.fire : t.c.ink3}>{tr("ch.points", { n: mult })}</Txt>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(round)}</Txt>
          </View>
        )}

        {/* Daily cap mid-run: the clock is paused; buying a pack resumes, or bail out with the
            score earned so far. */}
        {limited && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <LimitSheet belt={beltProgress(progress).belt} onUnlocked={loadExercise} />
            <Button label={tr("ch.backHome")} variant="ghost" onPress={() => router.back()} />
          </View>
        )}

        {guestLimited && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <RegisterWall
              reason="limit"
              onCreate={() => router.push("/login")}
              onDismiss={() => router.back()}
            />
            <Button label={tr("ch.backHome")} variant="ghost" onPress={() => router.back()} />
          </View>
        )}

        {gated && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <ActivationBanner />
            <Txt variant="secondary" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("activate.lockedMsg")}
            </Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={loadExercise} />
            <Button label={tr("ch.backHome")} variant="ghost" onPress={() => router.back()} />
          </View>
        )}

        {error && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Txt variant="body" color={t.c.bad} style={{ textAlign: "center" }}>{error}</Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={loadExercise} />
          </View>
        )}
        {checkError && !error && (
          <Txt variant="secondary" color={t.c.bad} style={{ textAlign: "center" }}>{checkError}</Txt>
        )}

        {exercise && !loading && (
          <ExerciseCard key={round} exercise={exercise} locked={phase === "feedback"} onChange={onChange} />
        )}

        {phase === "feedback" && result && (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, borderColor: flashColor, borderWidth: 2 }}>
            <Sensei size={40} mood={result.correct ? "cheer" : "think"} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle" color={flashColor}>{result.correct ? tr("ch.strike") : tr("ch.miss")}</Txt>
              {!result.correct && <Txt variant="mono" color={t.c.ink2}>{result.correct_answer}</Txt>}
            </View>
            {result.correct && <Txt variant="bodyStrong" color={t.c.gold}>{`+${scoreAnswer(Math.max(0, combo - 1), true).points}`}</Txt>}
          </Card>
        )}
      </ScrollView>

      {phase === "solving" && exercise && !loading && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          <Button label={checking ? tr("action.checking") : tr("action.check")} onPress={onCheck} disabled={!canSubmit} />
        </View>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Txt variant="hero" color={t.c.ink}>{value}</Txt>
      <Txt variant="label" color={t.c.ink3}>{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, minHeight: 44 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  comboRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 4 },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  statRow: { flexDirection: "row", gap: 16, marginTop: 16, width: "100%" },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
