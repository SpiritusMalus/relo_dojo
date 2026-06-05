import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { analyzePain, type Exercise, type ResponseValue } from "../services/api";
import ExerciseCard from "../components/ExerciseCard";
import { useProgress, type Profile } from "../store/progress";
import { levelToCefr } from "../store/adaptive";
import {
  DAILY_MINUTES,
  DOMAINS,
  GOALS,
  SELF_LEVELS,
  TOPIC_LABELS,
  buildContext,
  minutesToGoal,
  seedSkillFromLevel,
  seedSkillFromProfile,
  selfLevelToLevel,
} from "../store/onboarding";
import { pickItem, type CalItem } from "../store/calibrationBank";
import { beltByCefr, useTheme } from "../theme/theme";
import Screen from "../components/ui/Screen";
import Card from "../components/ui/Card";
import Chip from "../components/ui/Chip";
import Button from "../components/ui/Button";
import Sensei from "../components/ui/Sensei";
import BeltKnot from "../components/ui/BeltKnot";
import Icon from "../components/ui/Icon";
import ProgressBar from "../components/ui/ProgressBar";
import Confetti from "../components/ui/Confetti";
import Txt from "../components/ui/Txt";

const GOAL_LABELS: Record<string, string> = Object.fromEntries(GOALS.map((g) => [g.id, g.label]));
const CALIBRATION_ITEMS = 10;
const LAST_STEP = 8;

function itemToExercise(item: CalItem): Exercise {
  return {
    type: "multiple-choice",
    topic: item.topic,
    level: "",
    text: item.text,
    prompt: "",
    options: item.options,
    tiles: [],
    tokens: [],
    left: [],
    right: [],
    blankOptions: [],
    token: null,
  };
}

// --- themed text input with focus accent ---
function Input({
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={{
        backgroundColor: t.c.surface,
        borderWidth: 2,
        borderColor: focused ? t.c.accent : t.c.line2,
        borderRadius: t.spacing.radiusSm,
        padding: 14,
        fontFamily: t.fonts.ui500,
        fontSize: 15,
        color: t.c.ink,
        minHeight: multiline ? 90 : 48,
        textAlignVertical: multiline ? "top" : "center",
      }}
      placeholder={placeholder}
      placeholderTextColor={t.c.ink3}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      multiline={multiline}
    />
  );
}

function StepView({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 14 }}>
      <Txt variant="screenTitle">{title}</Txt>
      {!!subtitle && (
        <Txt variant="body" color={t.c.ink2}>
          {subtitle}
        </Txt>
      )}
      <View style={{ gap: 10, marginTop: 4 }}>{children}</View>
    </View>
  );
}

