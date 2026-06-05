import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useProgress } from "../../store/progress";
import { topicRows } from "../../store/dojo";
import { useTheme } from "../../theme/theme";
import BeltKnot from "./BeltKnot";
import DailyMixButton from "./DailyMixButton";
import ProgressBar from "./ProgressBar";
import Icon from "./Icon";
import Txt from "./Txt";

// Daily-mix button + the full list of grammar topic cards. Shared by the /topics route and the
// Train tab. Tapping a topic opens Practice filtered to it.
export default function TopicsBody() {
  const t = useTheme();
  const router = useRouter();
  const { progress } = useProgress();
  const rows = topicRows(progress);

  const goPractice = (topic?: string) =>
    router.push(topic ? { pathname: "/practice", params: { topic } } : "/practice");

  return (
    <>
      <DailyMixButton onPress={() => goPractice()} />
      <Txt variant="label" style={{ marginTop: 4 }}>
        All grammar topics
      </Txt>
      {rows.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => goPractice(r.id)}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: t.c.surface, borderColor: t.c.line, opacity: pressed ? 0.85 : 1, ...t.shadows.sm },
          ]}
        >
          <BeltKnot belt={r.belt} size={34} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.titleRow}>
              <Txt variant="cardTitle">{r.label}</Txt>
              <View style={[styles.codeChip, { backgroundColor: t.c.surface3, borderColor: t.c.line }]}>
                <Txt variant="mono" color={t.c.ink2} style={{ fontSize: 12 }}>
                  {r.hint}
                </Txt>
              </View>
            </View>
            <ProgressBar pct={r.acc} height={6} color={r.weak ? t.c.bad : t.c.accent} />
          </View>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Txt variant="caption" color={t.c.ink3}>
              {r.cefr}
            </Txt>
            <Txt variant="bodyStrong" color={r.weak ? t.c.bad : t.c.ink}>{`${r.acc}%`}</Txt>
          </View>
        </Pressable>
      ))}
      <View style={{ height: 4 }} />
      <View style={styles.hintRow}>
        <Icon name="target" size={16} color={t.c.ink3} />
        <Txt variant="secondary" color={t.c.ink3}>
          Difficulty still adapts to you.
        </Txt>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  codeChip: { borderWidth: 1, borderRadius: 8, paddingVertical: 2, paddingHorizontal: 7 },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" },
});
