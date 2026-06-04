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
import {
  analyzePain,
  checkInteractive,
  getExercise,
  type Exercise,
  type ResponseValue,
} from "../services/api";
import ExerciseCard from "../components/ExerciseCard";
import { DEFAULT_PROGRESS, useProgress, type Profile, type Progress } from "../store/progress";
import { levelToCefr, selectNext, updateSkill } from "../store/adaptive";
import {
  DAILY_MINUTES,
  DOMAINS,
  GOALS,
  SELF_LEVELS,
  TOPIC_LABELS,
  seedSkillFromProfile,
} from "../store/onboarding";

const CALIBRATION_ITEMS = 6;

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

// --- soft calibration: a few warm-up exercises seeded from the survey ---
function Calibration({
  profile,
  onDone,
}: {
  profile: Profile;
  onDone: (skill: Record<string, number>) => void;
}) {
  const draft = useRef<Progress>({
    ...DEFAULT_PROGRESS,
    profile,
    skill: seedSkillFromProfile(profile),
  });
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [round, setRound] = useState(0);
  const [count, setCount] = useState(0);
  const [response, setResponse] = useState<ResponseValue | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setResponse(null);
    setCorrect(null);
    setExercise(null);
    try {
      const { topic, cefr, type } = selectNext(draft.current);
      const ex = await getExercise({ topic, level: cefr, type, context: profile.domain });
      setExercise(ex);
      setRound((r) => r + 1);
    } catch {
      // network/model issue → don't block onboarding, finish with what we have
      onDone(draft.current.skill);
    } finally {
      setLoading(false);
    }
  }, [profile.domain, onDone]);

  useEffect(() => {
    load();
  }, [load]);

  async function check() {
    if (!exercise || response === null || checking || !exercise.token) return;
    setChecking(true);
    try {
      const res = await checkInteractive(exercise.token, response);
      // Update the draft skill (no XP/streak — this is setup, not real practice).
      const topic = exercise.topic;
      const prev = draft.current.topics[topic] ?? { attempts: 0, correct: 0 };
      draft.current = {
        ...draft.current,
        skill: updateSkill(draft.current, topic, res.correct),
        topics: {
          ...draft.current.topics,
          [topic]: { attempts: prev.attempts + 1, correct: prev.correct + (res.correct ? 1 : 0) },
        },
      };
      setCorrect(res.correct);
    } catch {
      setCorrect(false);
    } finally {
      setChecking(false);
    }
  }

  function advance() {
    const done = count + 1;
    setCount(done);
    if (done >= CALIBRATION_ITEMS) onDone(draft.current.skill);
    else load();
  }

  return (
    <View style={styles.step}>
      <Text style={styles.title}>Quick warm-up</Text>
      <Text style={styles.subtitle}>
        {count + 1} of {CALIBRATION_ITEMS} · just to tune your level
      </Text>
      <TouchableOpacity onPress={() => onDone(draft.current.skill)}>
        <Text style={styles.skipInline}>Skip warm-up</Text>
      </TouchableOpacity>

      {loading && <ActivityIndicator style={{ marginTop: 30 }} />}

      {exercise && !loading && (
        <View style={styles.stepBody}>
          <ExerciseCard
            key={round}
            exercise={exercise}
            locked={correct !== null}
            onChange={(v) => setResponse(v)}
          />
          {correct === null ? (
            <Primary
              label="Check"
              onPress={check}
              disabled={response === null}
              loading={checking}
            />
          ) : (
            <>
              <Text style={[styles.verdict, correct ? styles.ok : styles.bad]}>
                {correct ? "✓ Nice" : "✗ Noted"}
              </Text>
              <Primary label={count + 1 >= CALIBRATION_ITEMS ? "See result" : "Next"} onPress={advance} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function Summary({ skill, onStart }: { skill: Record<string, number>; onStart: () => void }) {
  return (
    <View style={styles.step}>
      <Text style={styles.title}>You're all set</Text>
      <Text style={styles.subtitle}>Starting levels — they'll keep adjusting as you practice.</Text>
      <View style={styles.stepBody}>
        {Object.keys(TOPIC_LABELS).map((t) => (
          <View key={t} style={styles.summaryRow}>
            <Text style={styles.summaryTopic}>{TOPIC_LABELS[t]}</Text>
            <Text style={styles.summaryCefr}>{levelToCefr(skill[t] ?? 1.5)}</Text>
          </View>
        ))}
        <Primary label="Start practicing" onPress={onStart} />
      </View>
    </View>
  );
}

export default function OnboardingScreen() {
  const { completeOnboarding } = useProgress();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("");
  const [focusTopics, setFocusTopics] = useState<string[]>([]);
  const [painText, setPainText] = useState("");
  const [selfLevel, setSelfLevel] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState(0);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [calibratedSkill, setCalibratedSkill] = useState<Record<string, number>>({});

  const buildProfile = useCallback(
    (): Profile => ({ goal, focusTopics, selfLevel, dailyMinutes, domain, painText }),
    [goal, focusTopics, selfLevel, dailyMinutes, domain, painText]
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
        <Text style={styles.brand}>Grammar Dojo</Text>
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
        <Step title="Why are you learning English?">
          {GOALS.map((g) => (
            <Chip key={g.id} label={g.label} active={goal === g.id} onPress={() => setGoal(g.id)} />
          ))}
          <Primary label="Next" onPress={next} disabled={!goal} />
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
        <Step title="What's your area?" subtitle="So examples feel familiar.">
          <View style={styles.rowWrap}>
            {DOMAINS.map((d) => (
              <Chip key={d} label={d} active={domain === d} onPress={() => setDomain(d)} />
            ))}
          </View>
          <Primary label="Next" onPress={next} disabled={!domain} />
        </Step>
      )}

      {step === 7 && (
        <Calibration
          profile={buildProfile()}
          onDone={(skill) => {
            setCalibratedSkill(skill);
            next();
          }}
        />
      )}

      {step === 8 && <Summary skill={calibratedSkill} onStart={() => finish(calibratedSkill)} />}

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
  primaryBtn: { backgroundColor: "#0a7d28", borderRadius: 10, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  primaryText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  btnDisabled: { backgroundColor: "#9bbfa5" },
  verdict: { fontSize: 18, fontWeight: "700", marginTop: 6 },
  ok: { color: "#0a7d28" },
  bad: { color: "#c0392b" },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderColor: "#eee" },
  summaryTopic: { fontSize: 15, color: "#111" },
  summaryCefr: { fontSize: 16, fontWeight: "700", color: "#0a7d28" },
});
