import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import Icon, { type IconName } from "./Icon";
import Txt from "./Txt";

// Secondary training modes share one quiet, native-sized row; Daily Mix owns the filled action.
export default function ModeButton({ title, subtitle, icon, onPress }: {
  title: string; subtitle: string; icon: IconName; onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.row, {
        backgroundColor: pressed ? t.c.surface2 : t.c.surface,
        borderColor: t.c.line,
      }]}
    >
      <Icon name={icon} size={26} color={t.c.accent} />
      <View style={{ flex: 1, gap: 3 }}>
        <Txt variant="bodyStrong">{title}</Txt>
        <Txt variant="secondary" color={t.c.ink2}>{subtitle}</Txt>
      </View>
      <Icon name="chevron" size={20} color={t.c.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, minHeight: 80, borderWidth: 1, borderRadius: 12 },
});
