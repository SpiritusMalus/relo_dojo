import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useI18n } from "../../store/i18n";
import { EXTRA_PACK_SIZE, PRICE_EXTRA_PACK, useWallet } from "../../store/wallet";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Card from "./Card";
import Sensei from "./Sensei";
import Txt from "./Txt";
import type { Belt } from "../../theme/theme";

// Shown when a verified free account hits the daily exercise limit (403 "daily_limit").
// This is the squeeze point of the free tier — the user is blocked at peak motivation, with two
// ways out: spend koku on an extra pack now, or (soon) go premium for unlimited practice.
export default function LimitSheet({ belt, onUnlocked }: { belt: Belt; onUnlocked: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const { coins, spend } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAfford = coins >= PRICE_EXTRA_PACK;

  async function buyPack() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await spend("extra_pack");
      onUnlocked(); // headroom raised server-side → retry the exercise load
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <View style={{ alignItems: "center", gap: 10, paddingVertical: 6 }}>
        <Sensei belt={belt} size={84} mood="think" />
        <Txt variant="bodyStrong" style={{ textAlign: "center" }}>
          {tr("limit.title")}
        </Txt>
        <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center" }}>
          {tr("limit.sub")}
        </Txt>

        <View style={{ alignSelf: "stretch", gap: 8, marginTop: 6 }}>
          <Button
            label={
              busy
                ? tr("limit.buying")
                : tr("limit.buyPack", { n: EXTRA_PACK_SIZE, price: PRICE_EXTRA_PACK })
            }
            onPress={buyPack}
            disabled={!canAfford || busy}
          />
          {!canAfford && (
            <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center" }}>
              {tr("limit.notEnough", { coins })}
            </Txt>
          )}
          {/* The other way out: the Black Belt pitch, served exactly at the blocked moment. */}
          <Button label={tr("limit.premium")} variant="ghost" onPress={() => router.push("/premium")} />
        </View>

        {error && (
          <Txt variant="caption" color={t.c.bad} style={{ textAlign: "center" }}>
            {error}
          </Txt>
        )}
      </View>
    </Card>
  );
}
