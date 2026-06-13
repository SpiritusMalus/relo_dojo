"""Stage 3 "Review my text" — offline tests: prompt assembly, output sanitization, profile feed."""

from app.schemas import LearnerProfileData
from app.services import grammar
from app.services import _grammar_feedback
from app.services.grammar import REVIEW_MAX_ISSUES, TONE_LINES, _review_prompt
from app.services.learner_profile import apply_review


def test_review_prompt_threads_text_tone_history_lang():
    p = _review_prompt("I has wrote to my boss", lang="ru", tone="strict", weak_spots="verb tenses")
    assert "I has wrote to my boss" in p
    assert TONE_LINES["strict"] in p
    assert "verb tenses" in p
    assert "Russian" in p
    assert grammar.GUARDRAIL in p


async def test_review_text_sanitizes_output(monkeypatch):
    async def fake_generate_json(prompt, schema, *, temperature=None):
        return {
            "summary": "  Good start!  ",
            "issues": [
                {"quote": "I has", "better": "I have", "topic": "verb sequence (tense agreement)", "note": "n"},
                {"quote": "", "better": "x", "topic": "articles", "note": ""},  # empty quote → dropped
                {"quote": "a", "better": "b", "topic": "NOT A TOPIC", "note": ""},  # bad topic → dropped
            ]
            + [{"quote": f"q{i}", "better": "b", "topic": "articles", "note": ""} for i in range(10)],
        }

    # review_text calls generate_json inside the feedback module — patch it where it is used.
    monkeypatch.setattr(_grammar_feedback, "generate_json", fake_generate_json)
    result = await grammar.review_text("text", lang="en")
    assert result["summary"] == "Good start!"
    assert len(result["issues"]) == REVIEW_MAX_ISSUES  # capped
    assert result["issues"][0]["better"] == "I have"
    topics = {i["topic"] for i in result["issues"]}
    assert "NOT A TOPIC" not in topics


def test_apply_review_writes_weak_spots_and_keeps_them_on_empty():
    data = LearnerProfileData(weakSpots="old summary")
    apply_review(data, [], today="2026-06-11")
    assert data.weakSpots == "old summary"  # no findings → don't clear memory
    apply_review(data, ["articles", "prepositions", "articles"], today="2026-06-11")
    assert data.weakSpots == "Text review 2026-06-11: issues with articles, prepositions"
