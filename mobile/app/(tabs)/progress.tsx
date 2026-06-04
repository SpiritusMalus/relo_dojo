import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  ACHIEVEMENTS,
  levelFor,
  totalAttempts,
  useProgress,
  XP_PER_LEVEL,
  xpInLevel,
  type Progress,
} from "../../store/progress";
import { useAuth } from "../../store/auth";
import { levelToCefr, skillFor } from "../../store/adaptive";

// Known topics in priority order (matches backend grammar.py TOPICS). Unknown topics, if any
// ever appear, are appended so nothing is silently dropped.
const TOPIC_ORDER = [
  "prepositions",
  "conditionals",
  "verb sequence (tense agreement)",
  "vocabulary",
];

function orderedTopics(p: Progress): string[] {
  const known = TOPIC_ORDER.filter((t) => p.topics[t]);
  const extra = Object.keys(p.topics).filter((t) => !TOPIC_ORDER.includes(t));
  return [...known, ...extra];
}

/** Topic with the lowest accuracy among those with enough attempts to be meaningful. */
function weakestTopic(p: Progress): string | null {
  let worst: string | null = null;
  let worstAcc = Infinity;
  for (const [topic, stat] of Object.entries(p.topics)) {
    if (stat.attempts < 3) continue;
    const acc = stat.correct / stat.attempts;
    if (acc < worstAcc) {
      worstAcc = acc;
      worst = topic;
    }
  }
  return worst;
}

export default function ProgressScreen() {
  const { progress, ready } = useProgress();
  const { user, logout } = useAuth();

  const level = levelFor(progress.xp);
  const inLevel = xpInLevel(progress.xp);
  const barPct = Math.min(100, (inLevel / XP_PER_LEVEL) * 100);
  const topics = orderedTopics(progress);
  const weakest = weakestTopic(progress);
  const hasData = totalAttempts(progress) > 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Your Progress</Text>

      {!ready ? null : !hasData ? (
        <Text style={styles.empty}>
          No exercises yet. Head to the Practice tab and answer a few — your stats will show up here.
        </Text>
      ) : (
        <>
          {/* Level + XP */}
          <View style={styles.section}>
            <View style={styles.rowBetween}>
              <Text style={styles.level}>Level {level}</Text>
              <Text style={styles.xpTotal}>{progress.xp} XP</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${barPct}%` }]} />
            </View>
            <Text style={styles.barLabel}>
              {inLevel} / {XP_PER_LEVEL} XP to level {level + 1}
            </Text>
          </View>

          {/* Streaks */}
          <View style={styles.streakRow}>
            <View style={styles.streakCard}>
              <Text style={styles.streakValue}>🔥 {progress.dailyStreak}</Text>
              <Text style={styles.streakLabel}>day streak</Text>
            </View>
            <View style={styles.streakCard}>
              <Text style={styles.streakValue}>⚡ {progress.bestCorrectRun}</Text>
              <Text style={styles.streakLabel}>best run</Text>
            </View>
          </View>

          {/* Per-topic stats */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>By topic</Text>
            {topics.map((topic) => {
              const stat = progress.topics[topic];
              const acc = stat.attempts ? Math.round((stat.correct / stat.attempts) * 100) : 0;
              const isWeak = topic === weakest;
              return (
                <View key={topic} style={styles.topicRow}>
                  <Text style={[styles.topicName, isWeak && styles.topicWeak]} numberOfLines={1}>
                    {topic}
                    {isWeak ? "  · focus here" : ""}
                  </Text>
                  <Text style={styles.topicStat}>
                    {levelToCefr(skillFor(progress, topic))} · {acc}% · {stat.correct}/{stat.attempts}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Achievements */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Achievements</Text>
            {ACHIEVEMENTS.map((a) => {
              const unlocked = progress.achievements.includes(a.id);
              return (
                <Text key={a.id} style={[styles.achievement, !unlocked && styles.achievementLocked]}>
                  {unlocked ? "🏅" : "🔒"} {a.label}
                </Text>
              );
            })}
          </View>
        </>
      )}

      {/* Account */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        {!!user && <Text style={styles.accountEmail}>{user.email}</Text>}
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 60, gap: 20 },
  title: { fontSize: 24, fontWeight: "700", textAlign: "center" },
  empty: { fontSize: 16, lineHeight: 23, color: "#555", textAlign: "center", marginTop: 24 },

  section: { gap: 10 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#0a7d28", textTransform: "uppercase", letterSpacing: 0.5 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },

  level: { fontSize: 22, fontWeight: "700", color: "#111" },
  xpTotal: { fontSize: 16, fontWeight: "600", color: "#0a7d28" },
  barTrack: { height: 12, borderRadius: 6, backgroundColor: "#eaf7ee", overflow: "hidden" },
  barFill: { height: 12, borderRadius: 6, backgroundColor: "#0a7d28" },
  barLabel: { fontSize: 13, color: "#555" },

  streakRow: { flexDirection: "row", gap: 12 },
  streakCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#eaf7ee",
    backgroundColor: "#f5fbf7",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    gap: 4,
  },
  streakValue: { fontSize: 22, fontWeight: "700", color: "#111" },
  streakLabel: { fontSize: 13, color: "#555" },

  topicRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  topicName: { flex: 1, fontSize: 15, color: "#111" },
  topicWeak: { color: "#c0392b", fontWeight: "600" },
  topicStat: { fontSize: 15, fontWeight: "600", color: "#333" },

  achievement: { fontSize: 15, color: "#111" },
  achievementLocked: { color: "#aaa" },

  accountEmail: { fontSize: 15, color: "#333" },
  logoutBtn: { borderWidth: 1, borderColor: "#c0392b", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 2 },
  logoutText: { color: "#c0392b", fontWeight: "600", fontSize: 16 },
});
