import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import Icon from "./Icon";
import Txt from "./Txt";

// Full-width chunky accent button: lightning tile + "Daily mix" / subtitle + chevron.
export default function DailyMixButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Daily mix — adaptive practice across all topics"
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: t.c.accent,
          borderRadius: t.spacing.radius,
          borderBottomWidth: pressed ? 1 : 4,
          borderBottomColor: t.c.accentPress,
        },
        // Avoid `transform: undefined` (crashes New Arch); add it only while pressed.
        pressed ? { transform: [{ translateY: 3 }] } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
        <Icon name="bolt" size={24} color={t.c.accentInk} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle" color={t.c.accentInk}>
          Daily mix
        </Txt>
        <Txt variant="secondary" color="rgba(255,255,255,0.85)">
          Adaptive — across all your topics
        </Txt>
      </View>
      <Icon name="chevron" size={22} color={t.c.accentInk} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 64 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
