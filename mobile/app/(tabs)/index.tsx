import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useProgress } from "../../store/progress";
import { useAuth } from "../../store/auth";
import { useI18n } from "../../store/i18n";
import { beltProgress } from "../../store/dojo";
import { useTheme } from "../../theme/theme";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import ActivationBanner from "../../components/ui/ActivationBanner";
import LockGate from "../../components/ui/LockGate";
import DailyMixButton from "../../components/ui/DailyMixButton";
import StoryButton from "../../components/ui/StoryButton";
import ChallengeButton from "../../components/ui/ChallengeButton";
import ReviewButton from "../../components/ui/ReviewButton";
import { mistakeCount } from "../../store/mistakes";
import Sensei from "../../components/ui/Sensei";
import ProgressBar from "../../components/ui/ProgressBar";
import Txt from "../../components/ui/Txt";

// Home = "today / recommended". One clear daily action (Daily Mix) plus the special modes (Story,
// Challenge, Review). Self-directed topic practice lives in the Train tab; the belt journey is a
// progress map in the Progress tab — so each surface has a single, distinct purpose (no duplication).
export default function HomeScreen() {
  const router = useRouter();
  const t = useTheme();
  const { progress } = useProgress();
  const { user } = useAuth();
  const { t: tr } = useI18n();

  const bp = beltProgress(progress);
  // Until the account is verified, only the starter (Daily Mix) is open; other modes are locked.
  const locked = !!user && !user.is_verified;

  // Refresh the mistake count whenever Home regains focus (e.g. returning from Review/Practice).
  const [mistakes, setMistakes] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      mistakeCount().then((n) => active && setMistakes(n));
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />

      <ActivationBanner />

      {/* Belt hero — background is the current belt colour */}
      <LinearGradient
        colors={[bp.belt.color, bp.belt.edge]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[styles.hero, { borderRadius: t.spacing.radiusLg }]}
      >
        <View style={styles.heroMascot}>
          <Sensei belt={bp.belt} size={92} mood="cheer" bob />
        </View>
        <Txt variant="label" color={bp.belt.ink} style={{ opacity: 0.8 }}>
          {tr("home.yourBelt")}
        </Txt>
        <Txt variant="hero" color={bp.belt.ink} style={{ marginTop: 2 }}>
          {bp.belt.name}
        </Txt>
        <Txt variant="bodyStrong" color={bp.belt.ink} style={{ opacity: 0.9, marginTop: 4, marginBottom: 12 }}>
          {bp.atMax
            ? tr("home.topBelt", { cefr: bp.cefr })
            : tr("home.toNext", { cefr: bp.cefr, pct: bp.pctToNext, belt: bp.nextBelt.name })}
        </Txt>
        <ProgressBar pct={bp.atMax ? 100 : bp.pctToNext} color={bp.belt.ink} track="rgba(0,0,0,0.16)" />
      </LinearGradient>

      {/* Recommended daily action (starter — always open) + special modes (locked until verified) */}
      <DailyMixButton onPress={() => router.push("/practice")} />
      <LockGate locked={locked}>
        <StoryButton onPress={() => router.push("/story")} />
      </LockGate>
      <LockGate locked={locked}>
        <ChallengeButton onPress={() => router.push("/challenge")} />
      </LockGate>
      {mistakes > 0 && (
        <LockGate locked={locked}>
          <ReviewButton count={mistakes} onPress={() => router.push("/review")} />
        </LockGate>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 20, overflow: "hidden" },
  heroMascot: { position: "absolute", top: 6, right: 10 },
});
