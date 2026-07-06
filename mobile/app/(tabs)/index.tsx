import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useProgress } from "../../store/progress";
import { useAuth } from "../../store/auth";
import { useAccess } from "../../store/access";
import { useWallet } from "../../store/wallet";
import { useI18n } from "../../store/i18n";
import { beltProgress, type PathNode } from "../../store/dojo";
import { useTheme } from "../../theme/theme";
import Screen from "../../components/ui/Screen";
import TopBar from "../../components/ui/TopBar";
import ActivationBanner from "../../components/ui/ActivationBanner";
import StreakRepairSheet from "../../components/ui/StreakRepairSheet";
import OfferBanner from "../../components/ui/OfferBanner";
import { ensureOffer } from "../../store/offers";
import RegisterWall from "../../components/ui/RegisterWall";
import { dismiss as dismissWall, loadWall, saveWall, shouldShowWall, DEFAULT_WALL, type WallState } from "../../store/registerWall";
import DailyMixButton from "../../components/ui/DailyMixButton";
import CoachCard from "../../components/ui/CoachCard";
import DailyGoalRing from "../../components/ui/DailyGoalRing";
import ContractsCard from "../../components/ui/ContractsCard";
import JourneyPath from "../../components/ui/JourneyPath";
import { buildStats, planPatch, shouldReplan } from "../../store/planner";
import { bonusDue, bonusPaidPatch, buildQuests, questBaseline, QUEST_BONUS_XP } from "../../store/quest";
import { tickDiary } from "../../store/diary";
import ProgressBarUi from "../../components/ui/ProgressBar";
import { senseiGreeting, weakestTopic } from "../../store/greeting";
import { canAttemptToday, examOffer } from "../../store/exam";
import { beltByIndex } from "../../theme/theme";
import BeltKnot from "../../components/ui/BeltKnot";
import { TOPIC_LABELS, minutesToGoal } from "../../store/onboarding";
import { RU_TOPIC_LABELS } from "../../i18n/strings";
import { isoDay } from "../../store/adaptive";
import { requestPlan } from "../../services/api";
import RuleSheet from "../../components/ui/RuleSheet";
import Sensei, { type Mood } from "../../components/ui/Sensei";
import SenseiBubble from "../../components/ui/SenseiBubble";
import ProgressBar from "../../components/ui/ProgressBar";
import Txt from "../../components/ui/Txt";

