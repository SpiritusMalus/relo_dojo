import { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { ApiError, openScroll, type ScrollReward } from "../../services/api";
import { trackScrollOpen } from "../../services/analytics";
import { useI18n } from "../../store/i18n";
import { useProgress } from "../../store/progress";
import { useWallet } from "../../store/wallet";
import { captureAccountScope, isCurrentAccountScope } from "../../store/accountScope";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Card from "./Card";
import Confetti from "./Confetti";
import Icon from "./Icon";
import Txt from "./Txt";

// The server owns the reward. A short reveal marks completion without delaying the next task.
export default function Scroll({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { refresh } = useWallet();
  const { activateBoost } = useProgress();
  const [phase, setPhase] = useState<"sealed" | "opening" | "open" | "spent" | "error">("sealed");
  const [reward, setReward] = useState<ScrollReward | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const ownerScope = useRef(captureAccountScope()).current;
  const reveal = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; reveal.stopAnimation(); };
  }, [reveal]);

  async function open() {
    const current = () => mounted.current && isCurrentAccountScope(ownerScope);
    if (!current() || busy.current || (phase !== "sealed" && phase !== "error")) return;
    busy.current = true;
    setPhase("opening");
    trackScrollOpen({ mode: "practice" });
    try {
      const result = await openScroll();
      // The server credit belongs to the request's original account. An old screen must never
      // apply its local boost or refresh another account's mirrors after navigation/logout.
      if (!current()) return;
      if (result.kind === "kensei") activateBoost();
      void refresh();
      setReward(result);
      setPhase("open");
      reveal.setValue(t.reduceMotion ? 1 : 0);
      if (!t.reduceMotion) Animated.timing(reveal, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } catch (error) {
      if (!current()) return;
      // A dropped response may have credited the server balance: resync, never retry automatically.
      void refresh();
      setPhase(error instanceof ApiError && error.status === 403 && error.code === "scroll_limit" ? "spent" : "error");
    } finally {
      busy.current = false;
    }
  }

  const rare = reward && reward.kind !== "koku";
  const rewardText = reward?.kind === "koku" ? tr("scroll.koku", { n: reward.amount })
    : reward?.kind === "omamori" ? tr("scroll.omamori") : tr("scroll.kensei");

  return (
    <Card>
      <View style={{ alignItems: "center", gap: 16, paddingVertical: 12 }}>
        {phase === "open" && reward ? (
          <>
            {rare && <Confetti n={14} />}
            <Animated.View style={{ opacity: reveal, alignItems: "center", gap: 12 }} accessibilityLiveRegion="polite">
              <Icon name={reward.kind === "kensei" ? "bolt" : rare ? "star" : "check"} size={56} color={t.c.accent} />
              <Txt variant="cardTitle" style={{ textAlign: "center" }}>{tr("scroll.earned")}</Txt>
              <Txt variant="bodyStrong" style={{ textAlign: "center" }}>{rewardText}</Txt>
              {rare && <Txt variant="caption" color={t.c.gold}>{tr("scroll.rare")}</Txt>}
            </Animated.View>
            <Button label={tr("action.finish")} onPress={onDone} />
          </>
        ) : (
          <>
            <Icon name="scroll" size={64} color={t.c.gold} />
            <Txt variant="cardTitle" style={{ textAlign: "center" }}>{tr("scroll.title")}</Txt>
            <Txt variant="secondary" color={t.c.ink2} style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
              {tr(phase === "spent" ? "scroll.spent" : phase === "error" ? "scroll.network" : "scroll.note")}
            </Txt>
            {phase !== "spent" && (
              <Button
                label={tr(phase === "opening" ? "scroll.opening" : phase === "error" ? "scroll.retry" : "scroll.open")}
                onPress={open}
                disabled={phase === "opening"}
              />
            )}
            {(phase === "spent" || phase === "error") && <Button variant="ghost" label={tr("action.finish")} onPress={onDone} />}
          </>
        )}
      </View>
    </Card>
  );
}
