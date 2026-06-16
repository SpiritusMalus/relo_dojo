import { useEffect } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trackPaywallView } from "../services/analytics";
import { billingEnabled, buildCheckoutUrl } from "../services/billing";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { useAuth } from "../store/auth";
import { useProgress } from "../store/progress";
import { useWallet } from "../store/wallet";
import { beltProgress } from "../store/dojo";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Icon from "../components/ui/Icon";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

// "Чёрный пояс" — the Black Belt subscription screen (branch 5). Reached from the squeeze points:
// the daily-limit sheet, the shop, and the session summary. The CTA is a "coming soon" placeholder
// until a payment provider lands (Phase 7/8); the server-side is_premium flag already gates
// everything, so flipping it is the only integration left.
export default function PremiumScreen() {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { progress } = useProgress();
  const { isPremium } = useWallet();
  const belt = beltProgress(progress).belt;

  useEffect(() => {
    trackPaywallView({ kind: "premium", belt: belt.id });
  }, [belt.id]);

  // Every perk listed here is already enforced server-side — the pitch contains no fiction.
  const perks = [
    { icon: "♾️", key: "premium.perkUnlimited" },
    { icon: "🌾", key: "premium.perkKoku" },
    { icon: "📜", key: "premium.perkScrolls" },
  ] as const;

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top + 8 }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Icon name="back" size={24} color={t.c.ink2} />
        </Pressable>
        <Txt variant="screenTitle">{tr("premium.title")}</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: t.spacing.pad, paddingBottom: insets.bottom + 24, gap: t.spacing.gap }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: "center", gap: 8 }}>
          <Sensei belt={belt} size={96} mood="cheer" bob />
          <Txt variant="hero" style={{ textAlign: "center" }}>
            {tr("premium.hero")}
          </Txt>
          <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center" }}>
            {tr("premium.heroSub")}
          </Txt>
        </View>

        <Card>
          <View style={{ gap: 14 }}>
            {perks.map((p) => (
              <View key={p.key} style={styles.perk}>
                <Txt style={{ fontSize: 24 }}>{p.icon}</Txt>
                <Txt variant="body" style={{ flex: 1 }}>
                  {tr(p.key)}
                </Txt>
              </View>
            ))}
          </View>
        </Card>

        {isPremium ? (
          <Txt variant="bodyStrong" color={t.c.gold} style={{ textAlign: "center" }}>
            {tr("premium.active")}
          </Txt>
        ) : billingEnabled() ? (
          <>
            <Button
              label={tr("premium.ctaBuy")}
              onPress={() => Linking.openURL(buildCheckoutUrl(token, lang))}
            />
            <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("premium.ctaNote")}
            </Txt>
          </>
        ) : (
          <>
            <Button label={tr("premium.ctaSoon")} disabled />
            <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("premium.soonNote")}
            </Txt>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  perk: { flexDirection: "row", alignItems: "center", gap: 12 },
});
