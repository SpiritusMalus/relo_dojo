import { ApiError, getExercise, setAuthToken, type Exercise } from "../api";
import { getPersonalPracticeExercise, personalPracticeTargets } from "../personalPractice";
import { consumeGuestExercise, GUEST_DAILY_LIMIT, loadGuestLimit, resetGuestLimit } from "../../store/guestLimit";
import type { Mistake } from "../../store/mistakes";
import { localDate } from "../../store/streak";

jest.mock("../api", () => ({ ...jest.requireActual("../api"), getExercise: jest.fn() }));

const fetchExercise = jest.mocked(getExercise);

function card(overrides: Partial<Exercise> = {}): Exercise {
  return {
    topic: "prepositions", level: "B1", type: "multiple-choice",
    text: "I arrived ___ noon.", prompt: "", options: ["at", "in", "on"],
    tiles: [], tokens: [], left: [], right: [], blankOptions: [],
    token: "issued",
    ...overrides,
  };
}

function miss(exercise: Exercise, misses = 1, date = "2026-11-26"): Mistake {
  return { id: exercise.text, exercise, topic: exercise.topic, misses, missedAt: date };
}

const signal = () => new AbortController().signal;
const target = () => personalPracticeTargets([], "B1", "prepositions")[0];

beforeEach(async () => {
  setAuthToken(null);
  fetchExercise.mockReset();
  await resetGuestLimit();
});

afterEach(() => { jest.useRealTimers(); });

test("ranks concrete misses and keeps a requested writing topic available without a saved card", () => {
  const recent = miss(card({ topic: "articles", level: "B2" }), 1, "2026-11-27");
  const old = miss(card({ level: "A2" }), 4, "2026-11-25");
  const invalid = miss(card({ topic: "other" }), 25);
  const list = [recent, old, invalid];
  expect(personalPracticeTargets(list, "C1")).toEqual([
    { topic: "prepositions", level: "A2", mistakes: [old] },
    { topic: "articles", level: "B2", mistakes: [recent] },
  ]);
  expect(personalPracticeTargets(list, "C1", "word order")[0])
    .toEqual({ topic: "word order", level: "C1", mistakes: [] });
  expect(personalPracticeTargets([], "invalid", "unknown")).toEqual([]);
});

test("drills saved hints while refusing the same sentence with restyled text or rearranged choices", async () => {
  const source = card();
  const repeated = card({ text: "I ARRIVED ____ noon!", options: ["in", "on", "at"] });
  const fresh = card({ text: "The lesson starts ___ a quarter past three." });
  fetchExercise.mockResolvedValueOnce(repeated).mockResolvedValueOnce(fresh);

  const result = await getPersonalPracticeExercise(personalPracticeTargets([miss(source)], "B1")[0], "practice", [], signal());
  expect(result).toEqual(fresh);
  expect(fetchExercise).toHaveBeenCalledTimes(2);
  expect(fetchExercise.mock.calls[0][0]).toMatchObject({
    topic: "prepositions", level: "B1", type: "multiple-choice", mistakes: [source.text], assessment: false,
  });
  expect(fetchExercise.mock.calls[0][0]?.practice_index).not.toBe(fetchExercise.mock.calls[1][0]?.practice_index);
});

test("requires a fresh assessment even when an old filled choice is rearranged into tiles", async () => {
  const practiced = card({ text: "They ___ at home.", options: ["are", "is", "was"] });
  const source = card({ text: "Wait ___ me." });
  const repeated = card({
    type: "build-the-sentence", text: "Translate into English:", prompt: "Они дома.",
    tiles: ["at", "home", "are", "They."],
  });
  const fresh = card({
    type: "tap-the-error", text: "Tap the incorrect word", tokens: ["She", "listens", "at", "the", "radio."],
  });
  const fillers = [card({ text: "The ship is ___ the quay." }), card({ text: "Stand ___ the corner." })];
  fetchExercise.mockResolvedValueOnce(repeated).mockResolvedValueOnce(fresh);

  const result = await getPersonalPracticeExercise(
    personalPracticeTargets([miss(source)], "B1")[0], "test", [...fillers, practiced], signal(),
  );
  expect(result).toEqual(fresh);
  expect(fetchExercise.mock.calls.map(([params]) => params?.type)).toEqual(["build-the-sentence", "tap-the-error"]);
  for (const [params] of fetchExercise.mock.calls) {
    expect(params).toMatchObject({ assessment: true });
    expect(params?.mistakes).toBeUndefined();
  }
});

