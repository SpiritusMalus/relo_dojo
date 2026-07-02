"""Level Test writing section — assess_writing(): CEFR placement of a short written response.
Offline (generate_json mocked). Pins the prompt language, the band→score map, and the conservative
fallback when the model returns an unparseable band."""

from app.services import _grammar_feedback as fb


def _fake_json(payload, seen=None):
    async def _fake(prompt, schema, temperature=0.0):  # noqa: ANN001 — matches generate_json
        if seen is not None:
            seen["prompt"] = prompt
        return payload

    return _fake


async def test_maps_cefr_band_to_fixed_score(monkeypatch):
    monkeypatch.setattr(fb, "generate_json", _fake_json({"cefr": "B2", "note": "Vary your linking words."}))
    out = await fb.assess_writing("Although the project was complex, we delivered it on time.")
    assert out["cefr"] == "B2"
    assert out["score"] == 3.5  # fixed midpoint, not an LLM-invented float
    assert out["note"]


async def test_note_language_follows_lang(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(fb, "generate_json", _fake_json({"cefr": "A2", "note": "Используй прошедшее время."}, seen))
    out = await fb.assess_writing("I go shop yesterday.", prompt="Describe your weekend.", lang="ru")
    assert "Russian" in seen["prompt"]
    assert "Describe your weekend." in seen["prompt"]  # the task is given to the examiner
    assert out["cefr"] == "A2"


async def test_band_anchors_reach_the_examiner_prompt(monkeypatch):
    # The rubric anchors must ride in the prompt — they are what pins the band decision to stated
    # criteria (rather than the model's own idea of "B1").
    seen: dict = {}
    monkeypatch.setattr(fb, "generate_json", _fake_json({"cefr": "B1", "note": "ok"}, seen))
    await fb.assess_writing("We should have tested it before the release.")
    assert fb.WRITING_BAND_ANCHORS in seen["prompt"]
    for band in fb.WRITING_CEFR:  # one anchor line per gradable band
        assert f"{band}:" in seen["prompt"]


async def test_unparseable_band_falls_back_to_floor(monkeypatch):
    # A garbled / out-of-range band must never over-credit — floor to A1.
    monkeypatch.setattr(fb, "generate_json", _fake_json({"cefr": "C2-ish", "note": ""}))
    out = await fb.assess_writing("asdf")
    assert out["cefr"] == "A1"
    assert out["score"] == 0.5
