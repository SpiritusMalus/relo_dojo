"""writing_set.json sanity — the writing-judge eval data must stay well-formed: valid bands,
adjacent-band tolerance only, and full band coverage. Pure file checks, no LLM."""

from __future__ import annotations

import json
from pathlib import Path

from app.services._grammar_feedback import WRITING_CEFR

SET = json.loads((Path(__file__).resolve().parents[1] / "evals" / "writing_set.json").read_text())


def test_items_are_well_formed():
    items = SET["items"]
    assert len(items) >= 15  # enough essays for a meaningful accuracy figure
    ids = [i["id"] for i in items]
    assert len(ids) == len(set(ids))
    for it in items:
        assert it["text"].strip() and it["prompt"].strip() and it["note"].strip(), it["id"]
        assert it["expected"], it["id"]
        assert set(it["expected"]) <= set(WRITING_CEFR), it["id"]


def test_expected_bands_are_adjacent():
    # Tolerance may only span NEIGHBORING bands (A2/B1, not A2/B2) — a wider window would let a
    # grossly misgrading judge pass the eval.
    order = {b: i for i, b in enumerate(WRITING_CEFR)}
    for it in SET["items"]:
        idxs = sorted(order[b] for b in it["expected"])
        assert idxs[-1] - idxs[0] == len(idxs) - 1, f"{it['id']}: non-adjacent tolerance"


def test_every_band_is_covered():
    covered: set[str] = set()
    for it in SET["items"]:
        covered |= set(it["expected"])
    assert covered == set(WRITING_CEFR)
