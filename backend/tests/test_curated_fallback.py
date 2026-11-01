"""All safety-net keys are visible choices and use the same production sealed-token grader."""
import pytest

from app.services import tokens
from app.services.curated_fallback import BANK, build_fallback
from app.services._grammar_grading import grade
from app.services._grammar_prompts import TOPICS


@pytest.mark.parametrize("item", BANK, ids=lambda item: f"{item.topic}-{item.level}")
def test_every_curated_item_has_a_sealed_unique_key_and_no_incorrect_option_passes(item):
    card = build_fallback(item.topic, item.level)
    assert card["text"].count("___") == 1
    assert len(card["options"]) == len(set(card["options"])) == 4
    assert "answer" not in card
    sealed = tokens.unseal(card["token"])
    assert sealed["answer"] in card["options"]
    assert grade(sealed, sealed["answer"])["correct"] is True
    assert all(not grade(sealed, option)["correct"] for option in card["options"] if option != sealed["answer"])


def test_all_existing_topics_have_a_safety_net():
    topics = {topic for topic, _weight in TOPICS}
    assert {item.topic for item in BANK} == topics


def test_safety_net_preserves_its_actual_difficulty_instead_of_claiming_c1():
    card = build_fallback("articles", "C1")
    assert card["level"] == "B2"
    assert card["source"] == "curated"
    assert build_fallback("unknown", "C1") is None
