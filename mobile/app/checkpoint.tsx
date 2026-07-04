// Topic checkpoint (зачёт): the ceremony that turns evidence into mastery. Reached when the unit's
// mastery meter is full (store/curriculum.ts): CHECKPOINT_ITEMS fresh exercises on THIS topic, in
// constructive formats only, closed book (no 📖, no swerve, no miss hints in generation), at most
// CHECKPOINT_MAX_MISSES misses. Pass → the unit is mastered (progress.course) and the next unit on
// the path opens. Fail → nothing is lost, but the quiz answers feed the same evidence window, so
// the meter drops and re-earning it is the natural retry cooldown (no day locks). Modeled on
// belt-exam.tsx; answers flow through useExerciseCheck, so XP / streak / skill update as usual.
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gateKind, type Exercise, type ResponseValue } from "../services/api";
import { createExerciseQueue, type ExerciseQueue } from "../services/exerciseQueue";
import ActivationBanner from "../components/ui/ActivationBanner";
import LimitSheet from "../components/ui/LimitSheet";
import ExerciseCard from "../components/ExerciseCard";
import { beltProgress } from "../store/dojo";
import {
  CHECKPOINT_FORMATS,
  CHECKPOINT_ITEMS,
  CHECKPOINT_MAX_MISSES,
  checkpointFailedNow,
  checkpointPassed,
  CURRICULUM,
  masteryOf,
  RULE_CARDS,
} from "../store/curriculum";
import { effectiveSkill, levelToCefr } from "../store/adaptive";
import { useProgress } from "../store/progress";
import { useExerciseCheck } from "../store/useExerciseCheck";
import { useI18n } from "../store/i18n";
import { loadingMessageFor } from "../i18n/loading";
import { buildContext, TOPIC_LABELS } from "../store/onboarding";
import { RU_TOPIC_LABELS } from "../i18n/strings";
import { useTheme } from "../theme/theme";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Confetti from "../components/ui/Confetti";
import Icon from "../components/ui/Icon";
import ProgressBar from "../components/ui/ProgressBar";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

type Phase = "intro" | "solving" | "feedback" | "passed" | "failed";
const FEEDBACK_MS = 1200;

