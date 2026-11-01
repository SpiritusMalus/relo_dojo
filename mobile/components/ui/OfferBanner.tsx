import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  OFFERS,
  formatCountdown,
  loadOffers,
  markOffer,
  offerActive,
  offerMsLeft,
  type OfferId,
  type OfferState,
} from "../../store/offers";
import { useI18n } from "../../store/i18n";
import { useWallet } from "../../store/wallet";
import { captureAccountScope, isCurrentAccountScope } from "../../store/accountScope";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Card from "./Card";
import Icon from "./Icon";
import Txt from "./Txt";

// The ticking-clock banner (branch 7). One active offer at a time, newest trigger first.
// The countdown is real: when it hits zero the offer is gone, and it never comes back.
export default function OfferBanner() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { coins, spend, refresh } = useWallet();
  const [state, setState] = useState<OfferState>({});
  const [nowMs, setNowMs] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const ownerScope = useRef(captureAccountScope()).current;
  const current = useCallback(() => mounted.current && isCurrentAccountScope(ownerScope), [ownerScope]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (current()) void loadOffers().then((s) => { if (active && current()) setState(s); });
      return () => {
        active = false;
      };
    }, [current])
  );

  // Pick the active offer (limit48 outranks starter24 — it's the fresher pain).
  const id: OfferId | undefined = (["limit48", "starter24"] as const).find((k) =>
    offerActive(state[k], new Date(nowMs))
  );

  // Tick the clock only while a banner is visible.
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => { if (current()) setNowMs(Date.now()); }, 1000);
    return () => clearInterval(timer);
  }, [id, current]);

  if (!id || !current()) return null;
  const offer = OFFERS[id];
  const msLeft = offerMsLeft(state[id], new Date(nowMs));

  async function redeem() {
    if (!current() || busyRef.current || !id) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await spend(offer.item);
      if (!current()) return;
      const next = await markOffer(id, { redeemed: true }, ownerScope);
      if (!current()) return;
      setState(next);
      void refresh();
    } catch {
      // 409 — not enough koku; the price line already shows the target
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  }

  async function dismiss() {
    if (!id || !current()) return;
    const next = await markOffer(id, { dismissed: true }, ownerScope);
    if (current()) setState(next);
  }

  return (
    <Card>
      <View style={styles.row}>
        <Txt style={{ fontSize: 30 }}>{id === "starter24" ? "🧿" : "🥋"}</Txt>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{tr(id === "starter24" ? "offer.starterTitle" : "offer.limitTitle")}</Txt>
          <Txt variant="secondary" color={t.c.ink2}>
            {tr(id === "starter24" ? "offer.starterSub" : "offer.limitSub")}
          </Txt>
          <Txt variant="caption" color={t.c.fire} style={{ marginTop: 2 }}>
            {tr("offer.endsIn", { time: formatCountdown(msLeft) })}
          </Txt>
        </View>
        <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel="Dismiss offer">
          <Icon name="x" size={18} color={t.c.ink3} />
        </Pressable>
      </View>
      <Button
        label={busy ? tr("shop.buying") : tr("shop.buy", { price: offer.price })}
        onPress={redeem}
        disabled={busy || coins < offer.price}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 12 },
});