// --- placement test: a short adaptive staircase over a vetted local item bank ---
function Calibration({
  profile,
  onDone,
}: {
  profile: Profile;
  onDone: (skill: Record<string, number>, level: number) => void;
}) {
  const t = useTheme();
  const levelRef = useRef<number>(selfLevelToLevel(profile.selfLevel));
  const usedRef = useRef<Set<string>>(new Set());
  const [item, setItem] = useState<CalItem | null>(null);
  const [count, setCount] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correct_answer: string } | null>(null);

  const finish = useCallback(
    () => onDone(seedSkillFromLevel(levelRef.current, profile.focusTopics ?? []), levelRef.current),
    [onDone, profile.focusTopics]
  );

  const load = useCallback(() => {
    setResponse(null);
    setResult(null);
    const next = pickItem(levelRef.current, usedRef.current);
    if (!next) {
      finish();
      return;
    }
    usedRef.current.add(next.id);
    setItem(next);
  }, [finish]);

  useEffect(() => {
    load();
  }, [load]);

  function check() {
    if (!item || response === null || result) return;
    const correct = response === item.answer;
    const step = count < 4 ? 0.8 : count < 7 ? 0.6 : 0.4;
    levelRef.current = Math.min(5, Math.max(0, levelRef.current + (correct ? step : -step)));
    setResult({ correct, correct_answer: item.answer });
  }

  function advance() {
    const done = count + 1;
    setCount(done);
    if (done >= CALIBRATION_ITEMS) finish();
    else load();
  }

  return (
    <View style={{ gap: 14 }}>
      <Txt variant="screenTitle">Quick level check</Txt>
      <Txt variant="body" color={t.c.ink2}>
        {`${Math.min(count + 1, CALIBRATION_ITEMS)} of ${CALIBRATION_ITEMS} · finding your level`}
      </Txt>
      <Pressable onPress={finish} hitSlop={8}>
        <Txt variant="secondary" color={t.c.ink3}>
          Skip the check
        </Txt>
      </Pressable>

      {item && (
        <View style={{ gap: 14, marginTop: 4 }}>
          <ExerciseCard key={item.id} exercise={itemToExercise(item)} locked={result !== null} onChange={(v) => setResponse(v)} />
          {result === null ? (
            <Button label="Check" onPress={check} disabled={response === null} />
          ) : (
            <>
              <Txt variant="cardTitle" color={result.correct ? t.c.accent : t.c.bad}>
                {result.correct ? "✓ Correct" : "✗ Not quite"}
              </Txt>
              {!result.correct && <Txt variant="mono">{result.correct_answer}</Txt>}
              <Button label={count + 1 >= CALIBRATION_ITEMS ? "See result" : "Next"} onPress={advance} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

// --- belt reveal summary ---
function Reveal({
  profile,
  estimatedLevel,
  onStart,
}: {
  profile: Profile;
  estimatedLevel: number;
  onStart: () => void;
}) {
  const t = useTheme();
  const belt = beltByCefr(levelToCefr(estimatedLevel));
  const scale = useRef(new Animated.Value(t.reduceMotion ? 1 : 0.6)).current;
  useEffect(() => {
    if (t.reduceMotion) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 120 }).start();
  }, [scale, t.reduceMotion]);

  const goalText = profile.goals.map((g) => GOAL_LABELS[g] ?? g).join(", ") || "—";
  const focusText = profile.focusTopics.map((x) => TOPIC_LABELS[x] ?? x).join(", ") || "none";
  const dailyGoal = minutesToGoal(profile.dailyMinutes);

  return (
    <View style={{ gap: 16, alignItems: "stretch" }}>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <BeltKnot belt={belt} size={120} />
        </Animated.View>
        <Txt variant="hero">{belt.name}</Txt>
        <Txt variant="body" color={t.c.ink2}>{`CEFR ${levelToCefr(estimatedLevel)} · keeps adjusting`}</Txt>
      </View>

      <Card>
        <Recap label="Difficulty" value={profile.selfLevel || levelToCefr(estimatedLevel)} />
        <Recap label="Hard topics" value={focusText} />
        <Recap label="Daily goal" value={dailyGoal ? `${profile.dailyMinutes} min (~${dailyGoal})` : "—"} />
        <Recap label="Goals" value={goalText} last />
      </Card>

      <Button label="Start practicing" onPress={onStart} />
    </View>
  );
}

function Recap({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const t = useTheme();
  return (
    <View style={[styles.recap, !last && { borderBottomWidth: 1, borderColor: t.c.line }]}>
      <Txt variant="secondary" color={t.c.ink3}>
        {label}
      </Txt>
      <Txt variant="bodyStrong" style={{ flex: 1, textAlign: "right" }}>
        {value}
      </Txt>
    </View>
  );
}

export default function OnboardingScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useProgress();
  const [step, setStep] = useState(0);
  const [goals, setGoals] = useState<string[]>([]);
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [painText, setPainText] = useState("");
  const [selfLevel, setSelfLevel] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState(0);
  const [domains, setDomains] = useState<string[]>([]);
  const [goalOther, setGoalOther] = useState("");
  const [domainOther, setDomainOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [calibratedSkill, setCalibratedSkill] = useState<Record<string, number>>({});
  const [estimatedLevel, setEstimatedLevel] = useState(1.5);

  const buildProfile = useCallback(
    (): Profile => ({ goals, focusTopics, selfLevel, dailyMinutes, domains, painText }),
    [goals, focusTopics, selfLevel, dailyMinutes, domains, painText]
  );

  const finish = useCallback(
    (skill: Record<string, number>) => completeOnboarding(buildProfile(), skill),
    [buildProfile, completeOnboarding]
  );
  const skip = useCallback(() => finish(seedSkillFromProfile(buildProfile())), [finish, buildProfile]);
  const next = () => setStep((s) => s + 1);

  function toggleFocus(topic: string) {
    setFocusTopics((p) => (p.includes(topic) ? p.filter((x) => x !== topic) : [...p, topic]));
  }
  function toggleGoal(id: string) {
    setGoals((p) => (p.includes(id) ? p.filter((g) => g !== id) : [...p, id]));
  }
  function toggleDomain(id: string) {
    setDomains((p) => (p.includes(id) ? p.filter((d) => d !== id) : [...p, id]));
  }
  function nextWithOther(other: string, setter: (fn: (p: string[]) => string[]) => void, clear: () => void) {
    const extra = other.trim();
    if (extra) setter((p) => Array.from(new Set([...p, extra])));
    clear();
    next();
  }
  async function submitPain() {
    if (!painText.trim()) return next();
    setBusy(true);
    try {
      const { topics } = await analyzePain(painText.trim());
      setFocusTopics((p) => Array.from(new Set([...p, ...topics])));
    } catch {
      // analysis optional
    } finally {
      setBusy(false);
      next();
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top + 8 }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />

      {/* Header: back + progress + skip */}
      <View style={styles.header}>
        <Pressable onPress={() => setStep((s) => Math.max(0, s - 1))} hitSlop={8} style={styles.hBtn} disabled={step === 0}>
          {step > 0 && <Icon name="back" size={24} color={t.c.ink2} />}
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <ProgressBar pct={(step / LAST_STEP) * 100} height={8} />
        </View>
        <Pressable onPress={skip} hitSlop={8} style={styles.hBtn} disabled={step >= LAST_STEP}>
          {step < LAST_STEP && (
            <Txt variant="bodyStrong" color={t.c.ink3}>
              Skip
            </Txt>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <View style={{ alignItems: "center", gap: 14, paddingTop: 24 }}>
            <Sensei size={110} mood="happy" bob />
            <Txt variant="hero" style={{ textAlign: "center" }}>
              Let's tune your dojo
            </Txt>
            <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
              A few quick questions, then a short warm-up to find your belt.
            </Txt>
            <Button label="Get started" onPress={next} style={{ marginTop: 8, alignSelf: "stretch" }} />
          </View>
        )}

        {step === 1 && (
          <StepView title="Why are you learning English?" subtitle="Pick any that apply.">
            {GOALS.map((g) => (
              <Chip key={g.id} label={g.label} selected={goals.includes(g.id)} onPress={() => toggleGoal(g.id)} />
            ))}
            <Input value={goalOther} onChangeText={setGoalOther} placeholder="Other reason (your own)…" />
            <Button label="Next" onPress={() => nextWithOther(goalOther, setGoals, () => setGoalOther(""))} disabled={goals.length === 0 && !goalOther.trim()} />
          </StepView>
        )}

        {step === 2 && (
          <StepView title="What feels hard right now?" subtitle="Pick any that apply.">
            {Object.keys(TOPIC_LABELS).map((x) => (
              <Chip key={x} label={TOPIC_LABELS[x]} selected={focusTopics.includes(x)} onPress={() => toggleFocus(x)} />
            ))}
            <Button label="Next" onPress={next} />
          </StepView>
        )}

        {step === 3 && (
          <StepView title="Tell me in your own words" subtitle="What trips you up? (optional)">
            <Input value={painText} onChangeText={setPainText} placeholder="e.g. I mix up in/on/at and if-sentences" multiline />
            <Button label={busy ? "Analyzing…" : "Next"} onPress={submitPain} disabled={busy} />
          </StepView>
        )}

        {step === 4 && (
          <StepView title="How would you rate your English?">
            {SELF_LEVELS.map((l) => (
              <Chip key={l.id} label={l.label} selected={selfLevel === l.id} onPress={() => setSelfLevel(l.id)} />
            ))}
            <Button label="Next" onPress={next} disabled={!selfLevel} />
          </StepView>
        )}

        {step === 5 && (
          <StepView title="How much time per day?">
            <View style={styles.wrap}>
              {DAILY_MINUTES.map((m) => (
                <Chip key={m} label={`${m} min`} selected={dailyMinutes === m} onPress={() => setDailyMinutes(m)} />
              ))}
            </View>
            <Button label="Next" onPress={next} disabled={!dailyMinutes} />
          </StepView>
        )}

        {step === 6 && (
          <StepView title="What's your area?" subtitle="Pick any — or add your own stack or interests.">
            <View style={styles.wrap}>
              {DOMAINS.map((d) => (
                <Chip key={d} label={d} selected={domains.includes(d)} onPress={() => toggleDomain(d)} />
              ))}
            </View>
            <Input value={domainOther} onChangeText={setDomainOther} placeholder="Other (e.g. game dev, ML, music)…" />
            <Button label="Next" onPress={() => nextWithOther(domainOther, setDomains, () => setDomainOther(""))} disabled={domains.length === 0 && !domainOther.trim()} />
          </StepView>
        )}

        {step === 7 && (
          <Calibration
            profile={buildProfile()}
            onDone={(skill, level) => {
              setCalibratedSkill(skill);
              setEstimatedLevel(level);
              next();
            }}
          />
        )}

        {step === 8 && <Reveal profile={buildProfile()} estimatedLevel={estimatedLevel} onStart={() => finish(calibratedSkill)} />}
      </ScrollView>

      {step === 8 && <Confetti />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, minHeight: 44 },
  hBtn: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  recap: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 10 },
});
