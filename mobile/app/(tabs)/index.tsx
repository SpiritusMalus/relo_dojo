import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useProgress } from "../../store/progress";
import { levelFor } from "../../store/progress";
import { minutesToGoal } from "../../store/onboarding";

export default function HomeScreen() {
  const router = useRouter();
  const { progress } = useProgress();

  const level = levelFor(progress.xp);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const target = minutesToGoal(progress.profile?.dailyMinutes ?? 0);
  const done = progress.todayDate === today ? progress.todayCount : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Grammar Dojo</Text>

      {/* Quick status */}
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>Level {level}</Text>
        {target > 0 && (
          <Text style={styles.statusText}>
            Today {Math.min(done, target)}/{target}
          </Text>
        )}
      </View>

      {/* Daily practice (adaptive) */}
      <TouchableOpacity style={styles.cardPrimary} onPress={() => router.push("/practice")}>
        <Text style={styles.cardPrimaryTitle}>Daily practice</Text>
        <Text style={styles.cardPrimarySub}>Adaptive — we pick what you need next</Text>
      </TouchableOpacity>

      {/* Choose a topic */}
      <TouchableOpacity style={styles.card} onPress={() => router.push("/topics")}>
        <Text style={styles.cardTitle}>Choose a topic</Text>
        <Text style={styles.cardSub}>Drill a specific grammar topic</Text>
      </TouchableOpacity>

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 60, gap: 16 },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center" },
  statusRow: { flexDirection: "row", justifyContent: "center", gap: 18 },
  statusText: { fontSize: 15, color: "#0a7d28", fontWeight: "600" },
  cardPrimary: { backgroundColor: "#0a7d28", borderRadius: 14, padding: 20, gap: 4, marginTop: 8 },
  cardPrimaryTitle: { fontSize: 20, fontWeight: "700", color: "#fff" },
  cardPrimarySub: { fontSize: 14, color: "#dff3e6" },
  card: { borderWidth: 1, borderColor: "#0a7d28", borderRadius: 14, padding: 20, gap: 4 },
  cardTitle: { fontSize: 20, fontWeight: "700", color: "#0a7d28" },
  cardSub: { fontSize: 14, color: "#555" },
});
