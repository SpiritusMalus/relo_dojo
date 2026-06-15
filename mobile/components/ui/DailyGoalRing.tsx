import { StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Ring from "./Ring";
import Txt from "./Txt";

// Daily-goal ring on Home — restores the designer's "close your ring today" idea (reference/
// dojo-home.jsx → HomeRing). Pure: Home passes today's finished count + the goal derived from the
// chosen minutes-per-day (store/onboarding.ts minutesToGoal). Works for everyone, incl. guests.
export default function DailyGoalRing({ done, target }: { done: number; target: number }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const pct = target > 0 ? (done / target) * 100 : 0;
  const shown = Math.min(done, target);
  return (
    <View style={[styles.card, { backgroundColor: t.c.surface, borderColor: t.c.line, borderRadius: t.spacing.radius }]}>
      <Ring pct={pct} size={72} stroke={9} color={t.c.accent} track={t.c.surface3}>
        <Txt variant="cardTitle">{shown}</Txt>
        <Txt variant="caption" color={t.c.ink3}>
          /{target}
        </Txt>
      </Ring>
      <View style={{ flex: 1 }}>
        <Txt variant="cardTitle">{tr("home.goalToday")}</Txt>
        <Txt variant="secondary" color={t.c.ink2} style={{ marginTop: 2 }}>
          {done >= target ? tr("home.goalDone") : tr("home.goalSub", { done, target })}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderWidth: 1 },
});
