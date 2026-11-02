import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useProgress } from "../../store/progress";
import { useAuth } from "../../store/auth";
import { useAccountScope } from "../../store/useAccountScope";
import { isCurrentAccountScope } from "../../store/accountScope";
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
import Button from "../../components/ui/Button";
import { useDojoRoom } from "../../store/dojoRoom";
import { loadMistakes, type Mistake } from "../../store/mistakes";
import { nextLearningGoal, learningGoalRoute } from "../../store/nextLearningGoal";
import { learningLoopCopy } from "../../i18n/learningLoopCopy";
import { recoverLearningSessions } from "../../services/learningSession";
import { track } from "../../services/analytics";
import ContractsCard from "../../components/ui/ContractsCard";
import JourneyPath from "../../components/ui/JourneyPath";
import { buildStats, planPatch, shouldReplan } from "../../store/planner";
import { bonusDue, bonusPaidPatch, buildQuests, questBaseline, QUEST_BONUS_XP } from "../../store/quest";
import { tickDiary } from "../../store/diary";
import ProgressBarUi from "../../components/ui/ProgressBar";
import { canAttemptToday, examOffer } from "../../store/exam";
import { levelCheckDue } from "../../store/levelCheck";
import Icon from "../../components/ui/Icon";
import { beltByIndex } from "../../theme/theme";
import BeltKnot from "../../components/ui/BeltKnot";
import { TOPIC_LABELS } from "../../store/onboarding";
import { RU_TOPIC_LABELS, beltName } from "../../i18n/strings";
import { isoDay } from "../../store/adaptive";
import { requestPlan } from "../../services/api";
import RuleSheet from "../../components/ui/RuleSheet";
import DojoItemArtwork from "../../components/ui/DojoItemArtwork";
import ChaptersButton from "../../components/ui/ChaptersButton";
import { dojoDays, dojoItemName } from "../../store/dojoRoomCopy";
import Txt from "../../components/ui/Txt";

