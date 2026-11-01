import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../theme/theme";
import { useWallet } from "../../store/wallet";
import { useI18n } from "../../store/i18n";
import Txt from "./Txt";

// Koku (soft currency) badge for the TopBar — tap opens the shop (the balance IS the shop door).
export default function CoinBadge() {
  const t = useTheme();
  const router = useRouter();
  const { coins, ready } = useWallet();
  const { t: tr, lang } = useI18n();
  return (
    <Pressable
      onPress={() => router.push("/shop")}
      style={[styles.badge, { backgroundColor: t.c.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel={ready ? tr("wallet.balanceOpen", { n: coins }) : tr("wallet.balanceUnavailable")}
      hitSlop={6}
    >
      <Txt variant="caption" color={t.c.gold}>{`${ready ? coins : "—"} ${lang === "ru" ? "коку" : "koku"}`}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 48,
    justifyContent: "center",
  },
});
