import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useProgress } from "../../store/progress";
import { useAuth } from "../../store/auth";
import { useAccess } from "../../store/access";
import { useI18n } from "../../store/i18n";
import { beltProgress } from "../../store/dojo";
import { mistakeCount } from "../../store/mistakes";
import { getStoryCatalog } from "../../services/api";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import ActivationBanner from "../../components/ui/ActivationBanner";
import LockGate from "../../components/ui/LockGate";
import TopicsBody from "../../components/ui/TopicsBody";
import StoryButton from "../../components/ui/StoryButton";
import ChallengeButton from "../../components/ui/ChallengeButton";
import ReviewButton from "../../components/ui/ReviewButton";
import TextReviewButton from "../../components/ui/TextReviewButton";
import ShopButton from "../../components/ui/ShopButton";
import Txt from "../../components/ui/Txt";

// "Train" tab — the self-directed topic picker (verified-only) plus every special mode (Story,
// Challenge, Review, Review-my-text, Shop). Home keeps just the belt + path + one daily action; the
// modes moved here, each keeping the exact access gate it had on Home.
export default function TrainScreen() {
  const router = useRouter();
  const { progress } = useProgress();
  const { user } = useAuth();
  const access = useAccess();
  const { t: tr } = useI18n();
  const bp = beltProgress(progress);
  const locked = !!user && !user.is_verified;

  // Counts that drive two of the mode entries — refreshed whenever Train regains focus (same pattern
  // Home used before these moved): mistakes gate the Review button, the featured arc subtitles Story.
  const [mistakes, setMistakes] = useState(0);
  const [featuredArc, setFeaturedArc] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      mistakeCount().then((n) => active && setMistakes(n));
      getStoryCatalog()
        .then((c) => {
          if (!active) return;
          const arc = c.arcs.find((a) => a.id === c.featured_id);
          setFeaturedArc(arc ? arc.title : null);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [])
  );

  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />
      <ActivationBanner />
      {/* Self-directed topic practice — verified-only, as before. */}
      <LockGate locked={locked}>
        <TopicsBody />
      </LockGate>

      {/* Special modes — outside the verified-only gate above, so anonymous/unverified learners keep
          the same access to modes they had on Home. Each entry preserves its own gate exactly. */}
      <Txt variant="label" style={{ marginTop: 4 }}>{tr("train.modes")}</Txt>
      <LockGate locked={!access.review_text}>
        <TextReviewButton onPress={() => router.push("/text-review")} />
      </LockGate>
      <LockGate locked={!access.story}>
        <StoryButton
          onPress={() => router.push("/story")}
          subtitle={featuredArc ? tr("home.featuredStory", { title: featuredArc }) : undefined}
        />
      </LockGate>
      <LockGate locked={!access.challenge}>
        <ChallengeButton onPress={() => router.push("/challenge")} />
      </LockGate>
      {mistakes > 0 && (
        <LockGate locked={!access.review}>
          <ReviewButton count={mistakes} onPress={() => router.push("/review")} />
        </LockGate>
      )}
      {/* Named entry to the Lavka. Account-only: koku is earned/spent server-side, so a guest's shop
          would be inert (0 koku, 401 on buy). Shown once there's an account. */}
      {access.sync && <ShopButton onPress={() => router.push("/shop")} />}
    </Screen>
  );
}
