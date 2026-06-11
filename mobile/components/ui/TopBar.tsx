import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useTheme, type Belt } from "../../theme/theme";
import BeltKnot from "./BeltKnot";
import BeltPickerSheet from "./BeltPickerSheet";
import CoinBadge from "./CoinBadge";
import PremiumBadge from "./PremiumBadge";
import Icon from "./Icon";
import Txt from "./Txt";

// Top bar shared by tabbed screens: belt knot + CEFR (tap → belt sheet); koku, streak, XP badges
// and the gear (→ /settings).
export default function TopBar({ belt, streak, xp }: { belt: Belt; streak: number; xp: number }) {
  const t = useTheme();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => setSheet(true)}
        accessibilityRole="button"
        accessibilityLabel={`Belt: ${belt.name}, CEFR ${belt.cefr}`}
        style={styles.left}
        hitSlop={8}
      >
        <BeltKnot belt={belt} size={30} />
        <Txt variant="caption" color={t.c.ink2}>
          {belt.cefr}
        </Txt>
      </Pressable>

      <View style={styles.right}>
        <PremiumBadge />
        <CoinBadge />
        <View style={[styles.badge, { backgroundColor: t.c.fireSoft }]}>
          <Txt variant="caption" color={t.c.fire}>{`🔥 ${streak}`}</Txt>
        </View>
        <View style={[styles.badge, { backgroundColor: t.c.surface2 }]}>
          <Txt variant="caption" color={t.c.gold}>{`✦ ${xp}`}</Txt>
        </View>
        <Pressable
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={6}
          style={styles.gear}
        >
          <Icon name="gear" size={20} color={t.c.ink3} />
        </Pressable>
      </View>

      <BeltPickerSheet visible={sheet} current={belt} onClose={() => setSheet(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  left: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44 },
  right: { flexDirection: "row", alignItems: "center", gap: 8 },
  gear: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
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
