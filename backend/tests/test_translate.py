"""Tap-to-translate (`/translate`): a tapped English word → its meaning in the learner's UI language.
Offline tests — the LLM is stubbed, so these check prompt assembly + output cleaning, not the model."""

from app.services import grammar
from app.services import _grammar_feedback


async def _run_capture(monkeypatch, *, text, context=None, lang=None, returns="  результат  "):
    """Patch generate_json, run grammar.translate, return (result, captured_prompt)."""
    seen: dict[str, object] = {}

    async def fake_generate_json(prompt, schema, *, temperature=None):
        seen["prompt"] = prompt
        seen["schema"] = schema
        return {"translation": returns}

    monkeypatch.setattr(_grammar_feedback, "generate_json", fake_generate_json)
    result = await grammar.translate(text, context, lang)
    return result, seen


async def test_translate_ru_threads_context_and_targets_russian(monkeypatch):
    result, seen = await _run_capture(
        monkeypatch, text="deployment", context="The midnight deployment failed.", lang="ru"
    )
    prompt = seen["prompt"]
    assert "Russian" in prompt
    assert "deployment" in prompt
    assert "The midnight deployment failed." in prompt  # context passed for sense
    assert grammar.GUARDRAIL in prompt  # tapped text treated as data, not instructions
    assert result == {"translation": "результат"}  # trimmed


async def test_translate_en_ui_asks_for_a_definition_not_a_translation(monkeypatch):
    _, seen = await _run_capture(monkeypatch, text="deployment", lang="en")
    prompt = seen["prompt"]
    # Same-language learner: an English definition/synonym, never "translate into Russian".
    assert "definition" in prompt or "synonym" in prompt
    assert "Russian" not in prompt


async def test_translate_without_context_omits_the_context_line(monkeypatch):
    _, seen = await _run_capture(monkeypatch, text="often", lang="ru", context=None)
    assert "context only" not in seen["prompt"]


async def test_translate_defaults_to_english_when_lang_missing(monkeypatch):
    # Back-compat with the rest of the feedback system: no `lang` → English target (the client always
    # sends an explicit lang, defaulting to "ru", so a missing lang only happens for a raw API call).
    _, seen = await _run_capture(monkeypatch, text="often")
    assert "Russian" not in seen["prompt"]
    assert "definition" in seen["prompt"] or "synonym" in seen["prompt"]
