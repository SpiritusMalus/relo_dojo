import { DEFAULT_PROGRESS } from "../progress";
import { CURRICULUM } from "../curriculum";
import { learningGoalRoute, nextLearningGoal } from "../nextLearningGoal";
import type { Mistake } from "../mistakes";

const now = "2026-11-01T12:00:00.000Z";
const card = (due?: string): Mistake => ({ id: "miss", topic: "articles", missedAt: now, misses: 1, due, exercise: {} as Mistake["exercise"] });

test("the actual due deck outranks a ready course checkpoint", () => {
  const progress = { ...DEFAULT_PROGRESS, course: { mastered: [], history: { "word order": Array.from({ length: 10 }, () => ({ c: true, f: "build-the-sentence" })) } } };
  const goal = nextLearningGoal(progress, [card(now)], now);
  expect(goal).toMatchObject({ kind: "review", dueCount: 1, topic: "articles" });
  expect(learningGoalRoute(goal)).toEqual({ pathname: "/review" });
});

test("future reviews stay scheduled and do not displace today's course practice", () => {
  const goal = nextLearningGoal(DEFAULT_PROGRESS, [card("2026-11-04T08:00:00.000Z")], now);
  expect(goal).toMatchObject({ kind: "course", topic: "word order", dueCount: 0, nextReviewAt: "2026-11-04T08:00:00.000Z" });
});

test("legacy unscheduled mistakes are actually due", () => {
  expect(nextLearningGoal(DEFAULT_PROGRESS, [card()], now).kind).toBe("review");
});

test("XP and estimated placement do not open a checkpoint or skip a course gate", () => {
  const progress = { ...DEFAULT_PROGRESS, xp: 90000, skill: { "word order": 5 }, course: { mastered: [], history: {} } };
  expect(nextLearningGoal(progress, [], now)).toMatchObject({ kind: "course", topic: "word order" });
});

test("a checkpoint needs the existing unaided and constructive-format evidence", () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ c: i < 8, f: i < 2 ? "build-the-sentence" : "multiple-choice" }));
  const progress = { ...DEFAULT_PROGRESS, course: { mastered: [], history: { "word order": history } } };
  const goal = nextLearningGoal(progress, [], now);
  expect(goal.kind).toBe("checkpoint");
  expect(learningGoalRoute(goal)).toEqual({ pathname: "/checkpoint", params: { topic: "word order" } });
  const hinted = { ...progress, course: { ...progress.course, history: { "word order": history.map((mark) => ({ ...mark, c: false })) } } };
  expect(nextLearningGoal(hinted, [], now).kind).toBe("course");
});

test("only a passed checkpoint advances to the next unit", () => {
  const progress = { ...DEFAULT_PROGRESS, course: { history: {}, mastered: ["word order"] } };
  expect(nextLearningGoal(progress, [], now)).toMatchObject({ kind: "course", topic: "prepositions" });
});

test("after the course, a practiced weak topic is a useful goal; otherwise offer the mix", () => {
  const progress = { ...DEFAULT_PROGRESS, course: { history: {}, mastered: CURRICULUM.map((u) => u.topic) } };
  expect(nextLearningGoal(progress, [], now).kind).toBe("mix");
  const weak = nextLearningGoal({ ...progress, topics: { articles: { correct: 1, attempts: 4 } } }, [], now);
  expect(learningGoalRoute(weak)).toEqual({ pathname: "/practice", params: { topic: "articles" } });
});
