import { useCallback, useEffect, useState } from "react";
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
  checkAnswer,
  getExercise,
  type CheckResult,
  type Exercise,
} from "./services/api";

export default function App() {
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(false); // fetching a new exercise
  const [checking, setChecking] = useState(false); // checking the answer
  const [error, setError] = useState<string | null>(null);

  const loadExercise = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setAnswer("");
    setExercise(null);
    try {
      setExercise(await getExercise());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load exercise");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadExercise();
  }, [loadExercise]);

  async function onCheck() {
    if (!exercise || !answer.trim() || checking) return;
    setChecking(true);
    setError(null);
    try {
      setResult(await checkAnswer(exercise, answer.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check answer");
    } finally {
      setChecking(false);
    }
  }

  const isChoice = (exercise?.options?.length ?? 0) > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Grammar Dojo</Text>

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
          <Text style={styles.topic}>{exercise.topic}</Text>
          <Text style={styles.exerciseText}>{exercise.text}</Text>

          {/* Answer input: options for choose-the-word, free text otherwise */}
          {isChoice ? (
            <View style={styles.options}>
              {exercise.options.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.option, answer === opt && styles.optionSelected]}
                  onPress={() => !result && setAnswer(opt)}
                  disabled={!!result}
                >
                  <Text style={[styles.optionText, answer === opt && styles.optionTextSelected]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <TextInput
              style={styles.input}
              placeholder="Your answer"
              value={answer}
              onChangeText={setAnswer}
              editable={!result}
              autoCapitalize="none"
            />
          )}

          {/* Check button (hidden once we have a result) */}
          {!result && (
            <TouchableOpacity
              style={[styles.primaryBtn, (!answer.trim() || checking) && styles.btnDisabled]}
              onPress={onCheck}
              disabled={!answer.trim() || checking}
            >
              {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Check</Text>}
            </TouchableOpacity>
          )}

          {/* Result */}
          {result && (
            <View style={styles.result}>
              <Text style={[styles.verdict, result.correct ? styles.ok : styles.bad]}>
                {result.correct ? "✓ Correct" : "✗ Not quite"}
              </Text>
              {!result.correct && (
                <Text style={styles.answerLine}>Answer: {result.correct_answer}</Text>
              )}
              <Text style={styles.explanation}>{result.explanation}</Text>
              {!!result.tip && <Text style={styles.tip}>💡 {result.tip}</Text>}
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
  exerciseText: { fontSize: 19, lineHeight: 26, color: "#111" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  options: { gap: 10 },
  option: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14 },
  optionSelected: { borderColor: "#0a7d28", backgroundColor: "#eaf7ee" },
  optionText: { fontSize: 16, color: "#111" },
  optionTextSelected: { color: "#0a7d28", fontWeight: "600" },
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
  explanation: { fontSize: 16, lineHeight: 22, color: "#333" },
  tip: { fontSize: 15, color: "#555", fontStyle: "italic" },
  errorBox: { gap: 8, marginTop: 20 },
  errorText: { fontSize: 15, color: "#c0392b", textAlign: "center" },
});
