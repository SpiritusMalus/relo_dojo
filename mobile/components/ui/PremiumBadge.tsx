import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../theme/theme";
import { useWallet } from "../../store/wallet";
import { useI18n } from "../../store/i18n";
import Icon from "./Icon";

// Subscription access has its own mark; belts remain earned learning achievements.
export default function PremiumBadge() {
  const t = useTheme();
  const router = useRouter();
  const { isPremium } = useWallet();
  const { t: tr } = useI18n();
  if (!isPremium) return null;
  return (
    <Pressable
      onPress={() => router.push("/premium")}
      style={[styles.badge, { backgroundColor: t.c.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel={tr("premium.active")}
      hitSlop={6}
    >
      <Icon name="plus" size={22} color={t.c.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
    minHeight: 48,
    minWidth: 48,
    justifyContent: "center",
  },
});
