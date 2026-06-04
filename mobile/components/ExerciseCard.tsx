import BuildSentence from "./BuildSentence";
import FreeText from "./FreeText";
import MatchPairs from "./MatchPairs";
import MultipleBlanks from "./MultipleBlanks";
import MultipleChoice from "./MultipleChoice";
import OrderDialog from "./OrderDialog";
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
    case "odd-one-out":
      // Same interaction as multiple-choice (tap one option); only the prompt differs.
      return <MultipleChoice {...props} />;
    case "multiple-blanks":
      return <MultipleBlanks {...props} />;
    case "order-the-dialog":
      return <OrderDialog {...props} />;
    case "free-text":
      return <FreeText {...props} />;
    default:
      return <MultipleChoice {...props} />;
  }
}
