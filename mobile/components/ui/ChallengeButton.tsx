import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Icon from "./Icon";
import Txt from "./Txt";

// Full-width chunky button for the timed Daily Challenge. Gold with dark ink, so it reads as a third
// distinct mode next to DailyMixButton (green) and StoryButton (orange) on the Home tab.
const INK = "#3A2E08"; // dark amber ink for contrast on gold
const EDGE = "#B9831C";

export default function ChallengeButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Daily Challenge — a timed run with scored combos"
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: t.c.gold,
          borderRadius: t.spacing.radius,
          borderBottomWidth: pressed ? 1 : 4,
          borderBottomColor: EDGE,
        },
        pressed ? { transform: [{ translateY: 3 }] } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: "rgba(0,0,0,0.12)" }]}>
        <Icon name="flame" size={24} color={INK} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle" color={INK}>
          {tr("btn.challenge.title")}
        </Txt>
        <Txt variant="secondary" color={INK} style={{ opacity: 0.8 }}>
          {tr("btn.challenge.sub")}
        </Txt>
      </View>
      <Icon name="chevron" size={22} color={INK} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 64 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