export default function CheckpointScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress, masterUnit } = useProgress();
  const { t: tr, lang } = useI18n();
  const { result, checking, error: checkError, check, reset } = useExerciseCheck();

  const params = useLocalSearchParams<{ topic?: string }>();
  const topic = typeof params.topic === "string" ? params.topic : "";
  const labelFor = (id: string) => (lang === "ru" ? RU_TOPIC_LABELS[id] : TOPIC_LABELS[id]) ?? TOPIC_LABELS[id] ?? id;

  // Eligibility is read once at mount: mid-quiz evidence changes must not move the goalposts.
  const eligibleRef = useRef(
    !!RULE_CARDS[topic] &&
      !(progress.course?.mastered ?? []).includes(topic) &&
      masteryOf(progress.course?.history[topic]).met
  );
  const alreadyMastered = (progress.course?.mastered ?? []).includes(topic);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const answeredRef = useRef(0);
  const queueRef = useRef<ExerciseQueue | null>(null);
  if (queueRef.current === null) {
    queueRef.current = createExerciseQueue({
      selectParams: () => ({
        topic, // the unit under test — always forced
        level: levelToCefr(effectiveSkill(progressRef.current, topic)),
        // Constructive formats only, rotated so one quiz spans several shapes. Closed book:
        // no miss hints — the зачёт must be fresh items, not replays.
        type: CHECKPOINT_FORMATS[answeredRef.current % CHECKPOINT_FORMATS.length],
        context: buildContext(progressRef.current.profile),
      }),
    });
  }

  const [phase, setPhase] = useState<Phase>("intro");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [round, setRound] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [gated, setGated] = useState(false);
  const [answered, setAnswered] = useState(0);
  const [misses, setMisses] = useState(0);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadExercise = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLimited(false);
    setGated(false);
    reset();
    setResponse(null);
    setExercise(null);
    try {
      setExercise(await queueRef.current!.next());
      setRound((r) => r + 1);
      setPhase("solving");
    } catch (e) {
      const gate = gateKind(e);
      if (gate === "limit") setLimited(true);
      else if (gate === "gated") setGated(true);
      else setError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      setLoading(false);
    }
  }, [reset]);

  function finish(passedRun: boolean) {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (passedRun) masterUnit(topic); // the one place mastery is granted
    setPhase(passedRun ? "passed" : "failed");
  }

  function start() {
    setAnswered(0);
    setMisses(0);
    answeredRef.current = 0;
    queueRef.current!.clear();
    loadExercise();
  }

  async function onCheck() {
    if (!exercise || response === null || checking || phase !== "solving") return;
    const res = await check(exercise, response);
    if (!res) return;
    const newAnswered = answered + 1;
    const newMisses = misses + (res.correct ? 0 : 1);
    setAnswered(newAnswered);
    setMisses(newMisses);
    answeredRef.current = newAnswered;
    setPhase("feedback");
    advanceTimer.current = setTimeout(() => {
      if (checkpointFailedNow(newMisses)) finish(false);
      else if (newAnswered >= CHECKPOINT_ITEMS) finish(checkpointPassed(newMisses));
      else loadExercise();
    }, FEEDBACK_MS);
  }

  // Not eligible (deep link / already passed / meter not full) — bounce gracefully.
  if (!eligibleRef.current && phase === "intro") {
    return (
      <Centered insets={insets} onClose={() => router.back()}>
        <Sensei size={96} mood={alreadyMastered ? "cheer" : "think"} />
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
          {tr(alreadyMastered ? "cp.alreadyDone" : "cp.locked")}
        </Txt>
        <Button label={tr("ch.backHome")} onPress={() => router.back()} />
      </Centered>
    );
  }

  if (phase === "intro") {
    return (
      <Centered insets={insets} onClose={() => router.back()}>
        <Sensei size={96} mood="think" />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("cp.title", { topic: labelFor(topic) })}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
          {tr("cp.rules", { items: CHECKPOINT_ITEMS, misses: CHECKPOINT_MAX_MISSES })}
        </Txt>
        <Button label={tr("cp.start")} onPress={start} style={{ alignSelf: "stretch" }} />
      </Centered>
    );
  }

  if (phase === "passed") {
    const idx = CURRICULUM.findIndex((u) => u.topic === topic);
    const next = idx >= 0 ? CURRICULUM[idx + 1] : undefined;
    return (
      <Centered insets={insets}>
        <Sensei size={112} mood="cheer" bob />
        <Txt variant="hero" style={{ textAlign: "center" }}>{`🥋 ${tr("course.mastered")}`}</Txt>
        <Txt variant="bodyStrong" style={{ textAlign: "center" }}>{labelFor(topic)}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
          {next ? tr("cp.passedNext", { topic: labelFor(next.topic) }) : tr("cp.passedAll")}
        </Txt>
        <Button label={tr("ch.backHome")} onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
        <Confetti />
      </Centered>
    );
  }

  if (phase === "failed") {
    return (
      <Centered insets={insets}>
        <Sensei size={112} mood="think" />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("cp.failed")}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("cp.failedSub")}</Txt>
        <Button label={tr("ch.backHome")} onPress={() => router.back()} style={{ alignSelf: "stretch" }} />
      </Centered>
    );
  }

  // --- solving / feedback ---
  const verdictColor = result?.correct ? t.c.accent : t.c.bad;
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Txt variant="bodyStrong">{tr("exam.progress", { n: Math.min(answered + 1, CHECKPOINT_ITEMS), total: CHECKPOINT_ITEMS })}</Txt>
        <View style={{ flex: 1, marginHorizontal: 14 }}>
          <ProgressBar pct={(answered / CHECKPOINT_ITEMS) * 100} height={10} color={t.c.gold} />
        </View>
        <Txt variant="bodyStrong" color={misses > 0 ? t.c.bad : t.c.ink3}>
          {`✖ ${misses}/${CHECKPOINT_MAX_MISSES}`}
        </Txt>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={{ alignItems: "center", gap: 10, marginTop: 40 }}>
            <ActivityIndicator color={t.c.accent} />
            <Txt variant="secondary" color={t.c.ink2}>{loadingMessageFor(round)}</Txt>
          </View>
        )}
        {limited && !loading && <LimitSheet belt={beltProgress(progress).belt} onUnlocked={loadExercise} />}
        {gated && !loading && <ActivationBanner />}
        {error && !loading && (
          <View style={{ gap: 12, marginTop: 20 }}>
            <Txt variant="bodyStrong" style={{ textAlign: "center" }}>{tr("err.exercise.title")}</Txt>
            <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center" }}>{error}</Txt>
            <Button label={tr("action.tryAgain")} variant="ghost" onPress={loadExercise} />
          </View>
        )}
        {checkError && !error && (
          <Txt variant="secondary" color={t.c.bad} style={{ textAlign: "center" }}>{checkError}</Txt>
        )}

        {exercise && !loading && (
          <ExerciseCard key={round} exercise={exercise} locked={phase === "feedback"} onChange={(v) => setResponse(v)} />
        )}

        {phase === "feedback" && result && (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, borderColor: verdictColor, borderWidth: 2 }}>
            <Sensei size={40} mood={result.correct ? "cheer" : "think"} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle" color={verdictColor}>
                {result.correct ? tr("ch.strike") : tr("ch.miss")}
              </Txt>
              {!result.correct && <Txt variant="mono" color={t.c.ink2}>{result.correct_answer}</Txt>}
            </View>
          </Card>
        )}
      </ScrollView>

      {phase === "solving" && exercise && !loading && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
          <Button label={checking ? tr("action.checking") : tr("action.check")} onPress={onCheck} disabled={response === null || checking} />
        </View>
      )}
    </View>
  );
}

function Centered({
  children,
  insets,
  onClose,
}: {
  children: React.ReactNode;
  insets: { top: number; bottom: number };
  onClose?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
            <Icon name="x" size={24} color={t.c.ink2} />
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={[styles.content, { alignItems: "center", gap: 16, paddingBottom: insets.bottom + 40, paddingTop: 24 }]}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, minHeight: 44 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
