import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Icon from "./Icon";
import Txt from "./Txt";

// Full-width chunky button for reviewing missed items. Rendered on Home only when there are mistakes
// to fix; `count` drives the subtitle. Neutral surface tone so it sits apart from the practice modes.
export default function ReviewButton({ count, onPress }: { count: number; onPress: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr("btn.review.title")}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: t.c.surface,
          borderRadius: t.spacing.radius,
          borderWidth: 1.5,
          borderColor: t.c.bad,
          borderBottomWidth: pressed ? 1.5 : 4,
        },
        pressed ? { transform: [{ translateY: 3 }] } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: t.c.badSoft }]}>
        <Icon name="target" size={24} color={t.c.bad} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle">{tr("btn.review.title")}</Txt>
        <Txt variant="secondary" color={t.c.ink3}>
          {tr("btn.review.sub", { n: count })}
        </Txt>
      </View>
      <Icon name="chevron" size={22} color={t.c.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 64 },
  tile: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
