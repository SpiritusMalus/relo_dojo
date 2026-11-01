import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../store/auth";
import { useI18n } from "../../store/i18n";
import { beltName } from "../../i18n/strings";
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
  const { token } = useAuth();
  const { t: tr, lang } = useI18n();
  const [sheet, setSheet] = useState(false);
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => setSheet(true)}
        accessibilityRole="button"
        accessibilityLabel={`${beltName(belt, lang)}, ${xp} XP`}
        style={styles.left}
        hitSlop={8}
      >
        <BeltKnot belt={belt} size={30} />
        <Txt variant="caption" color={t.c.ink2}>
          {tr("belt.open")}
        </Txt>
      </Pressable>

      <View style={styles.right}>
        <PremiumBadge />
        {/* Koku economy is account-only (server-authoritative). Hide the balance for guests. */}
        {!!token && <CoinBadge />}
        <View style={[styles.badge, { backgroundColor: t.c.fireSoft }]}>
          <Icon name="flame" size={16} color={t.c.fire} />
          <Txt variant="caption" color={t.c.fire}>{streak}</Txt>
        </View>
        <Pressable
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          accessibilityLabel={tr("common.settings")}
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
  left: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 48 },
  right: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  gear: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 32,
    justifyContent: "center",
    gap: 4,
  },
});
