import { Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { beltByIndex, useTheme } from "../../theme/theme";
import { useWallet } from "../../store/wallet";
import BeltKnot from "./BeltKnot";

// Black Belt indicator for the TopBar — renders only while premium is active, so the perk is FELT,
// not just mechanically enforced (BACKLOG: premium indicator). Tap opens /premium (active state).
export default function PremiumBadge() {
  const t = useTheme();
  const router = useRouter();
  const { isPremium } = useWallet();
  if (!isPremium) return null;
  return (
    <Pressable
      onPress={() => router.push("/premium")}
      style={[styles.badge, { backgroundColor: t.c.surface2 }]}
      accessibilityRole="button"
      accessibilityLabel="Black Belt active. See your perks"
      hitSlop={6}
    >
      <BeltKnot belt={beltByIndex(5)} size={22} />
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
