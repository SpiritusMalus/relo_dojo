import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useProgress } from "../../store/progress";
import { useAuth } from "../../store/auth";
import { useWallet } from "../../store/wallet";
import { useI18n } from "../../store/i18n";
import { beltProgress } from "../../store/dojo";
import { useTheme } from "../../theme/theme";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import ActivationBanner from "../../components/ui/ActivationBanner";
import StreakRepairSheet from "../../components/ui/StreakRepairSheet";
import OfferBanner from "../../components/ui/OfferBanner";
import { ensureOffer } from "../../store/offers";
import LockGate from "../../components/ui/LockGate";
import DailyMixButton from "../../components/ui/DailyMixButton";
import ContractsCard from "../../components/ui/ContractsCard";
import StoryButton from "../../components/ui/StoryButton";
import ChallengeButton from "../../components/ui/ChallengeButton";
import ReviewButton from "../../components/ui/ReviewButton";
import TextReviewButton from "../../components/ui/TextReviewButton";
import ShopButton from "../../components/ui/ShopButton";
import { mistakeCount } from "../../store/mistakes";
import { buildStats, planPatch, shouldReplan } from "../../store/planner";
import { bonusDue, bonusPaidPatch, buildQuests, questBaseline, QUEST_BONUS_XP } from "../../store/quest";
import { tickDiary } from "../../store/diary";
import ProgressBarUi from "../../components/ui/ProgressBar";
import { senseiGreeting } from "../../store/greeting";
import { canAttemptToday, examOffer } from "../../store/exam";
import { beltByIndex } from "../../theme/theme";
import BeltKnot from "../../components/ui/BeltKnot";
import { TOPIC_LABELS } from "../../store/onboarding";
import { RU_TOPIC_LABELS } from "../../i18n/strings";
import { isoDay } from "../../store/adaptive";
import { requestPlan } from "../../services/api";
import Sensei from "../../components/ui/Sensei";
import ProgressBar from "../../components/ui/ProgressBar";
import Txt from "../../components/ui/Txt";

