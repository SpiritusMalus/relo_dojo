import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "../../theme/theme";
import { useI18n } from "../../store/i18n";
import type { ReviewPrompt } from "../../store/reviewHook";
import Sensei from "./Sensei";
import Button from "./Button";
import Txt from "./Txt";

// Prominent Home surface for "Review my text" (the killer free taste). The prompt rotates weekly
// (store/reviewHook.ts), so there's a fresh, job-relevant reason to paste this week's real message.
// Dismissable for the week (✕) → falls back to the compact TextReviewButton on Home. Open to anon,
// so the "FREE" badge is literally true.
export default function ReviewHookCard({
  prompt,
  onPress,
  onDismiss,
}: {
  prompt: ReviewPrompt;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const promptLabel = tr(`revhook.p.${prompt}`);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.c.surface, borderColor: t.c.accent, borderRadius: t.spacing.radius },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={tr("revhook.dismiss")}
        style={styles.dismiss}
      >
        <Txt variant="body" color={t.c.ink3}>
          ✕
        </Txt>
      </Pressable>

      <View style={styles.row}>
        <Sensei size={48} mood="happy" />
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Txt variant="cardTitle">{tr("revhook.title")}</Txt>
            <View style={[styles.pill, { backgroundColor: t.c.accent }]}>
              <Txt variant="caption" color="#FFFFFF">
                {tr("revhook.free")}
              </Txt>
            </View>
          </View>
          <Txt variant="secondary" color={t.c.ink2} style={{ marginTop: 2 }}>
            {tr("revhook.sub", { prompt: promptLabel })}
          </Txt>
        </View>
      </View>

      <Button label={tr("revhook.cta")} onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, padding: 16, gap: 12 },
  dismiss: { position: "absolute", top: 8, right: 8, width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingRight: 24 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
});
