import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import Txt from "./Txt";
import Icon from "./Icon";

// "Recommended for you" — surfaces the learner's shakiest topic as a one-tap practice CTA. Restores
// the designer's Focus-coach idea (reference/dojo-home.jsx → HomeFocus): the most personalized daily
// action, on Home. Pure presentational — Home computes the weak topic (store/greeting.ts weakestTopic)
// + accuracy and routes the tap to /practice?topic=…. No backend involved.
export default function CoachCard({
  topicLabel,
  accPct,
  onPress,
}: {
  topicLabel: string;
  accPct: number;
  onPress: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr("home.coachCta", { topic: topicLabel })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: t.c.surface, borderColor: t.c.accent, borderRadius: t.spacing.radius },
        pressed ? { transform: [{ translateY: 2 }] } : null,
      ]}
    >
      <View style={[styles.tile, { backgroundColor: t.c.accentSoft }]}>
        <Icon name="target" size={22} color={t.c.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="label" color={t.c.ink3}>
          {tr("home.coachLabel")}
        </Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          <Txt variant="cardTitle" style={{ flexShrink: 1 }}>
            {topicLabel}
          </Txt>
          <View style={{ backgroundColor: t.c.badSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Txt variant="caption" color={t.c.bad}>
              {tr("home.coachAcc", { pct: accPct })}
            </Txt>
          </View>
        </View>
        <Txt variant="secondary" color={t.c.ink2} style={{ marginTop: 2 }}>
          {tr("home.coachSub")}
        </Txt>
      </View>
      <Icon name="chevron" size={20} color={t.c.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderWidth: 2 },
  tile: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
});