// Home = "today / recommended". One clear daily action (Daily Mix) plus the special modes (Story,
// Challenge, Review). Self-directed topic practice lives in the Train tab; the belt journey is a
// progress map in the Progress tab — so each surface has a single, distinct purpose (no duplication).
export default function HomeScreen() {
  const router = useRouter();
  const t = useTheme();
  const { progress, updateProfile, awardQuestBonus } = useProgress();
  const { user } = useAuth();
  const { leftToday, refresh } = useWallet();
  const { t: tr, lang } = useI18n();

  // Sensei's personal line — the memory layer made visible (Praktika's "caring friend who
  // remembers"). Pure selection from local state; copy comes from i18n.
  const greeting = senseiGreeting(progress, isoDay(new Date()));
  const greetingText = (() => {
    if (!greeting) return null;
    switch (greeting.kind) {
      case "doneToday":
        return tr("greet.doneToday", { n: greeting.n });
      case "wins":
        return greeting.wins;
      case "weakTopic": {
        const label =
          lang === "ru"
            ? RU_TOPIC_LABELS[greeting.topic] ?? greeting.topic
            : TOPIC_LABELS[greeting.topic] ?? greeting.topic;
        return tr("greet.weakTopic", { topic: label });
      }
      case "streak":
        return tr("greet.streak", { n: greeting.n });
      default:
        return tr((["greet.d0", "greet.d1", "greet.d2"] as const)[greeting.idx] ?? "greet.d0");
    }
  })();

  const bp = beltProgress(progress);
  // Until the account is verified, only the starter (Daily Mix) is open; other modes are locked.
  const locked = !!user && !user.is_verified;

  // Refresh the mistake count whenever Home regains focus (e.g. returning from Review/Practice).
  const [mistakes, setMistakes] = useState(0);

  // Trigger: onboarding done → open the one-shot 24h starter offer (no-op if it ever existed).
  // In an effect, not the render body — render must stay side-effect-free.
  useEffect(() => {
    if (progress.onboarded) void ensureOffer("starter24");
  }, [progress.onboarded]);

  // Stage 2 Planner trigger: once per Home mount, if the plan is missing/stale (new goal, 3-day
  // lapse, weekly refresh) ask the server for a fresh one and cache it into the local profile.
  // Verified-account-and-online concerns are the server's: failures are silently ignored.
  const planAskedRef = useRef(false);
  useEffect(() => {
    if (planAskedRef.current || !user || !progress.onboarded || !progress.profile) return;
    const reason = shouldReplan(progress, isoDay(new Date()));
    if (!reason) return;
    planAskedRef.current = true;
    requestPlan(buildStats(progress))
      .then((plan) => updateProfile(planPatch(plan, progress.profile!, questBaseline(progress))))
      .catch(() => {
        planAskedRef.current = false; // let a later visit retry (offline / model down)
      });
  }, [user, progress, updateProfile]);

  // Student diary: weekly tick — close a finished week into a recap, start a new baseline.
  useEffect(() => {
    const d = tickDiary(progress, isoDay(new Date()));
    if (d) updateProfile({ diary: d });
  }, [progress, updateProfile]);

  // Weekly quest scroll: pay the one-shot completion bonus the moment all goals are done.
  const quests = buildQuests(progress);
  useEffect(() => {
    if (bonusDue(progress)) awardQuestBonus(QUEST_BONUS_XP, bonusPaidPatch(progress.profile!));
  }, [progress, awardQuestBonus]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      mistakeCount().then((n) => active && setMistakes(n));
      // Refresh the wallet too: koku earned and the daily allowance spent in Practice should be
      // visible the moment the learner lands back on Home (the shrinking counter is the point).
      void refresh();
      return () => {
        active = false;
      };
    }, [refresh])
  );

  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />

      <ActivationBanner />

      {/* Broken-streak repair offer (loss aversion): visible while the repair window is open */}
      <StreakRepairSheet belt={bp.belt} />

      {/* One-shot timed offer (FOMO with an honest clock) */}
      <OfferBanner />

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

      {/* Sensei's line: proof the dojo remembers you. Quiet styling — a remark, not a banner. */}
      {!!greetingText && (
        <View
          style={{
            backgroundColor: t.c.surface3,
            borderRadius: t.spacing.radius,
            paddingVertical: 10,
            paddingHorizontal: 14,
          }}
        >
          <Txt variant="secondary" color={t.c.ink2} style={{ fontStyle: "italic" }}>
            🥋 {greetingText}
          </Txt>
        </View>
      )}

      {/* Weekly quest scroll: the Planner's focus as three visible goals (store/quest.ts). */}
      {quests.length > 0 && (
        <View
          style={{
            backgroundColor: t.c.surface,
            borderRadius: t.spacing.radius,
            borderWidth: 1,
            borderColor: t.c.line,
            padding: 14,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Txt variant="label">{`📜 ${tr("quest.title")}`}</Txt>
            <Txt variant="caption" color={t.c.ink3}>
              {progress.profile?.planBonusPaid === progress.profile?.planDate
                ? tr("quest.done")
                : tr("quest.bonus", { n: QUEST_BONUS_XP })}
            </Txt>
          </View>
          {quests.map((q) => (
            <View key={q.topic} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Txt variant="secondary" color={t.c.ink2}>
                  {lang === "ru" ? RU_TOPIC_LABELS[q.topic] ?? q.topic : TOPIC_LABELS[q.topic] ?? q.topic}
                </Txt>
                <Txt variant="secondary" color={q.done >= q.target ? t.c.accent : t.c.ink3}>
                  {`${q.done}/${q.target}`}
                </Txt>
              </View>
              <ProgressBarUi pct={(q.done / q.target) * 100} height={6} />
            </View>
          ))}
        </View>
      )}

      {/* Belt exam: skill has outgrown the worn belt — the promotion ritual is ready. */}
      {(() => {
        const offer = examOffer(progress);
        if (!offer) return null;
        const target = beltByIndex(offer.target);
        const allowed = canAttemptToday(progress, isoDay(new Date()));
        return (
          <Pressable
            onPress={() => router.push("/belt-exam")}
            accessibilityRole="button"
            accessibilityLabel="Belt exam"
            style={({ pressed }) => [
              styles.examBtn,
              {
                backgroundColor: t.c.gold,
                borderRadius: t.spacing.radius,
                borderBottomWidth: pressed ? 1 : 4,
                borderBottomColor: target.edge,
              },
              pressed ? { transform: [{ translateY: 3 }] } : null,
            ]}
          >
            <BeltKnot belt={target} size={40} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle" color={target.ink}>
                {tr("exam.btnTitle", { belt: target.name })}
              </Txt>
              <Txt variant="secondary" color={target.ink} style={{ opacity: 0.8 }}>
                {allowed ? tr("exam.btnSub") : tr("exam.tomorrow")}
              </Txt>
            </View>
          </Pressable>
        );
      })()}

      {/* Recommended daily action (starter — always open) + special modes (locked until verified) */}
      <DailyMixButton onPress={() => router.push("/practice")} />
      {leftToday !== null && (
        <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center", marginTop: -6 }}>
          {tr("home.leftToday", { n: leftToday })}
        </Txt>
      )}

      {/* Daily contracts (engagement v2): the come-back-every-day + earn-varied hook. */}
      <ContractsCard />

      <LockGate locked={locked}>
        <StoryButton onPress={() => router.push("/story")} />
      </LockGate>
      <LockGate locked={locked}>
        <ChallengeButton onPress={() => router.push("/challenge")} />
      </LockGate>
      <LockGate locked={locked}>
        <TextReviewButton onPress={() => router.push("/text-review")} />
      </LockGate>
      {mistakes > 0 && (
        <LockGate locked={locked}>
          <ReviewButton count={mistakes} onPress={() => router.push("/review")} />
        </LockGate>
      )}
      {/* Named entry to the Lavka — the CoinBadge alone (a tappable balance) was too implicit.
          Not gated: the server allows unverified accounts to spend koku they've earned. */}
      <ShopButton onPress={() => router.push("/shop")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 20, overflow: "hidden" },
  heroMascot: { position: "absolute", top: 6, right: 10 },
  examBtn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 64 },
});
