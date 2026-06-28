"""Learner-facing explanations follow the UI language (explanation-lang-ru).

Part B of the task: the explanation/tip/feedback prompts already received `lang`, but a trailing
"write in Russian" line is easily ignored by a weaker model under a long English prompt. These pin
the prominent up-front output-language directive (`_lang_directive`) onto every feedback prompt, and
the back-compat default (no lang → English).
"""

from app.services._grammar_feedback import (
    _check_prompt,
    _lang_directive,
    _review_prompt,
    explain_text_prompt,
)


def test_lang_directive_names_russian_for_ru():
    d = _lang_directive("ru")
    assert "OUTPUT LANGUAGE" in d
    assert "Russian" in d


def test_lang_directive_defaults_to_english():
    assert "English" in _lang_directive(None)
    assert "Russian" not in _lang_directive(None)
    assert "English" in _lang_directive("en")


def test_check_prompt_carries_the_russian_directive():
    p = _check_prompt("She ___ to work.", "go", lang="ru")
    # The up-front directive AND the trailing inline instruction both ask for Russian.
    assert "OUTPUT LANGUAGE" in p
    assert "Russian" in p


def test_check_prompt_defaults_to_english():
    p = _check_prompt("She ___ to work.", "go")
    assert "Russian" not in p
    assert "English" in p


def test_explain_stream_prompt_carries_the_russian_directive():
    p = explain_text_prompt("She ___ to work.", "goes", "go", lang="ru")
    assert "OUTPUT LANGUAGE" in p
    assert "Russian" in p


def test_review_prompt_carries_the_russian_directive():
    p = _review_prompt("I has wrote to my boss", lang="ru")
    assert "OUTPUT LANGUAGE" in p
    assert "Russian" in p
