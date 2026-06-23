"""Analytics service — pure-layer tests: name/prop sanitizing, subject identity, row building,
and the Day-N retention computation. Fake DB for the ingest path (no real Postgres)."""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest

from app.services import analytics


# --- events TTL boundary (retention_cutoff) ----------------------------------
def test_retention_cutoff_disabled_returns_none():
    now = datetime(2026, 6, 13, tzinfo=timezone.utc)
    assert analytics.retention_cutoff(now, 0) is None
    assert analytics.retention_cutoff(now, -5) is None


def test_retention_cutoff_subtracts_ttl_days():
    now = datetime(2026, 6, 13, 12, 0, tzinfo=timezone.utc)
    cutoff = analytics.retention_cutoff(now, 30)
    assert cutoff == datetime(2026, 5, 14, 12, 0, tzinfo=timezone.utc)
    assert cutoff.tzinfo is timezone.utc


# --- name + prop sanitizing --------------------------------------------------
def test_normalize_name_lowercases_and_collapses():
    assert analytics.normalize_name("  Session Complete!! ") == "session_complete"
    assert analytics.normalize_name("Exercise.Answered") == "exercise.answered"
    assert analytics.normalize_name("@@@") == ""
    assert len(analytics.normalize_name("x" * 200)) == analytics.MAX_NAME_LEN
    # Truncation that lands on a separator must not leave a dangling '_'/'.' (clean namespace).
    trimmed = analytics.normalize_name("a" * 63 + ".segment")
    assert len(trimmed) <= analytics.MAX_NAME_LEN and not trimmed.endswith((".", "_"))


def test_sanitize_props_bounds_shape():
    out = analytics.sanitize_props({"topic": "x" * 500, "n": 3, "ok": True, "nested": {"a": 1}})
    assert len(out["topic"]) == analytics.MAX_PROP_STR
    assert out["n"] == 3 and out["ok"] is True
    assert "nested" not in out  # non-scalars dropped
    assert analytics.sanitize_props(None) == {}


def test_sanitize_props_caps_key_count():
    out = analytics.sanitize_props({f"k{i}": i for i in range(50)})
    assert len(out) == analytics.MAX_PROPS_KEYS


# --- subject identity --------------------------------------------------------
def test_subject_prefers_user_then_anon_then_none():
    uid = uuid.uuid4()
    assert analytics.subject_key(uid, "anon-1") == str(uid)  # user wins
    assert analytics.subject_key(None, "anon-1") == "anon-1"
    assert analytics.subject_key(None, "  ") is None
    assert analytics.subject_key(None, None) is None


def test_subject_rejects_uuid_shaped_anon_id():
    # Anti-spoofing (RD-02): an anonymous caller must not be able to set subject = a real user's UUID
    # (which would cross-attribute events / farm that user's daily contracts). A UUID-shaped anon_id
    # is dropped; the real client format ("a-<base36>-<base36>") is unaffected.
    victim = uuid.uuid4()
    assert analytics.subject_key(None, str(victim)) is None
    assert analytics.subject_key(None, str(victim).upper()) is None
    assert analytics.subject_key(None, "a-lz3k9q-x7h2m4p9") == "a-lz3k9q-x7h2m4p9"


# --- row building ------------------------------------------------------------
def test_build_event_rows_attributes_and_filters():
    uid = uuid.uuid4()
    evs = [
        SimpleNamespace(name="session_complete", props={"items": 5}),
        SimpleNamespace(name="@@@", props={}),  # normalizes to empty -> dropped
    ]
    rows = analytics.build_event_rows(evs, user_id=uid, anon_id="anon-1")
    assert len(rows) == 1
    assert rows[0].name == "session_complete"
    assert rows[0].subject == str(uid)
    assert rows[0].user_id == uid
    assert rows[0].props == {"items": 5}


def test_build_event_rows_drops_unattributable_batch():
    evs = [SimpleNamespace(name="app_open", props={})]
    assert analytics.build_event_rows(evs, user_id=None, anon_id=None) == []


# --- retention ---------------------------------------------------------------
def test_retention_counts_anniversary_return():
    # s1: active day0 and day7 -> retained. s2: active day0 only -> not retained.
    rows = [
        ("s1", date(2026, 6, 1)),
        ("s1", date(2026, 6, 8)),  # +7 -> retained
        ("s2", date(2026, 6, 1)),
        ("s2", date(2026, 6, 5)),  # came back day 4, not day 7 -> not retained
    ]
    r = analytics.compute_retention(rows, day_n=7)
    assert r["cohort"] == 2
    assert r["retained"] == 1
    assert r["rate"] == 0.5
    assert r["day_n"] == 7


def test_retention_excludes_subjects_too_recent_to_judge():
    # Only one subject, anchored on the latest day -> day7 window hasn't elapsed -> excluded.
    rows = [("s1", date(2026, 6, 8))]
    r = analytics.compute_retention(rows, day_n=7)
    assert r["cohort"] == 0
    assert r["rate"] == 0.0


def test_retention_empty_is_safe():
    assert analytics.compute_retention([], day_n=7) == {
        "cohort": 0,
        "retained": 0,
        "rate": 0.0,
        "day_n": 7,
    }


def test_retention_accepts_datetime_and_iso_string():
    from datetime import datetime

    rows = [
        ("s1", datetime(2026, 6, 1, 9, 0)),
        ("s1", "2026-06-08"),
        ("s2", datetime(2026, 6, 1, 10, 0)),
        ("s2", "2026-06-05"),
    ]
    r = analytics.compute_retention(rows, day_n=7)
    assert r["cohort"] == 2 and r["retained"] == 1
