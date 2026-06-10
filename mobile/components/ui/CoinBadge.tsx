import { StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useWallet } from "../../store/wallet";
import Txt from "./Txt";

// Koku (soft currency) badge for the TopBar. Mirrors the streak/XP badge styling.
// Koku = the historical rice measure a samurai was paid in — hence the rice emoji.
export default function CoinBadge() {
  const t = useTheme();
  const { coins } = useWallet();
  return (
    <View
      style={[styles.badge, { backgroundColor: t.c.surface2 }]}
      accessibilityLabel={`Koku: ${coins}`}
    >
      <Txt variant="caption" color={t.c.gold}>{`🌾 ${coins}`}</Txt>
    </View>
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
