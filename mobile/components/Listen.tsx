// Listening cards (аудирование в ежедневке): listen-and-answer (hear a passage → tap the fact) and
// listen-and-retell (hear a passage → type it in your own words; LLM-graded on content coverage).
// The passage lives in `exercise.speak` and is READ ALOUD via on-device TTS, never shown — except
// as a graceful degrade: on a client built before expo-speech was added the native call throws, and
// a listening card with no audio is unsolvable, so we reveal the transcript (it becomes a reading
// card rather than a dead one). No microphone anywhere here — playback only, no voice consent gate.
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import * as Speech from "expo-speech";
import type { ExerciseProps } from "./types";
import MultipleChoice from "./MultipleChoice";
import { useI18n } from "../store/i18n";
import { useTheme } from "../theme/theme";
import Button from "./ui/Button";
import Card from "./ui/Card";
import DataGuard from "./ui/DataGuard";
import Txt from "./ui/Txt";

export default function Listen({ exercise, locked, onChange }: ExerciseProps) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [revealed, setRevealed] = useState(false); // TTS unavailable → transcript shown instead
  const [retell, setRetell] = useState("");

  const play = useCallback(() => {
    if (!exercise.speak) return;
    try {
      Speech.stop();
      Speech.speak(exercise.speak, { language: "en-US", rate: 0.95 });
    } catch {
      setRevealed(true); // un-rebuilt client: no audio module — degrade to a visible transcript
    }
  }, [exercise.speak]);

  // Auto-play once when the card lands (replayable via the button); stop any in-flight speech when
  // the card unmounts so audio can't bleed into the next exercise.
  useEffect(() => {
    play();
    return () => {
      try {
        Speech.stop();
      } catch {
        // noop — nothing to stop on clients without the module
      }
    };
  }, [play]);

  function changeRetell(text: string) {
    setRetell(text);
    const trimmed = text.trim();
    onChange(trimmed ? trimmed : null, trimmed);
  }

  return (
    <View style={styles.wrap}>
      <Card style={{ backgroundColor: t.c.surface2, alignItems: "center", gap: 8 }}>
        <Txt variant="secondary" color={t.c.ink3}>{tr("lt.listenHint")}</Txt>
        <Button label={tr("lt.playAudio")} variant="ghost" onPress={play} />
        {revealed && !!exercise.speak && (
          <View style={{ gap: 4, alignSelf: "stretch" }}>
            <Txt variant="caption" color={t.c.ink3}>{tr("ex.transcriptShown")}</Txt>
            <Txt variant="body" color={t.c.ink}>{exercise.speak}</Txt>
          </View>
        )}
      </Card>

      {exercise.type === "listen-and-retell" ? (
        <View style={styles.wrap}>
          <Txt variant="cardTitle" style={{ fontSize: 19, lineHeight: 26 }}>
            {tr("ex.retellPrompt")}
          </Txt>
          <TextInput
            value={retell}
            onChangeText={changeRetell}
            placeholder={tr("ex.retellPlaceholder")}
            placeholderTextColor={t.c.ink3}
            editable={!locked}
            multiline
            textAlignVertical="top"
            accessibilityLabel={tr("ex.retellPrompt")}
            style={[styles.input, { color: t.c.ink, backgroundColor: t.c.surface, borderColor: t.c.line2 }]}
          />
          <DataGuard />
        </View>
      ) : (
        // listen-and-answer: the question + options are a plain multiple-choice interaction.
        <MultipleChoice exercise={exercise} locked={locked} onChange={onChange} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
});
