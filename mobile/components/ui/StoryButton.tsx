import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import Icon from "./Icon";
import Txt from "./Txt";

// Full-width chunky button for a themed mini-story. Warm (fire) sibling to DailyMixButton so the two
// pair visually on the Home tab while staying clearly distinct.
export default function StoryButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Mini-story — a themed set of linked exercises"
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: t.c.fire,
          borderRadius: t.spacing.radius,
          borderBottomWidth: pressed ? 1 : 4,
          borderBottomColor: t.c.gold,
        },
        // Avoid `transform: undefined` (crashes New Arch); add it only while pressed.
        pressed ? { transform: [{ translateY: 3 }] } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
        <Icon name="star" size={24} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle" color="#FFFFFF">
          Mini-story
        </Txt>
        <Txt variant="secondary" color="rgba(255,255,255,0.85)">
          A short themed set with a twist
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
