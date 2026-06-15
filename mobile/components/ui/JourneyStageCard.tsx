import { useEffect, useState } from "react";
import { View } from "react-native";
import { useI18n } from "../../store/i18n";
import { trackJourneyAdvanced } from "../../services/analytics";
import { useTheme } from "../../theme/theme";
import Card from "./Card";
import Txt from "./Txt";
import Button from "./Button";
import {
  JOURNEY_STAGES,
  type JourneyStage,
  type JourneyState,
  advanceAndSave,
  defaultJourney,
  hasJourneyGoal,
  isLastStage,
  loadJourney,
  nextStage,
  shouldSuggestAdvance,
} from "../../store/journey";

// Relocation-journey card (NICHE_PIVOT_IT_RELOCATION.md — retention). Shows the learner's current
// stage on the pre-move → arrived → settled arc and gently offers to advance once they've invested
// enough sessions — the come-back hook that carries them from the interview event-need to the
// recurring workplace need. Renders only for learners on the niche (who picked a journey goal).
// Local-only state (store/journey.ts); advancing is always the learner's tap, never forced.
export default function JourneyStageCard({ goals }: { goals?: string[] | null }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [journey, setJourney] = useState<JourneyState | null>(null);

  useEffect(() => {
    let active = true;
    loadJourney().then((j) => {
      if (active) setJourney(j ?? defaultJourney(goals));
    });
    return () => {
      active = false;
    };
  }, [goals]);

  if (!hasJourneyGoal(goals) || !journey) return null;

  // Literal keys (the i18n `t` is strictly typed, so no dynamic key strings).
  const stageLabel = (s: JourneyStage): string =>
    s === "pre_move" ? tr("journey.stagePreMove") : s === "arrived" ? tr("journey.stageArrived") : tr("journey.stageSettled");

  const idx = JOURNEY_STAGES.indexOf(journey.stage);
  const last = isLastStage(journey.stage);

  return (
    <Card>
      <Txt variant="cardTitle">{tr("prog.journeyTitle")}</Txt>
      {/* arc progress */}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 8 }}>
        {JOURNEY_STAGES.map((s, i) => (
          <View
            key={s}
            style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= idx ? t.c.accent : t.c.line2 }}
          />
        ))}
      </View>
      <Txt variant="body" color={t.c.ink2}>
        {tr("prog.journeyNow", { stage: stageLabel(journey.stage) })}
      </Txt>

      {!last && shouldSuggestAdvance(journey) && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Txt variant="secondary" color={t.c.ink3}>
            {tr("prog.journeyNudge", { stage: stageLabel(nextStage(journey.stage)) })}
          </Txt>
          <Button
            label={tr("prog.journeyAdvance", { stage: stageLabel(nextStage(journey.stage)) })}
            onPress={async () => {
              const from = journey.stage;
              const next = await advanceAndSave(journey);
              trackJourneyAdvanced({ from, to: next.stage });
              setJourney(next);
            }}
          />
        </View>
      )}
      {last && (
        <Txt variant="secondary" color={t.c.ink3} style={{ marginTop: 8 }}>
          {tr("prog.journeySettled")}
        </Txt>
      )}
    </Card>
  );
}
