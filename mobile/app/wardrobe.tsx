// Wardrobe (engagement v2) — the koku desire sink. Dress the Sensei mascot, which appears on every
// screen, so a purchase is seen every day. Live try-on: tapping a skin previews it on the big Sensei
// instantly (desire spike) without committing; Buy debits koku server-side, Wear equips it.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trackPaywallView } from "../services/analytics";
import { useTheme } from "../theme/theme";
import { useI18n } from "../store/i18n";
import { useWallet } from "../store/wallet";
import { useProgress } from "../store/progress";
import { useCosmetics } from "../store/cosmeticsStore";
import { beltProgress } from "../store/dojo";
import { catalogForSlot, isOwned, buyCheck, type CosmeticDef } from "../store/cosmetics";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Icon from "../components/ui/Icon";
import Sensei from "../components/ui/Sensei";
import Txt from "../components/ui/Txt";

export default function WardrobeScreen() {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { coins, refresh: refreshWallet } = useWallet();
  const { progress } = useProgress();
  const { owned, equipped, buy, equip } = useCosmetics();
  const belt = beltProgress(progress).belt;

  // Try-on: which skin the big preview shows (defaults to the equipped one).
  const [preview, setPreview] = useState<string>(equipped.sensei ?? "sensei_classic");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackPaywallView({ kind: "shop", belt: belt.id });
  }, [belt.id]);

  // Keep the preview in sync if the equipped skin changes elsewhere and nothing is being tried on.
  useEffect(() => {
    setPreview((p) => (p ? p : equipped.sensei ?? "sensei_classic"));
  }, [equipped.sensei]);

  const skins = catalogForSlot("sensei");
  const previewDef = skins.find((s) => s.id === preview);
  const name = (d: CosmeticDef) => (lang === "ru" ? d.name.ru : d.name.en);
  const blurb = (d: CosmeticDef) => (lang === "ru" ? d.blurb.ru : d.blurb.en);

  async function onBuy(id: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await buy(id);
      await refreshWallet(); // koku was debited server-side
      await equip(id); // wear it immediately — the reward of buying is seeing it on
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setBusy(null);
    }
  }

  async function onEquip(id: string) {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await equip(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
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
        <Txt variant="screenTitle">{tr("ward.title")}</Txt>
        <View style={{ flex: 1 }} />
        <Txt variant="bodyStrong" color={t.c.gold}>{`🌾 ${coins}`}</Txt>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: t.spacing.pad, paddingBottom: insets.bottom + 24, gap: t.spacing.gap }}
        showsVerticalScrollIndicator={false}
      >
        {/* Live try-on stage. */}
        <Card>
          <View style={{ alignItems: "center", gap: 8, paddingVertical: 10 }}>
            <Sensei belt={belt} size={132} mood="happy" bob visual={previewDef?.visual} />
            <Txt variant="bodyStrong">{previewDef ? name(previewDef) : ""}</Txt>
            <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center" }}>
              {previewDef ? blurb(previewDef) : tr("ward.tagline")}
            </Txt>
          </View>
        </Card>

        {skins.map((s) => {
          const ownedIt = isOwned(owned, s.id);
          const worn = equipped.sensei === s.id;
          const check = buyCheck(coins, owned, s.id);
          return (
            <Pressable key={s.id} onPress={() => setPreview(s.id)}>
              <Card>
                <View style={styles.row}>
                  <View style={{ width: 56, alignItems: "center" }}>
                    <Sensei belt={belt} size={52} mood="happy" visual={s.visual} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="bodyStrong">{name(s)}</Txt>
                    <Txt variant="secondary" color={t.c.ink2}>{blurb(s)}</Txt>
                  </View>
                  {preview === s.id && (
                    <Txt variant="caption" color={t.c.ink3}>{tr("ward.tryOn")}</Txt>
                  )}
                </View>

                {worn ? (
                  <Button label={tr("ward.equipped")} variant="ghost" disabled onPress={() => {}} />
                ) : ownedIt ? (
                  <Button
                    label={busy === s.id ? tr("ward.equipping") : tr("ward.equip")}
                    onPress={() => onEquip(s.id)}
                    disabled={busy !== null}
                  />
                ) : (
                  <>
                    <Button
                      label={busy === s.id ? tr("ward.buying") : tr("ward.buy", { price: s.price })}
                      onPress={() => onBuy(s.id)}
                      disabled={!check.ok || busy !== null}
                    />
                    {check.reason === "too_poor" && (
                      <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center", marginTop: 4 }}>
                        {tr("ward.notEnough", { coins })}
                      </Txt>
                    )}
                  </>
                )}
              </Card>
            </Pressable>
          );
        })}

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