test("refuses the same finished sentence when a practice gap becomes multiple assessment gaps", async () => {
  const practiced = card({ text: "She was born ___ May.", options: ["in", "on", "at"] });
  const repeated = card({
    type: "multiple-blanks", text: "She ___ born ___ May!", blankOptions: [["is", "was"], ["at", "in"]],
  });
  const fresh = card({
    type: "build-the-sentence", text: "Translate into English:",
    prompt: "Мы встретились утром.", tiles: ["the", "met", "We", "morning", "in"],
  });
  fetchExercise.mockResolvedValueOnce(repeated).mockResolvedValueOnce(fresh);

  await expect(getPersonalPracticeExercise(target(), "test", [practiced, card()], signal())).resolves.toEqual(fresh);
  expect(fetchExercise.mock.calls.map(([params]) => params?.type)).toEqual(["multiple-blanks", "build-the-sentence"]);
});

test("refuses oversized blank sets instead of expanding unbounded combinations", async () => {
  fetchExercise
    .mockResolvedValueOnce(card({
      type: "multiple-blanks", text: "___ ___ ___ ___ ___ ___",
      blankOptions: Array.from({ length: 6 }, () => ["a", "the"]),
    }))
    .mockResolvedValueOnce(card({
      type: "build-the-sentence", text: "Translate into English:",
      prompt: "Мы встретились утром.", tiles: ["the", "met", "We", "morning", "in"],
    }));

  const result = await getPersonalPracticeExercise(target(), "test", [card(), card()], signal());
  expect(result.type).toBe("build-the-sentence");
  expect(fetchExercise).toHaveBeenCalledTimes(2);
});

test("refuses a changed topic or level and stops after three unusable responses", async () => {
  fetchExercise
    .mockResolvedValueOnce(card({ topic: "articles" }))
    .mockResolvedValueOnce(card({ level: "A2" }))
    .mockResolvedValueOnce(card({ token: null }));
  await expect(getPersonalPracticeExercise(target(), "practice", [], signal()))
    .rejects.toMatchObject({ code: "personal_practice_unavailable" });
  expect(fetchExercise).toHaveBeenCalledTimes(3);
});

test("charges guests only for an accepted card and stops before generation at the shared cap", async () => {
  const today = localDate(new Date());
  for (let used = 0; used < GUEST_DAILY_LIMIT - 1; used++) await consumeGuestExercise(today);
  const source = card();
  const fresh = card({ text: "The lesson starts ___ three." });
  fetchExercise.mockResolvedValueOnce(source).mockResolvedValueOnce(fresh);

  await expect(getPersonalPracticeExercise(personalPracticeTargets([miss(source)], "B1")[0], "practice", [], signal()))
    .resolves.toEqual(fresh);
  expect(await loadGuestLimit()).toEqual({ day: today, used: GUEST_DAILY_LIMIT });
  await expect(getPersonalPracticeExercise(target(), "practice", [], signal()))
    .rejects.toMatchObject({ status: 403, code: "daily_limit" });
  expect(fetchExercise).toHaveBeenCalledTimes(2);
});

test.each([
  [0, "learning_offline"], [403, "daily_limit"],
])("preserves request status %s with code %s", async (status, code) => {
  fetchExercise.mockRejectedValueOnce(new ApiError("Upstream error", status, code));
  await expect(getPersonalPracticeExercise(target(), "practice", [], signal())).rejects.toMatchObject({ status, code });
  expect(fetchExercise).toHaveBeenCalledTimes(1);
});

test("a target from a previous account cannot send its mistakes", async () => {
  const previous = personalPracticeTargets([miss(card())], "B1")[0];
  setAuthToken("opaque-token");
  await expect(getPersonalPracticeExercise(previous, "practice", [], signal()))
    .rejects.toMatchObject({ code: "session_changed" });
  expect(fetchExercise).not.toHaveBeenCalled();
});

test("uses a single deadline for all candidates and cancels a pending retry", async () => {
  jest.useFakeTimers();
  const source = card();
  fetchExercise
    .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(source), 60_000)))
    .mockImplementationOnce(() => new Promise(() => {}));

  const pending = getPersonalPracticeExercise(personalPracticeTargets([miss(source)], "B1")[0], "practice", [], signal());
  const failure = expect(pending).rejects.toMatchObject({ code: "learning_timeout" });
  await jest.advanceTimersByTimeAsync(60_000);
  expect(fetchExercise).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(10_000);
  await failure;
  expect(fetchExercise.mock.calls[1][1]?.aborted).toBe(true);
});
