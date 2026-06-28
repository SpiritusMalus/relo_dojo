"""Mini-story assembly (app.services.stories.build_story) — with the LLM generator mocked out."""

from app.services import grammar, stories


def _fake_exercise(topic, level=None, ex_type=None, context=None, mistakes=None, lang=None):
    """Stand-in for grammar.generate_exercise: returns a valid-shaped exercise without an LLM call."""

    async def _coro():
        return {
            "type": "multiple-choice",
            "topic": topic,
            "level": grammar._cefr(level),
            "text": f"context={context}",
            "options": ["a", "an"],
            "token": "sealed-token",
        }

    return _coro()


async def test_build_story_returns_three_linked_beats(monkeypatch):
    monkeypatch.setattr(grammar, "generate_exercise", _fake_exercise)

    story = await stories.build_story(level="B1")

    assert story["id"] and story["title"] and story["intro"]
    assert story["level"] == "B1"
    assert len(story["beats"]) == stories.STORY_LEN == 3
    for beat in story["beats"]:
        assert "narration" in beat
        assert beat["exercise"]["token"] == "sealed-token"
        # every beat is flavored with the shared scenario context
        assert beat["exercise"]["text"].startswith("context=")


async def test_build_story_varies_topic_across_beats(monkeypatch):
    monkeypatch.setattr(grammar, "generate_exercise", _fake_exercise)
    story = await stories.build_story(level="A2")
    topics = [b["exercise"]["topic"] for b in story["beats"]]
    # scenarios define 3 topics; beats should not be a single repeated topic
    assert len(set(topics)) > 1


async def test_context_override_is_used(monkeypatch):
    monkeypatch.setattr(grammar, "generate_exercise", _fake_exercise)
    story = await stories.build_story(level="B1", context_override="my custom scenario")
    assert all("my custom scenario" in b["exercise"]["text"] for b in story["beats"])


def test_explain_lang_picks_russian_or_english():
    assert grammar._explain_lang("ru") == "Russian"
    assert grammar._explain_lang("RU") == "Russian"
    assert grammar._explain_lang("en") == "English"
    assert grammar._explain_lang(None) == "English"
    assert grammar._explain_lang("") == "English"
