import { useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { openScroll, type ScrollReward } from "../../services/api";
import { trackScrollOpen } from "../../services/analytics";
import { useI18n } from "../../store/i18n";
import { useProgress } from "../../store/progress";
import { useWallet } from "../../store/wallet";
import { useTheme } from "../../theme/theme";
import Button from "./Button";
import Card from "./Card";
import Confetti from "./Confetti";
import Txt from "./Txt";

// End-of-session reward scroll (variable reinforcement, branch 4). The roll happens SERVER-side
// the moment the user taps — but the reveal is deliberately delayed: the pause between tap and
// prize is the mechanic. Rare drops (omamori / kensei) get confetti.
export default function Scroll({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { refresh } = useWallet();
  const { activateBoost } = useProgress();
  const [phase, setPhase] = useState<"sealed" | "opening" | "open" | "spent">("sealed");
  const [reward, setReward] = useState<ScrollReward | null>(null);
  const pop = useRef(new Animated.Value(0)).current;

  async function open() {
    if (phase !== "sealed") return;
    setPhase("opening");
    trackScrollOpen({ mode: "practice" });
    try {
      const r = await openScroll();
      // The anticipation beat: hold the sealed scroll a moment before the reveal.
      setTimeout(() => {
        setReward(r);
        setPhase("open");
        if (r.kind === "kensei") activateBoost();
        void refresh(); // koku/omamori were credited server-side
        Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
      }, t.reduceMotion ? 0 : 900);
    } catch {
      // Daily scroll cap (403) or offline. Don't silently pop to the menu — that reads as a bug
      // ("I tapped and got thrown out"). Show a calm "come back tomorrow" note and let the learner
      // tap Finish deliberately.
      setPhase("spent");
    }
  }

  if (phase === "spent") {
    return (
      <Card>
        <View style={{ alignItems: "center", gap: 12, paddingVertical: 10 }}>
          <Txt style={{ fontSize: 52, textAlign: "center" }}>📜</Txt>
          <Txt variant="bodyStrong" style={{ textAlign: "center" }}>
            {tr("scroll.spent")}
          </Txt>
          <Button label={tr("action.finish")} onPress={onDone} />
        </View>
      </Card>
    );
  }

  const rare = reward && reward.kind !== "koku";
  const rewardText =
    reward?.kind === "koku"
      ? tr("scroll.koku", { n: reward.amount })
      : reward?.kind === "omamori"
      ? tr("scroll.omamori")
      : tr("scroll.kensei");

  return (
    <Card>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 10 }}>
        {phase !== "open" && (
          <>
            <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={tr("scroll.open")}>
              <Txt style={{ fontSize: 64, textAlign: "center" }}>📜</Txt>
            </Pressable>
            <Txt variant="bodyStrong">{tr("scroll.title")}</Txt>
            <Button
              label={phase === "opening" ? tr("scroll.opening") : tr("scroll.open")}
              onPress={open}
              disabled={phase === "opening"}
            />
          </>
        )}

        {phase === "open" && reward && (
          <>
            {rare && <Confetti />}
            <Animated.View style={{ transform: [{ scale: pop }], alignItems: "center", gap: 8 }}>
              <Txt style={{ fontSize: 52, textAlign: "center" }}>
                {reward.kind === "koku" ? "🌾" : reward.kind === "omamori" ? "🧿" : "⚡"}
              </Txt>
              <Txt variant="bodyStrong" style={{ textAlign: "center" }}>
                {rewardText}
              </Txt>
              {rare && (
                <Txt variant="caption" color={t.c.gold} style={{ textAlign: "center" }}>
                  {tr("scroll.rare")}
                </Txt>
              )}
            </Animated.View>
            <Button label={tr("action.finish")} onPress={onDone} />
          </>
        )}
      </View>
    </Card>
  );
}
