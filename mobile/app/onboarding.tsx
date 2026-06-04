import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
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

const GOAL_LABELS: Record<string, string> = Object.fromEntries(GOALS.map((g) => [g.id, g.label]));

const CALIBRATION_ITEMS = 10;

// Item -> a multiple-choice Exercise object the existing ExerciseCard can render.
function itemToExercise(item: CalItem): Exercise {
  return {
    type: "multiple-choice",
    topic: item.topic,
    text: item.text,
    prompt: "",
    options: item.options,
    tiles: [],
    tokens: [],
    left: [],
    right: [],
    token: null,
  };
}

// --- small reusable pieces ---
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Primary({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, (disabled || loading) && styles.btnDisabled]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );
}

function Step({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <View style={styles.step}>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      <View style={styles.stepBody}>{children}</View>
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
  // Estimated level (moves up/down with answers), and which bank items we've used.
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
      finish(); // bank exhausted
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
    // Staircase: step shrinks as the estimate settles.
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
    <View style={styles.step}>
      <Text style={styles.title}>Quick level check</Text>
      <Text style={styles.subtitle}>
        {Math.min(count + 1, CALIBRATION_ITEMS)} of {CALIBRATION_ITEMS} · finding your level
      </Text>
      <TouchableOpacity onPress={finish}>
        <Text style={styles.skipInline}>Skip the check</Text>
      </TouchableOpacity>

      {item && (
        <View style={styles.stepBody}>
          <ExerciseCard
            key={item.id}
            exercise={itemToExercise(item)}
            locked={result !== null}
            onChange={(v) => setResponse(v)}
          />
          {result === null ? (
            <Primary label="Check" onPress={check} disabled={response === null} />
          ) : (
            <>
              <Text style={[styles.verdict, result.correct ? styles.ok : styles.bad]}>
                {result.correct ? "✓ Correct" : "✗ Not quite"}
              </Text>
              {!result.correct && (
                <Text style={styles.answerLine}>Answer: {result.correct_answer}</Text>
              )}
              <Primary label={count + 1 >= CALIBRATION_ITEMS ? "See result" : "Next"} onPress={advance} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function Summary({
  profile,
  skill,
  estimatedLevel,
  onStart,
}: {
  profile: Profile;
  skill: Record<string, number>;
  estimatedLevel: number;
  onStart: () => void;
}) {
  const goalText = profile.goals.map((g) => GOAL_LABELS[g] ?? g).join(", ") || "—";
  const focusText = profile.focusTopics.map((t) => TOPIC_LABELS[t] ?? t).join(", ") || "none";
  const domainText = profile.domains.filter((d) => d !== "other").join(", ") || "—";
  const dailyGoal = minutesToGoal(profile.dailyMinutes);

  return (
    <View style={styles.step}>
      <Text style={styles.title}>You're all set</Text>
      <Text style={styles.subtitle}>Here's your starting point — it keeps adjusting as you practice.</Text>

      {/* Estimated overall level */}
      <View style={styles.estimateBox}>
        <Text style={styles.estimateLabel}>Estimated level</Text>
        <Text style={styles.estimateCefr}>{levelToCefr(estimatedLevel)}</Text>
      </View>

      {/* Starting levels */}
      <View style={styles.stepBody}>
        {Object.keys(TOPIC_LABELS).map((t) => (
          <View key={t} style={styles.summaryRow}>
            <Text style={styles.summaryTopic}>{TOPIC_LABELS[t]}</Text>
            <Text style={styles.summaryCefr}>{levelToCefr(skill[t] ?? 1.5)}</Text>
          </View>
        ))}
      </View>

      {/* Your answers */}
      <Text style={styles.sectionTitle}>Your answers</Text>
      <Recap label="Goals" value={goalText} />
      <Recap label="Hard topics" value={focusText} />
      <Recap label="Level" value={profile.selfLevel || "—"} />
      <Recap label="Daily goal" value={dailyGoal ? `${profile.dailyMinutes} min (~${dailyGoal})` : "—"} />
      <Recap label="Area" value={domainText} />

      {/* What this changed */}
      <Text style={styles.sectionTitle}>What this changed</Text>
      <Text style={styles.explain}>• Starting difficulty set from your level.</Text>
      <Text style={styles.explain}>• Hard topics come up more often and start a bit easier.</Text>
      {!!buildContext(profile) && <Text style={styles.explain}>• Examples are drawn from your area & goals.</Text>}
      {dailyGoal > 0 && <Text style={styles.explain}>• Daily goal ≈ {dailyGoal} exercises (tracked on Progress).</Text>}

      <Primary label="Start practicing" onPress={onStart} />
    </View>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.recapRow}>
      <Text style={styles.recapLabel}>{label}</Text>
      <Text style={styles.recapValue}>{value}</Text>
    </View>
  );
}

export default function OnboardingScreen() {
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
    setFocusTopics((p) => (p.includes(topic) ? p.filter((t) => t !== topic) : [...p, topic]));
  }

  function toggleGoal(id: string) {
    setGoals((p) => (p.includes(id) ? p.filter((g) => g !== id) : [...p, id]));
  }

  function toggleDomain(id: string) {
    setDomains((p) => (p.includes(id) ? p.filter((d) => d !== id) : [...p, id]));
  }

  // Fold a free-text "Other" entry into the chosen list, then advance.
  function nextWithOther(
    other: string,
    setter: (fn: (p: string[]) => string[]) => void,
    clear: () => void
  ) {
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        {step >= 1 && step <= 7 ? (
          <TouchableOpacity onPress={() => setStep((s) => s - 1)}>
            <Text style={styles.skip}>← Back</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.brand}>Grammar Dojo</Text>
        )}
        {step < 7 && (
          <TouchableOpacity onPress={skip}>
            <Text style={styles.skip}>Skip</Text>
          </TouchableOpacity>
        )}
      </View>

      {step === 0 && (
        <Step title="Let's tune the app to you" subtitle="A few quick questions, then a short warm-up.">
          <Primary label="Get started" onPress={next} />
        </Step>
      )}

      {step === 1 && (
        <Step title="Why are you learning English?" subtitle="Pick any that apply.">
          {GOALS.map((g) => (
            <Chip key={g.id} label={g.label} active={goals.includes(g.id)} onPress={() => toggleGoal(g.id)} />
          ))}
          <TextInput
            style={styles.otherInput}
            placeholder="Other reason (your own)…"
            value={goalOther}
            onChangeText={setGoalOther}
          />
          <Primary
            label="Next"
            onPress={() => nextWithOther(goalOther, setGoals, () => setGoalOther(""))}
            disabled={goals.length === 0 && !goalOther.trim()}
          />
        </Step>
      )}

      {step === 2 && (
        <Step title="What feels hard right now?" subtitle="Pick any that apply.">
          {Object.keys(TOPIC_LABELS).map((t) => (
            <Chip key={t} label={TOPIC_LABELS[t]} active={focusTopics.includes(t)} onPress={() => toggleFocus(t)} />
          ))}
          <Primary label="Next" onPress={next} />
        </Step>
      )}

      {step === 3 && (
        <Step title="Tell me in your own words" subtitle="What trips you up? (optional)">
          <TextInput
            style={styles.input}
            placeholder="e.g. I mix up in/on/at and if-sentences"
            value={painText}
            onChangeText={setPainText}
            multiline
          />
          <Primary label="Next" onPress={submitPain} loading={busy} />
        </Step>
      )}

      {step === 4 && (
        <Step title="How would you rate your English?">
          {SELF_LEVELS.map((l) => (
            <Chip key={l.id} label={l.label} active={selfLevel === l.id} onPress={() => setSelfLevel(l.id)} />
          ))}
          <Primary label="Next" onPress={next} disabled={!selfLevel} />
        </Step>
      )}

      {step === 5 && (
        <Step title="How much time per day?">
          <View style={styles.rowWrap}>
            {DAILY_MINUTES.map((m) => (
              <Chip key={m} label={`${m} min`} active={dailyMinutes === m} onPress={() => setDailyMinutes(m)} />
            ))}
          </View>
          <Primary label="Next" onPress={next} disabled={!dailyMinutes} />
        </Step>
      )}

      {step === 6 && (
        <Step title="What's your area?" subtitle="Pick any — or add your own stack, hobbies, interests.">
          <View style={styles.rowWrap}>
            {DOMAINS.map((d) => (
              <Chip key={d} label={d} active={domains.includes(d)} onPress={() => toggleDomain(d)} />
            ))}
          </View>
          <TextInput
            style={styles.otherInput}
            placeholder="Other (e.g. game dev, ML, music, gaming)…"
            value={domainOther}
            onChangeText={setDomainOther}
          />
          <Primary
            label="Next"
            onPress={() => nextWithOther(domainOther, setDomains, () => setDomainOther(""))}
            disabled={domains.length === 0 && !domainOther.trim()}
          />
        </Step>
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

      {step === 8 && (
        <Summary
          profile={buildProfile()}
          skill={calibratedSkill}
          estimatedLevel={estimatedLevel}
          onStart={() => finish(calibratedSkill)}
        />
      )}

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 60, gap: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { fontSize: 18, fontWeight: "700", color: "#0a7d28" },
  skip: { fontSize: 15, color: "#888" },
  skipInline: { fontSize: 14, color: "#888", marginTop: 4 },
  step: { gap: 12 },
  stepBody: { gap: 10, marginTop: 6 },
  title: { fontSize: 23, fontWeight: "700", color: "#111" },
  subtitle: { fontSize: 15, color: "#555" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, paddingVertical: 13, paddingHorizontal: 14 },
  chipActive: { borderColor: "#0a7d28", backgroundColor: "#eaf7ee" },
  chipText: { fontSize: 15, color: "#111" },
  chipTextActive: { color: "#0a7d28", fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    minHeight: 90,
    textAlignVertical: "top",
  },
  otherInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  primaryBtn: { backgroundColor: "#0a7d28", borderRadius: 10, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  btnDisabled: { backgroundColor: "#9bbfa5" },
  verdict: { fontSize: 18, fontWeight: "700", marginTop: 6 },
  ok: { color: "#0a7d28" },
  bad: { color: "#c0392b" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderColor: "#eee" },
  summaryTopic: { fontSize: 15, color: "#111" },
  summaryCefr: { fontSize: 16, fontWeight: "700", color: "#0a7d28" },
  estimateBox: { backgroundColor: "#eaf7ee", borderRadius: 12, padding: 16, alignItems: "center", gap: 2 },
  estimateLabel: { fontSize: 13, color: "#0a7d28", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  estimateCefr: { fontSize: 30, fontWeight: "800", color: "#0a7d28" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#0a7d28", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14 },
  answerLine: { fontSize: 16, fontWeight: "600", color: "#111", marginTop: 4 },
  explain: { fontSize: 15, lineHeight: 21, color: "#444" },
  recapRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  recapLabel: { fontSize: 15, color: "#777" },
  recapValue: { flex: 1, fontSize: 15, color: "#111", textAlign: "right" },
});