// Lead with the next learning action; a compact collection entry follows.
export default function HomeScreen() {
  const scope = useAccountScope();
  const router = useRouter();
  const t = useTheme();
  const { progress, updateProfile, awardQuestBonus } = useProgress();
  const { user } = useAuth();
  const { leftToday, refresh } = useWallet();
  const { t: tr, lang } = useI18n();

  const bp = beltProgress(progress);
  const room = useDojoRoom();
  const { refresh: refreshRoom, acceptSnapshot } = room;
  const copy = learningLoopCopy(lang);
  const [deck, setDeck] = useState<{ scope: typeof scope; items: Mistake[] | null }>({ scope, items: null });
  const goalReady = deck.scope === scope && deck.items !== null;
  const goal = nextLearningGoal(progress, deck.scope === scope ? deck.items ?? [] : [], new Date().toISOString());
  const topicLabel = goal.topic ? (lang === "ru" ? RU_TOPIC_LABELS[goal.topic] : TOPIC_LABELS[goal.topic]) ?? goal.topic : "";
  const goalCopy = copy.goal(goal, topicLabel);
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
      .then((plan) => {
        if (isCurrentAccountScope(scope)) updateProfile(planPatch(plan, progress.profile!, questBaseline(progress)));
      })
      .catch(() => {
        if (isCurrentAccountScope(scope)) planAskedRef.current = false;
      });
  }, [scope, user, progress, updateProfile]);

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
      loadWall().then((w) => { if (active && isCurrentAccountScope(scope)) setWall(w); });
      loadMistakes(scope).then((items) => { if (active && isCurrentAccountScope(scope)) setDeck({ scope, items }); });
      // Refresh the wallet too: koku earned and the daily allowance spent in Practice should be
      // visible the moment the learner lands back on Home (the shrinking counter is the point).
      void refresh();
      void recoverLearningSessions(scope).then((receipts) => {
        if (!active || !isCurrentAccountScope(scope)) return;
        for (const receipt of receipts) if (receipt.dojo) acceptSnapshot(receipt.dojo, scope);
        void refreshRoom();
      });
      return () => {
        active = false;
      };
    }, [scope, refresh, refreshRoom, acceptSnapshot])
  );

  return (
    <Screen>
      <TopBar belt={bp.belt} streak={progress.dailyStreak} xp={progress.xp} />

      <ActivationBanner />

      <View style={styles.hero}>
        <View style={{ gap: 8 }}>
          <Txt variant="hero">{goalReady ? goalCopy.title : copy.loadingGoal}</Txt>
          {goalReady && <Txt variant="body" color={t.c.ink2}>{goalCopy.description}</Txt>}
        </View>
        <Button label={goalCopy.action} disabled={!goalReady} onPress={() => {
          track("learning_goal_open", { kind: goal.kind, source: "home" });
          router.push(learningGoalRoute(goal));
        }} />
      </View>
      {leftToday !== null && (
        <Txt variant="caption" color={t.c.ink3} style={{ textAlign: "center", marginTop: -6 }}>
          {tr("home.leftToday", { n: leftToday })}
        </Txt>
      )}
      {room.available && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.dojo}
          onPress={() => router.push("/dojo")}
          style={({ pressed }) => [styles.roomLabel, { borderColor: t.c.line, opacity: pressed ? 0.65 : 1 }]}
        >
            <DojoItemArtwork itemId={room.nextMilestone?.itemId ?? room.equipped.dojo_display ?? "dojo_display_blank"} size={68} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="cardTitle">{copy.dojo}</Txt>
              <Txt variant="secondary" color={t.c.ink2}>
                {room.nextMilestone
                  ? `${dojoItemName(room.nextMilestone.itemId, lang)} · ${room.nextMilestone.progress} / ${dojoDays(room.nextMilestone.days, lang)}`
                  : dojoItemName(room.equipped.dojo_display ?? "dojo_display_blank", lang)}
              </Txt>
            </View>
            <Icon name="chevron" size={20} color={t.c.ink2} />
        </Pressable>
      )}

      <ChaptersButton onPress={() => router.push("/chapters")} />

      <View style={styles.secondaryActions}>
        {goal.kind !== "mix" && <Pressable accessibilityRole="button" onPress={() => router.push("/practice")} style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1 }]}>
          <Txt variant="bodyStrong" color={t.c.accent} style={{ flexShrink: 1 }}>{copy.mix}</Txt>
        </Pressable>}
        <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/train")} style={({ pressed }) => [styles.textAction, { opacity: pressed ? 0.6 : 1 }]}>
          <Txt variant="bodyStrong" color={t.c.accent} style={{ flexShrink: 1 }}>{copy.allModes}</Txt>
          <Icon name="chevron" size={18} color={t.c.accent} />
        </Pressable>
      </View>

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="scroll" size={20} color={t.c.gold} />
              <Txt variant="label">{tr("quest.title")}</Txt>
            </View>
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
            accessibilityLabel={tr("home.beltTest")}
            style={({ pressed }) => [
              styles.examBtn,
              {
                backgroundColor: t.c.fireSoft,
                borderRadius: t.spacing.radius,
                borderBottomWidth: pressed ? 1 : 2,
                borderBottomColor: target.edge,
              },
              pressed ? { transform: [{ translateY: 1 }] } : null,
            ]}
          >
            <BeltKnot belt={target} size={40} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle" color={t.c.ink}>
                {tr("exam.btnTitle", { belt: beltName(target, lang) })}
              </Txt>
              <Txt variant="secondary" color={t.c.ink} style={{ opacity: 0.8 }}>
                {allowed ? tr("exam.btnSub") : tr("exam.tomorrow")}
              </Txt>
            </View>
          </Pressable>
        );
      })()}

      {/* Level check (store/levelCheck.ts): the periodic "переаттестация" invite to the full Level
          Test — first after real practice accumulates, then quarterly. One ritual card at a time:
          hidden while the belt exam is offered (the exam is the more urgent ceremony). */}
      {(() => {
        if (examOffer(progress)) return null;
        const due = levelCheckDue(progress, isoDay(new Date()));
        if (!due) return null;
        return (
          <Pressable
            onPress={() => router.push("/level-test")}
            accessibilityRole="button"
            accessibilityLabel={tr("lt.entry")}
            style={({ pressed }) => [
              styles.examBtn,
              {
                backgroundColor: t.c.surface,
                borderRadius: t.spacing.radius,
                borderWidth: 1,
                borderColor: t.c.line,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Icon name="target" size={28} color={t.c.accent} />
            <View style={{ flex: 1 }}>
              <Txt variant="cardTitle">
                {tr(due === "first" ? "home.lcFirstTitle" : "home.lcQuarterTitle")}
              </Txt>
              <Txt variant="secondary" color={t.c.ink2}>
                {tr(due === "first" ? "home.lcFirstSub" : "home.lcQuarterSub")}
              </Txt>
            </View>
          </Pressable>
        );
      })()}

      {/* Belt journey = the course track: tap a unit to READ ITS RULE first (Presentation, PPP),
          then drill from the card's CTA; the belt-test node opens the exam. Locked units (past the
          mastery gate) stay non-tappable. */}
      <JourneyPath
        onSelect={(node: PathNode) => {
          if (node.state === "test") router.push("/belt-exam");
          else if (node.state === "ready" && node.topic)
            router.push({ pathname: "/checkpoint", params: { topic: node.topic.id } }); // зачёт awaits
          else if (node.state === "review" && node.topic)
            router.push({ pathname: "/checkpoint", params: { topic: node.topic.id } }); // переаттестация (the screen self-detects recert mode)
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

      {/* Broken-streak repair offer (loss aversion): visible while the repair window is open */}
      <StreakRepairSheet belt={bp.belt} />

      {/* One-shot timed offer (FOMO with an honest clock) */}
      {access.sync && <OfferBanner />}

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

      {/* Daily contracts (engagement v2): the come-back-every-day + earn-varied hook.
          Account-only — the koku economy is server-authoritative, so guests don't see it. */}
      {access.sync && <ContractsCard />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: 12, paddingBottom: 6, gap: 20 },
  roomLabel: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, minHeight: 92, borderTopWidth: 1, borderBottomWidth: 1 },
  secondaryActions: { flexDirection: "row", flexWrap: "wrap", columnGap: 24, marginBottom: 6 },
  textAction: { minHeight: 48, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 4 },
  examBtn: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 64 },
});
