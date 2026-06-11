import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Icon from "./Icon";
import Txt from "./Txt";

// Full-width chunky button for "Review my text" (Stage 3 differentiator): the learner pastes their
// own real email/message and gets a graded breakdown. Accent sibling of StoryButton on Home.
export default function TextReviewButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Review my text — paste your own writing for feedback"
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: t.c.accent,
          borderRadius: t.spacing.radius,
          borderBottomWidth: pressed ? 1 : 4,
          borderBottomColor: t.c.line2,
        },
        pressed ? { transform: [{ translateY: 3 }] } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
        <Icon name="target" size={24} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle" color="#FFFFFF">
          {tr("btn.textReview.title")}
        </Txt>
        <Txt variant="secondary" color="rgba(255,255,255,0.85)">
          {tr("btn.textReview.sub")}
        </Txt>
      </View>
      <Icon name="chevron" size={22} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 64 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
