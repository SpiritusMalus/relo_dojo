import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useProgress } from "../store/progress";
import { levelToCefr, skillFor, TOPIC_PRIORS } from "../store/adaptive";
import { TOPIC_LABELS } from "../store/onboarding";

export default function TopicsScreen() {
  const router = useRouter();
  const { progress } = useProgress();
  const topics = Object.keys(TOPIC_PRIORS);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>Pick a topic to drill. Difficulty still adapts to you.</Text>
      {topics.map((t) => {
        const stat = progress.topics[t];
        const acc = stat && stat.attempts ? Math.round((stat.correct / stat.attempts) * 100) : null;
        return (
          <TouchableOpacity
            key={t}
            style={styles.row}
            onPress={() => router.push(`/practice?topic=${encodeURIComponent(t)}`)}
          >
            <View style={styles.rowLeft}>
              <Text style={styles.topicName}>{TOPIC_LABELS[t] ?? t}</Text>
              <Text style={styles.topicSub}>
                {levelToCefr(skillFor(progress, t))}
                {acc !== null ? ` · ${acc}% accuracy` : " · not started"}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        );
      })}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, gap: 10 },
  subtitle: { fontSize: 15, color: "#555", marginBottom: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#eaeaea",
    borderRadius: 12,
    padding: 16,
  },
  rowLeft: { flex: 1, gap: 3 },
  topicName: { fontSize: 16, fontWeight: "600", color: "#111" },
  topicSub: { fontSize: 13, color: "#0a7d28" },
  chevron: { fontSize: 24, color: "#bbb" },
});
