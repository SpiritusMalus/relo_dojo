import type { Exercise, ResponseValue } from "../services/api";

// Every exercise component reports the user's current answer up to the parent:
//  - `value` is the type-appropriate response (null while incomplete / not submittable)
//  - `display` is a human-readable rendering used for the "Explain" call and recaps
export type AnswerHandler = (value: ResponseValue | null, display: string) => void;

export type ExerciseProps = {
  exercise: Exercise;
  locked: boolean; // true once an answer has been submitted
  onChange: AnswerHandler;
};
