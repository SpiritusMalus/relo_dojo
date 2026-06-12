import { DEFAULT_PROGRESS, type Progress } from "../progress";
import { buildRecap, tickDiary, type DiaryState } from "../diary";

const WEEK_START = "2026-06-05";
const TODAY = "2026-06-12"; // exactly 7 days later

function base(over: Partial<Progress> = {}): Progress {
  return {
    ...DEFAULT_PROGRESS,
    onboarded: true,
    xp: 500,
    topics: { articles: { attempts: 20, correct: 15 }, prepositions: { attempts: 10, correct: 4 } },
    profile: {
      goals: [],
      focusTopics: [],
      selfLevel: "intermediate",
      dailyMinutes: 10,
      sphere: "",
      domains: [],
      painText: "",
    },
    ...over,
  };
}

function diaryAt(over: Partial<DiaryState> = {}): DiaryState {
  return {
    date: WEEK_START,
    baseXp: 300,
    baseTopics: { articles: { attempts: 10, correct: 8 }, prepositions: { attempts: 6, correct: 3 } },
    ...over,
  };
}

describe("tickDiary", () => {
  it("starts the first baseline silently (no recap)", () => {
    const d = tickDiary(base(), TODAY);
    expect(d).toMatchObject({ date: TODAY, baseXp: 500 });
    expect(d!.last).toBeUndefined();
  });
  it("does nothing mid-week", () => {
    const p = base();
    p.profile = { ...p.profile!, diary: diaryAt({ date: "2026-06-10" }) };
    expect(tickDiary(p, TODAY)).toBeNull();
  });
  it("closes a finished week into a recap and re-baselines", () => {
    const p = base();
    p.profile = { ...p.profile!, diary: diaryAt() };
    const d = tickDiary(p, TODAY)!;
    expect(d.date).toBe(TODAY);
    expect(d.last).toEqual({
      from: WEEK_START,
      to: TODAY,
      xp: 200,
      correct: 8, // (15-8)+(4-3)
      slips: 6, // (20-10)+(10-6) attempts = 14, minus 8 correct
      topTopic: "articles",
    });
  });
  it("keeps the previous recap after an idle week", () => {
    const prev = { from: "x", to: "y", xp: 1, correct: 1, slips: 0, topTopic: "" };
    const p = base({ xp: 300, topics: { articles: { attempts: 10, correct: 8 } } });
    p.profile = {
      ...p.profile!,
      diary: diaryAt({ baseTopics: { articles: { attempts: 10, correct: 8 } }, baseXp: 300, last: prev }),
    };
    const d = tickDiary(p, TODAY)!;
    expect(d.last).toEqual(prev);
  });
  it("is silent before onboarding", () => {
    expect(tickDiary({ ...base(), onboarded: false }, TODAY)).toBeNull();
  });
});

describe("buildRecap", () => {
  it("never goes negative when a merge shrank counters", () => {
    const p = base({ xp: 100, topics: { articles: { attempts: 5, correct: 3 } } });
    const r = buildRecap(p, diaryAt(), TODAY);
    expect(r.xp).toBe(0);
    expect(r.correct).toBe(0);
    expect(r.slips).toBe(0);
  });
});
