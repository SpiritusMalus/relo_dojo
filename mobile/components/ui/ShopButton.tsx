import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Icon from "./Icon";
import Txt from "./Txt";

// Full-width entry to the Lavka (shop). The CoinBadge in the TopBar stays as the quick door, but a
// tappable balance alone is poor discoverability — this names the place and says what koku buy.
export default function ShopButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr("btn.shop.title")}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: t.c.surface,
          borderRadius: t.spacing.radius,
          borderWidth: 1.5,
          borderColor: t.c.gold,
          borderBottomWidth: pressed ? 1.5 : 4,
        },
        pressed ? { transform: [{ translateY: 3 }] } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: t.c.surface2 }]}>
        <Txt style={{ fontSize: 24 }}>🌾</Txt>
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle">{tr("btn.shop.title")}</Txt>
        <Txt variant="secondary" color={t.c.ink3}>
          {tr("btn.shop.sub")}
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
