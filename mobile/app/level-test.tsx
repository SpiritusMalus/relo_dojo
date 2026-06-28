// Level Test — the full, retakeable English placement (store/levelTest.ts). Adaptive and OFFLINE:
// items come from the curated bank and are graded locally against the known answer (no LLM). The
// estimate stops once it settles; the result re-seeds the skill estimate and raises the worn belt,
// and — unlike the onboarding warm-up (capped at B2) — it can place at C1.
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ResponseValue } from "../services/api";
import { itemToExercise, type CalItem } from "../store/calibrationBank";
import {
  isDone,
  levelTestResult,
  nextItem,
  recordAnswer,
  startLevelTest,
  LT_MAX_ITEMS,
  type LevelTestResult,
  type LevelTestState,
} from "../store/levelTest";
import { isoDay } from "../store/adaptive";
import { beltProgress } from "../store/dojo";
import { seedSkillFromLevel } from "../store/onboarding";
import { useProgress } from "../store/progress";
import { useI18n } from "../store/i18n";
import { beltByCefr, useTheme } from "../theme/theme";
import ExerciseCard from "../components/ExerciseCard";
import BeltKnot from "../components/ui/BeltKnot";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Confetti from "../components/ui/Confetti";
import Icon from "../components/ui/Icon";
import ProgressBar from "../components/ui/ProgressBar";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

type Phase = "intro" | "solving" | "feedback" | "done";

export default function LevelTestScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { progress, applyLevelTest } = useProgress();
  const { t: tr } = useI18n();

  // Seed from the learner's current overall skill so a returning user converges fast (the adaptive
  // selection corrects from anywhere — this just starts nearer).
  const seed = beltProgress(progress).overallSkill;
  const stRef = useRef<LevelTestState>(startLevelTest(seed));

  const [phase, setPhase] = useState<Phase>("intro");
  const [item, setItem] = useState<CalItem | null>(null);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [result, setResult] = useState<{ correct: boolean; answer: string } | null>(null);
  const [count, setCount] = useState(0); // answered so far (for the progress header)
  const [done, setDone] = useState<LevelTestResult | null>(null);

  const exercise = useMemo(() => (item ? itemToExercise(item) : null), [item]);

  const loadNext = useCallback(() => {
    const next = nextItem(stRef.current);
    if (!next) {
      setDone(levelTestResult(stRef.current));
      setPhase("done");
      return;
    }
    setItem(next);
    setResponse(null);
    setResult(null);
    setPhase("solving");
  }, []);

  const start = useCallback(() => {
    stRef.current = startLevelTest(seed);
    setCount(0);
    loadNext();
  }, [seed, loadNext]);

  const onCheck = useCallback(() => {
    if (!item || response === null || phase !== "solving") return;
    const correct = response === item.answer;
    stRef.current = recordAnswer(stRef.current, item, correct);
    setCount(stRef.current.answered);
    setResult({ correct, answer: item.answer });
    setPhase("feedback");
  }, [item, response, phase]);

  const onNext = useCallback(() => {
    if (isDone(stRef.current)) {
      setDone(levelTestResult(stRef.current));
      setPhase("done");
    } else {
      loadNext();
    }
  }, [loadNext]);

  const onSave = useCallback(() => {
    if (!done) return;
    const skill = seedSkillFromLevel(done.level, progress.profile?.focusTopics ?? []);
    applyLevelTest(skill, done.beltIdx, isoDay(new Date()));
    router.back();
  }, [done, progress.profile, applyLevelTest, router]);

  if (phase === "intro") {
    return (
      <Centered insets={insets} onClose={() => router.back()}>
        <Sensei size={96} mood="think" bob />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("lt.title")}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("lt.intro")}</Txt>
        <Button label={tr("lt.start")} onPress={start} style={{ alignSelf: "stretch" }} />
      </Centered>
    );
  }

  if (phase === "done" && done) {
    const belt = beltByCefr(done.cefr);
    return (
      <Centered insets={insets}>
        <Sensei size={112} mood="cheer" bob />
        <BeltKnot belt={belt} size={96} />
        <Txt variant="hero" style={{ textAlign: "center" }}>{tr("lt.resultTitle", { cefr: done.cefr })}</Txt>
        <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>{tr("lt.resultSub", { n: count })}</Txt>
        <Button label={tr("lt.save")} onPress={onSave} style={{ alignSelf: "stretch" }} />
        <Confetti />
      </Centered>
    );
  }

  // --- solving / feedback ---
  const verdictColor = result?.correct ? t.c.accent : t.c.bad;
  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
          <Icon name="x" size={24} color={t.c.ink2} />
        </Pressable>
        <Txt variant="bodyStrong">{tr("lt.question", { n: count + (phase === "feedback" ? 0 : 1) })}</Txt>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <ProgressBar pct={(count / LT_MAX_ITEMS) * 100} height={10} color={t.c.accent} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {exercise && (
          <ExerciseCard key={item!.id} exercise={exercise} locked={phase === "feedback"} onChange={(v) => setResponse(v)} />
        )}

        {phase === "feedback" && result && (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, borderColor: verdictColor, borderWidth: 2 }}>
            <Sensei size={40} mood={result.correct ? "cheer" : "think"} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle" color={verdictColor}>
                {result.correct ? tr("ob.correct") : tr("ob.notQuite")}
              </Txt>
              {!result.correct && <Txt variant="mono" color={t.c.ink2}>{result.answer}</Txt>}
            </View>
          </Card>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: t.c.screen, borderTopColor: t.c.line }]}>
        {phase === "solving" ? (
          <Button label={tr("action.check")} onPress={onCheck} disabled={response === null} />
        ) : (
          <Button label={tr("action.continue")} onPress={onNext} />
        )}
      </View>
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
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, gap: 8 },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
});
