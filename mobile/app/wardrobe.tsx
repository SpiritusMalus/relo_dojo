// Wardrobe (engagement v2) — the koku desire sink. Dress the dojo (Sensei mascot + belt-knot),
// which appear on every screen, so a purchase is seen every day. Live try-on: tapping an item
// previews it instantly (desire spike) without committing; Buy debits koku server-side, Wear equips.
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
import { catalogForSlot, isOwned, buyCheck, SLOTS, type CosmeticDef, type Slot } from "../store/cosmetics";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Icon from "../components/ui/Icon";
import Sensei from "../components/ui/Sensei";
import BeltKnot from "../components/ui/BeltKnot";
import Txt from "../components/ui/Txt";
import type { Belt } from "../theme/theme";

const SLOT_TITLE: Record<Slot, { en: string; ru: string }> = {
  sensei: { en: "Sensei", ru: "Сэнсэй" },
  knot: { en: "Belt knot", ru: "Узел пояса" },
};

const SEASON_LABEL: Record<string, { en: string; ru: string }> = {
  spring: { en: "spring", ru: "весной" },
  summer: { en: "summer", ru: "летом" },
  autumn: { en: "autumn", ru: "осенью" },
  winter: { en: "winter", ru: "зимой" },
};

function seasonLabel(season: string, lang: string): string {
  const s = SEASON_LABEL[season];
  return s ? (lang === "ru" ? s.ru : s.en) : season;
}

export default function WardrobeScreen() {
  const t = useTheme();
  const { t: tr, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { coins, refresh: refreshWallet } = useWallet();
  const { progress } = useProgress();
  const { owned, equipped, buy, equip } = useCosmetics();
  const belt = beltProgress(progress).belt;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackPaywallView({ kind: "shop", belt: belt.id });
  }, [belt.id]);

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
        {SLOTS.map((slot) => (
          <SlotSection
            key={slot}
            slot={slot}
            belt={belt}
            lang={lang}
            coins={coins}
            owned={owned}
            equippedId={equipped[slot]}
            busy={busy}
            tr={tr}
            inkSub={t.c.ink2}
            inkFaint={t.c.ink3}
            onBuy={onBuy}
            onEquip={onEquip}
          />
        ))}

        {error && (
          <Txt variant="caption" color={t.c.bad} style={{ textAlign: "center" }}>
            {error}
          </Txt>
        )}
      </ScrollView>
    </View>
  );
}

function SlotPreview({ slot, belt, visual }: { slot: Slot; belt: Belt; visual: CosmeticDef["visual"] }) {
  if (slot === "sensei") return <Sensei belt={belt} size={132} mood="happy" bob visual={visual} />;
  return <BeltKnot belt={belt} size={108} visual={visual} />;
}

function SlotThumb({ slot, belt, visual }: { slot: Slot; belt: Belt; visual: CosmeticDef["visual"] }) {
  if (slot === "sensei") return <Sensei belt={belt} size={52} mood="happy" visual={visual} />;
  return <BeltKnot belt={belt} size={46} visual={visual} />;
}

function SlotSection({
  slot,
  belt,
  lang,
  coins,
  owned,
  equippedId,
  busy,
  tr,
  inkSub,
  inkFaint,
  onBuy,
  onEquip,
}: {
  slot: Slot;
  belt: Belt;
  lang: string;
  coins: number;
  owned: string[];
  equippedId?: string;
  busy: string | null;
  tr: ReturnType<typeof useI18n>["t"];
  inkSub: string;
  inkFaint: string;
  onBuy: (id: string) => void;
  onEquip: (id: string) => void;
}) {
  const items = catalogForSlot(slot);
  const [preview, setPreview] = useState<string>(equippedId ?? items[0]?.id);
  const previewDef = items.find((s) => s.id === preview) ?? items[0];
  const name = (d: CosmeticDef) => (lang === "ru" ? d.name.ru : d.name.en);
  const blurb = (d: CosmeticDef) => (lang === "ru" ? d.blurb.ru : d.blurb.en);

  return (
    <View style={{ gap: 10 }}>
      <Txt variant="bodyStrong" color={inkSub}>
        {lang === "ru" ? SLOT_TITLE[slot].ru : SLOT_TITLE[slot].en}
      </Txt>
      <Card>
        <View style={{ alignItems: "center", gap: 8, paddingVertical: 10 }}>
          <SlotPreview slot={slot} belt={belt} visual={previewDef?.visual ?? {}} />
          <Txt variant="bodyStrong">{previewDef ? name(previewDef) : ""}</Txt>
          <Txt variant="secondary" color={inkSub} style={{ textAlign: "center" }}>
            {previewDef ? blurb(previewDef) : tr("ward.tagline")}
          </Txt>
        </View>
      </Card>

      {items.map((s) => {
        const ownedIt = isOwned(owned, s.id);
        const worn = equippedId === s.id;
        const check = buyCheck(coins, owned, s.id);
        return (
          <Pressable key={s.id} onPress={() => setPreview(s.id)}>
            <Card>
              <View style={styles.row}>
                <View style={{ width: 56, alignItems: "center" }}>
                  <SlotThumb slot={slot} belt={belt} visual={s.visual} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="bodyStrong">{name(s)}</Txt>
                  <Txt variant="secondary" color={inkSub}>{blurb(s)}</Txt>
                </View>
                {preview === s.id && <Txt variant="caption" color={inkFaint}>{tr("ward.tryOn")}</Txt>}
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
                    <Txt variant="caption" color={inkFaint} style={{ textAlign: "center", marginTop: 4 }}>
                      {tr("ward.notEnough", { coins })}
                    </Txt>
                  )}
                  {check.reason === "out_of_season" && s.season && (
                    <Txt variant="caption" color={inkFaint} style={{ textAlign: "center", marginTop: 4 }}>
                      {tr("ward.outOfSeason", { season: seasonLabel(s.season, lang) })}
                    </Txt>
                  )}
                </>
              )}
            </Card>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44 },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
});
