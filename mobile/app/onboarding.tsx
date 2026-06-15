import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  DEFAULT_SPHERE,
  DEFAULT_TONE,
  GOALS,
  SELF_LEVELS,
  TONES,
  SPHERES,
  SOFTWARE_SPHERE,
  SOFTWARE_ROLES,
  TOPIC_LABELS,
  buildContext,
  minutesToGoal,
  seedSkillFromLevel,
  seedSkillFromProfile,
  selfLevelToLevel,
} from "../store/onboarding";
import { pickItem, type CalItem } from "../store/calibrationBank";
import { useI18n } from "../store/i18n";
import { RU_GOAL_LABELS, RU_SELF_LABELS, RU_TONE_LABELS, RU_TOPIC_LABELS } from "../i18n/strings";
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
const LAST_STEP = 9;

// Fisher-Yates: never mutate the source bank, and don't leak the answer's position
// (bank items list the correct answer first).
function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function itemToExercise(item: CalItem): Exercise {
  return {
    type: "multiple-choice",
    topic: item.topic,
    level: "",
    text: item.text,
    prompt: "",
    options: shuffled(item.options),
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
      accessibilityLabel={placeholder}
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
  const { t: tr } = useI18n();
  const levelRef = useRef<number>(selfLevelToLevel(profile.selfLevel));
  const usedRef = useRef<Set<string>>(new Set());
  const [item, setItem] = useState<CalItem | null>(null);
  const [count, setCount] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correct_answer: string } | null>(null);
  // Shuffle the options ONCE per item — not on every render, or tapping a choice (which re-renders)
  // would reshuffle the list and make the options jump around / drop the selection.
  const exercise = useMemo(() => (item ? itemToExercise(item) : null), [item]);

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
      <Txt variant="screenTitle">{tr("ob.calTitle")}</Txt>
      <Txt variant="body" color={t.c.ink2}>
        {tr("ob.calProgress", { n: Math.min(count + 1, CALIBRATION_ITEMS), total: CALIBRATION_ITEMS })}
      </Txt>
      <Pressable onPress={finish} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr("ob.calSkip")}>
        <Txt variant="secondary" color={t.c.ink3}>
          {tr("ob.calSkip")}
        </Txt>
      </Pressable>

      {item && exercise && (
        <View style={{ gap: 14, marginTop: 4 }}>
          <ExerciseCard key={item.id} exercise={exercise} locked={result !== null} onChange={(v) => setResponse(v)} />
          {result === null ? (
            <Button label={tr("action.check")} onPress={check} disabled={response === null} />
          ) : (
            <>
              <Txt variant="cardTitle" color={result.correct ? t.c.accent : t.c.bad}>
                {result.correct ? tr("ob.correct") : tr("ob.notQuite")}
              </Txt>
              {!result.correct && <Txt variant="mono">{result.correct_answer}</Txt>}
              <Button label={count + 1 >= CALIBRATION_ITEMS ? tr("ob.seeResult") : tr("ob.next")} onPress={advance} />
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
  const { t: tr, lang } = useI18n();
  const belt = beltByCefr(levelToCefr(estimatedLevel));
  const scale = useRef(new Animated.Value(t.reduceMotion ? 1 : 0.6)).current;
  useEffect(() => {
    if (t.reduceMotion) return;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 120 }).start();
  }, [scale, t.reduceMotion]);

  const goalLabel = (g: string) => (lang === "ru" ? RU_GOAL_LABELS[g] ?? GOAL_LABELS[g] ?? g : GOAL_LABELS[g] ?? g);
  const topicLabel = (x: string) => (lang === "ru" ? RU_TOPIC_LABELS[x] ?? TOPIC_LABELS[x] ?? x : TOPIC_LABELS[x] ?? x);
  const goalText = profile.goals.map(goalLabel).join(", ") || "—";
  const focusText = profile.focusTopics.map(topicLabel).join(", ") || tr("ob.none");
  const dailyGoal = minutesToGoal(profile.dailyMinutes);

  return (
    <View style={{ gap: 16, alignItems: "stretch" }}>
      <View style={{ alignItems: "center", gap: 6 }}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <BeltKnot belt={belt} size={120} />
        </Animated.View>
        <Txt variant="hero">{belt.name}</Txt>
        <Txt variant="body" color={t.c.ink2}>{tr("ob.keepsAdjusting", { cefr: levelToCefr(estimatedLevel) })}</Txt>
      </View>

      <Card>
        <Recap label={tr("ob.recapDifficulty")} value={profile.selfLevel || levelToCefr(estimatedLevel)} />
        <Recap label={tr("ob.recapHardTopics")} value={focusText} />
        <Recap label={tr("ob.recapDailyGoal")} value={dailyGoal ? tr("ob.minutes", { n: profile.dailyMinutes }) + ` (~${dailyGoal})` : "—"} />
        <Recap label={tr("ob.recapGoals")} value={goalText} last />
      </Card>

      <Button label={tr("ob.startPracticing")} onPress={onStart} />
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
  const { t: tr, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useProgress();
  const [step, setStep] = useState(0);
  const [goals, setGoals] = useState<string[]>([]);
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [painText, setPainText] = useState("");
  const [selfLevel, setSelfLevel] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState(0);
  // Pre-seeded to the IT-relocation niche default; the user can still pick any other sphere.
  const [sphere, setSphere] = useState(DEFAULT_SPHERE);
  const [domains, setDomains] = useState<string[]>([]);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const [goalOther, setGoalOther] = useState("");
  const [domainOther, setDomainOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [calibratedSkill, setCalibratedSkill] = useState<Record<string, number>>({});
  const [estimatedLevel, setEstimatedLevel] = useState(1.5);

  const buildProfile = useCallback(
    (): Profile => ({ goals, focusTopics, selfLevel, dailyMinutes, sphere, domains, painText, tone }),
    [goals, focusTopics, selfLevel, dailyMinutes, sphere, domains, painText, tone]
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
        <Pressable onPress={() => setStep((s) => Math.max(0, s - 1))} hitSlop={8} style={styles.hBtn} disabled={step === 0} accessibilityRole="button" accessibilityLabel="Back" accessibilityState={{ disabled: step === 0 }}>
          {step > 0 && <Icon name="back" size={24} color={t.c.ink2} />}
        </Pressable>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <ProgressBar pct={(step / LAST_STEP) * 100} height={8} />
        </View>
        <Pressable onPress={skip} hitSlop={8} style={styles.hBtn} disabled={step >= LAST_STEP} accessibilityRole="button" accessibilityLabel={tr("ob.skip")} accessibilityState={{ disabled: step >= LAST_STEP }}>
          {step < LAST_STEP && (
            <Txt variant="bodyStrong" color={t.c.ink3}>
              {tr("ob.skip")}
            </Txt>
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        {step === 0 && (
          <View style={{ alignItems: "center", gap: 14, paddingTop: 24 }}>
            <Sensei size={110} mood="happy" bob />
            <Txt variant="hero" style={{ textAlign: "center" }}>
              {tr("ob.welcomeTitle")}
            </Txt>
            <Txt variant="body" color={t.c.ink2} style={{ textAlign: "center" }}>
              {tr("ob.welcomeSub")}
            </Txt>
            <Button label={tr("ob.getStarted")} onPress={next} style={{ marginTop: 8, alignSelf: "stretch" }} />
          </View>
        )}

        {step === 1 && (
          <StepView title={tr("ob.goalsTitle")} subtitle={tr("ob.pickAny")}>
            {GOALS.map((g) => (
              <Chip key={g.id} label={lang === "ru" ? RU_GOAL_LABELS[g.id] ?? g.label : g.label} selected={goals.includes(g.id)} onPress={() => toggleGoal(g.id)} />
            ))}
            <Input value={goalOther} onChangeText={setGoalOther} placeholder={tr("ob.goalOther")} />
            <Button label={tr("ob.next")} onPress={() => nextWithOther(goalOther, setGoals, () => setGoalOther(""))} disabled={goals.length === 0 && !goalOther.trim()} />
          </StepView>
        )}

        {step === 2 && (
          <StepView title={tr("ob.hardTitle")} subtitle={tr("ob.pickAny")}>
            {Object.keys(TOPIC_LABELS).map((x) => (
              <Chip key={x} label={lang === "ru" ? RU_TOPIC_LABELS[x] ?? TOPIC_LABELS[x] : TOPIC_LABELS[x]} selected={focusTopics.includes(x)} onPress={() => toggleFocus(x)} />
            ))}
            <Button label={tr("ob.next")} onPress={next} />
          </StepView>
        )}

        {step === 3 && (
          <StepView title={tr("ob.ownWordsTitle")} subtitle={tr("ob.ownWordsSub")}>
            <Input value={painText} onChangeText={setPainText} placeholder={tr("ob.painPlaceholder")} multiline />
            <Button label={busy ? tr("ob.analyzing") : tr("ob.next")} onPress={submitPain} disabled={busy} />
          </StepView>
        )}

        {step === 4 && (
          <StepView title={tr("ob.rateTitle")}>
            {SELF_LEVELS.map((l) => (
              <Chip key={l.id} label={lang === "ru" ? RU_SELF_LABELS[l.id] ?? l.label : l.label} selected={selfLevel === l.id} onPress={() => setSelfLevel(l.id)} />
            ))}
            <Button label={tr("ob.next")} onPress={next} disabled={!selfLevel} />
          </StepView>
        )}

        {step === 5 && (
          <StepView title={tr("ob.toneTitle")} subtitle={tr("ob.toneSub")}>
            {TONES.map((x) => (
              <Chip
                key={x.id}
                label={lang === "ru" ? RU_TONE_LABELS[x.id] ?? x.label : x.label}
                selected={tone === x.id}
                onPress={() => setTone(x.id)}
              />
            ))}
            <Button label={tr("ob.next")} onPress={next} />
          </StepView>
        )}

        {step === 6 && (
          <StepView title={tr("ob.timeTitle")}>
            <View style={styles.wrap}>
              {DAILY_MINUTES.map((m) => (
                <Chip key={m} label={tr("ob.minutes", { n: m })} selected={dailyMinutes === m} onPress={() => setDailyMinutes(m)} />
              ))}
            </View>
            <Button label={tr("ob.next")} onPress={next} disabled={!dailyMinutes} />
          </StepView>
        )}

        {step === 7 && (
          <StepView title={tr("ob.areaTitle")} subtitle={tr("ob.areaSub")}>
            <View style={styles.wrap}>
              {SPHERES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  selected={sphere === s}
                  onPress={() => {
                    setSphere(s);
                    if (s !== SOFTWARE_SPHERE) setDomains([]); // drop stale software sub-roles
                  }}
                />
              ))}
            </View>
            {sphere === SOFTWARE_SPHERE && (
              <View style={styles.wrap}>
                {SOFTWARE_ROLES.map((d) => (
                  <Chip key={d} label={d} selected={domains.includes(d)} onPress={() => toggleDomain(d)} />
                ))}
              </View>
            )}
            <Input value={domainOther} onChangeText={setDomainOther} placeholder={tr("ob.domainOther")} />
            <Button
              label={tr("ob.next")}
              onPress={() => nextWithOther(domainOther, setDomains, () => setDomainOther(""))}
              disabled={!sphere && !domainOther.trim()}
            />
          </StepView>
        )}

        {step === 8 && (
          <Calibration
            profile={buildProfile()}
            onDone={(skill, level) => {
              setCalibratedSkill(skill);
              setEstimatedLevel(level);
              next();
            }}
          />
        )}

        {step === 9 && <Reveal profile={buildProfile()} estimatedLevel={estimatedLevel} onStart={() => finish(calibratedSkill)} />}
      </ScrollView>

      {step === 9 && <Confetti />}
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
