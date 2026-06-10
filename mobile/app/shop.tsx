import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { EXTRA_PACK_SIZE, PRICE_EXTRA_PACK, useWallet } from "../store/wallet";
import type { SpendItem } from "../services/api";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Icon from "../components/ui/Icon";
import Txt from "../components/ui/Txt";

// Display mirror of backend prices (core/config.py); the server charges the real amount.
const PRICE_OMAMORI = 150;

// Лавка (the dojo shop, branch 5). Koku sinks: the soft currency must have somewhere to go,
// otherwise earning it stops feeling valuable. Spending happens server-side via /wallet/spend.
export default function ShopScreen() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { coins, freezes, leftToday, isPremium, spend } = useWallet();
  const [busy, setBusy] = useState<SpendItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(item: SpendItem) {
    if (busy) return;
    setBusy(item);
    setError(null);
    try {
      await spend(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.c.screen, paddingTop: insets.top + 8 }}>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back} accessibilityLabel="Back">
          <Icon name="back" size={24} color={t.c.ink2} />
        </Pressable>
        <Txt variant="screenTitle">{tr("shop.title")}</Txt>
        <View style={{ flex: 1 }} />
        <Txt variant="bodyStrong" color={t.c.gold}>{`🌾 ${coins}`}</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: t.spacing.pad, paddingBottom: insets.bottom + 24, gap: t.spacing.gap }}
        showsVerticalScrollIndicator={false}
      >
        {/* Omamori — streak insurance. Sold BEFORE it's needed: prevention is an easier sell. */}
        <Card>
          <View style={styles.row}>
            <Txt style={{ fontSize: 36 }}>🧿</Txt>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{tr("shop.omamori")}</Txt>
              <Txt variant="secondary" color={t.c.ink2}>
                {tr("shop.omamoriSub", { n: freezes })}
              </Txt>
            </View>
          </View>
          <Button
            label={busy === "omamori" ? tr("shop.buying") : tr("shop.buy", { price: PRICE_OMAMORI })}
            onPress={() => buy("omamori")}
            disabled={coins < PRICE_OMAMORI || busy !== null}
          />
        </Card>

        {/* Extra pack — only meaningful on the free tier. */}
        {!isPremium && (
          <Card>
            <View style={styles.row}>
              <Txt style={{ fontSize: 36 }}>🥋</Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{tr("shop.extraPack", { n: EXTRA_PACK_SIZE })}</Txt>
                <Txt variant="secondary" color={t.c.ink2}>
                  {leftToday !== null ? tr("shop.extraPackSub", { n: leftToday }) : ""}
                </Txt>
              </View>
            </View>
            <Button
              label={busy === "extra_pack" ? tr("shop.buying") : tr("shop.buy", { price: PRICE_EXTRA_PACK })}
              onPress={() => buy("extra_pack")}
              disabled={coins < PRICE_EXTRA_PACK || busy !== null}
            />
          </Card>
        )}

        {/* Black Belt upsell — the shop is browsed with intent, so the subscription belongs here. */}
        {!isPremium && (
          <Card>
            <View style={styles.row}>
              <Txt style={{ fontSize: 36 }}>🖤</Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="bodyStrong">{tr("premium.title")}</Txt>
                <Txt variant="secondary" color={t.c.ink2}>
                  {tr("premium.teaser")}
                </Txt>
              </View>
            </View>
            <Button label={tr("premium.cta")} variant="ghost" onPress={() => router.push("/premium")} />
          </Card>
        )}

        {error && (
          <Txt variant="caption" color={t.c.bad} style={{ textAlign: "center" }}>
            {error}
          </Txt>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
});
