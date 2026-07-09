import BuildSentence from "./BuildSentence";
import FreeText from "./FreeText";
import Listen from "./Listen";
import MatchPairs from "./MatchPairs";
import MultipleBlanks from "./MultipleBlanks";
import MultipleChoice from "./MultipleChoice";
import OrderDialog from "./OrderDialog";
import TapError from "./TapError";
import type { ExerciseProps } from "./types";
import { TranslationProvider } from "./ui/TranslationPopover";

// Renders the right interactive component for the exercise's type. Wrapped in a TranslationProvider so
// any English word inside the card can be long-pressed to see its meaning (tap-to-translate).
export default function ExerciseCard(props: ExerciseProps) {
  return <TranslationProvider>{renderBody(props)}</TranslationProvider>;
}

function renderBody(props: ExerciseProps) {
  switch (props.exercise.type) {
    case "multiple-choice":
      return <MultipleChoice {...props} />;
    case "build-the-sentence":
      return <BuildSentence {...props} />;
    case "transform-the-sentence":
      // Same tile interaction + answer shape as build-the-sentence; only the prompt header differs.
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
    case "listen-and-answer":
    case "listen-and-retell":
      // One audio-first component for both: plays `speak` via TTS, then routes to a
      // multiple-choice pick (answer) or a typed retelling (retell).
      return <Listen {...props} />;
    default:
      // Unknown/unsupported type: don't route into a component that assumes a specific array
      // field exists (that would throw during render and white out the whole screen). Render nothing.
      return null;
  }
}
