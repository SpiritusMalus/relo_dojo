import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../theme/theme";
import { useWallet } from "../../store/wallet";
import Txt from "./Txt";

// Koku (soft currency) badge for the TopBar — tap opens the shop (the balance IS the shop door).
// Koku = the historical rice measure a samurai was paid in — hence the rice emoji.
export default function CoinBadge() {
  const t = useTheme();
  const router = useRouter();
  const { coins } = useWallet();
  return (
    <Pressable
      onPress={() => router.push("/shop")}
      style={[styles.badge, { backgroundColor: t.c.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel={`Koku: ${coins}. Open the shop`}
      hitSlop={6}
    >
      <Txt variant="caption" color={t.c.gold}>{`🌾 ${coins}`}</Txt>
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
    minHeight: 32,
    justifyContent: "center",
  },
});