// Home = "твой пояс → твой путь → one thing to do": the belt hero, the belt JourneyPath, and a
// single primary action (Daily Mix) — wrapped in contextual retention cards (offers, streak repair,
// quests, register wall, coach). Every special mode (Story, Challenge, Review, Review-my-text, Shop)
// lives in the Train tab below the topic picker; the journey map shows here, not on Progress anymore.
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
  // Sensei's mood matches what he's saying (think when nudging a weak topic, cheer when you're done).
  const greetingMood: Mood =
    greeting?.kind === "weakTopic" ? "think" : greeting?.kind === "doneToday" ? "cheer" : "happy";

  const bp = beltProgress(progress);
  // Restored designer Home hooks (reference/dojo-home.jsx): the shakiest topic as a one-tap coach CTA
  // + today's goal as a ring. Pure reads of local state — no backend, no logic change.
  const weakTopic = weakestTopic(progress);
  const weakLabel = weakTopic ? (lang === "ru" ? RU_TOPIC_LABELS[weakTopic] ?? weakTopic : TOPIC_LABELS[weakTopic] ?? weakTopic) : "";
  const weakStat = weakTopic ? progress.topics[weakTopic] : undefined;
  const weakAccPct = weakStat && weakStat.attempts > 0 ? Math.round((weakStat.correct / weakStat.attempts) * 100) : 0;
  const goalTarget = minutesToGoal(progress.profile?.dailyMinutes ?? 0);
  // Feature gating is data-driven (store/access.ts → backend services/access.py). Content modes are
  // open to everyone (incl. anonymous); these flags stay false today but auto-lock if a feature is
  // ever moved behind an account/premium gate — no screen rewrite needed.
  const access = useAccess();

  // Soft register wall (anon-first funnel): lesson count is bumped in practice; we just read it here.
  const [wall, setWall] = useState<WallState>(DEFAULT_WALL);

  // Course Presentation step: a tapped path unit opens its rule card first; the drill starts from
  // the card's CTA. Null = closed.
  const [ruleTopic, setRuleTopic] = useState<string | null>(null);

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
  // Guard against a re-render race double-paying: the awardQuestBonus() state update re-runs this
  // effect before bonusPaidPatch settles, so we latch per planDate (mirrors planAskedRef above) and
  // only pay once. `progress.profile &&` keeps the non-null assertion from crashing on a partial snapshot.
  const quests = buildQuests(progress);
  const bonusPaidForRef = useRef<string | null>(null);
  useEffect(() => {
    const planDate = progress.profile?.planDate ?? null;
    if (progress.profile && bonusDue(progress) && bonusPaidForRef.current !== planDate) {
      bonusPaidForRef.current = planDate;
      awardQuestBonus(QUEST_BONUS_XP, bonusPaidPatch(progress.profile));
    }
  }, [progress, awardQuestBonus]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Re-read the anon lesson count (bumped at each session finish in practice.tsx).
      loadWall().then((w) => active && setWall(w));
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

      {/* Soft save-progress wall: after a few anonymous lessons, offer (never force) an account to
          sync progress. Driven by access.sync (false only for anonymous users). */}
      {shouldShowWall(wall, access.sync) && (
        <RegisterWall
          onCreate={() => router.push("/login")}
          onDismiss={() => {
            const next = dismissWall(wall);
            setWall(next);
            void saveWall(next);
          }}
        />
      )}

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
          {!bp.started
            ? tr("home.notStarted")
            : bp.atMax
            ? tr("home.topBelt", { cefr: bp.cefr })
            : tr("home.toNext", { cefr: bp.cefr, pct: bp.pctToNext, belt: bp.nextBelt.name })}
        </Txt>
        <ProgressBar pct={bp.atMax ? 100 : bp.pctToNext} color={bp.belt.ink} track="rgba(0,0,0,0.16)" />
      </LinearGradient>

      {/* Sensei's line, spoken: the mascot + a speech bubble (the memory layer, made personal). */}
      {!!greetingText && <SenseiBubble belt={bp.belt} mood={greetingMood} text={greetingText} />}

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

      {/* Today's goal as a ring + the shakiest-topic coach card — restored designer Home hooks. */}
      {goalTarget > 0 && <DailyGoalRing done={progress.todayCount} target={goalTarget} />}
      {weakTopic && (
        <CoachCard
          topicLabel={weakLabel}
          accPct={weakAccPct}
          onPress={() => router.push({ pathname: "/practice", params: { topic: weakTopic } })}
        />
      )}

      {/* Belt journey = the course track: tap a unit to READ ITS RULE first (Presentation, PPP),
          then drill from the card's CTA; the belt-test node opens the exam. Locked units (past the
          mastery gate) stay non-tappable. */}
      <JourneyPath
        onSelect={(node: PathNode) => {
          if (node.state === "test") router.push("/belt-exam");
          else if (node.state === "ready" && node.topic)
            router.push({ pathname: "/checkpoint", params: { topic: node.topic.id } }); // зачёт awaits
          else if (node.topic) setRuleTopic(node.topic.id);
        }}
      />
      {ruleTopic && (
        <RuleSheet
          topic={ruleTopic}
          visible
          onTrain={() => {
            const topic = ruleTopic;
            setRuleTopic(null);
            router.push({ pathname: "/practice", params: { topic } });
          }}
          onClose={() => setRuleTopic(null)}
        />
      )}

      {/* The one daily action (starter — always open). Every other mode lives in the Train tab. */}
      <DailyMixButton onPress={() => router.push("/practice")} />
      {leftToday !== null && (
        <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center", marginTop: -6 }}>
          {tr("home.leftToday", { n: leftToday })}
        </Txt>
      )}

      {/* Daily contracts (engagement v2): the come-back-every-day + earn-varied hook.
          Account-only — the koku economy is server-authoritative, so guests don't see it. */}
      {access.sync && <ContractsCard />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { padding: 20, overflow: "hidden" },
  heroMascot: { position: "absolute", top: 6, right: 10 },
  examBtn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 64 },
});
