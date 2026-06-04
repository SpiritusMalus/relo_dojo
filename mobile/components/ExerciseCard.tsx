import BuildSentence from "./BuildSentence";
import FreeText from "./FreeText";
import MatchPairs from "./MatchPairs";
import MultipleChoice from "./MultipleChoice";
import TapError from "./TapError";
import type { ExerciseProps } from "./types";

// Renders the right interactive component for the exercise's type.
export default function ExerciseCard(props: ExerciseProps) {
  switch (props.exercise.type) {
    case "multiple-choice":
      return <MultipleChoice {...props} />;
    case "build-the-sentence":
      return <BuildSentence {...props} />;
    case "match-pairs":
      return <MatchPairs {...props} />;
    case "tap-the-error":
      return <TapError {...props} />;
    case "free-text":
      return <FreeText {...props} />;
    default:
      return <MultipleChoice {...props} />;
  }
}
