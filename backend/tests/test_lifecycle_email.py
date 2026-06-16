"""Day-2 / Day-6 re-engagement email logic (app.services.lifecycle_email).

Pure-decision tests only — no DB. The data-access helpers (`select_due_recipients`, `claim_send`,
`fetch_*`) are thin SQL verified on a real Postgres via scripts/send_return_emails.py, mirroring how
analytics.purge_old_events is left to the smoke path."""

from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.services import lifecycle_email as le

W = le.Windows(day2=(2, 5), day6=(6, 12))
NOW = datetime(2026, 6, 16, 12, 0, tzinfo=timezone.utc)


# ── due_kind: window boundaries ───────────────────────────────────────────────
@pytest.mark.parametrize(
    "days,expected",
    [
        (0, None), (1, None),          # too fresh
        (2, le.RETURN_DAY2),           # day-2 lower edge
        (3, le.RETURN_DAY2),
        (5, le.RETURN_DAY2),           # day-2 upper edge
        (6, le.RETURN_DAY6),           # day-6 lower edge
        (12, le.RETURN_DAY6),          # day-6 upper edge
        (13, None),                    # long-churned: leave alone
        (90, None),
    ],
)
def test_due_kind_windows(days, expected):
    assert le.due_kind(days, frozenset(), W) == expected


def test_due_kind_skips_already_sent():
    assert le.due_kind(3, {le.RETURN_DAY2}, W) is None          # day-2 already sent
    assert le.due_kind(8, {le.RETURN_DAY6}, W) is None          # day-6 already sent


def test_due_kind_day6_still_due_after_day2_sent():
    # A learner who got the day-2 nudge and kept lapsing should still get day-6.
    assert le.due_kind(7, {le.RETURN_DAY2}, W) == le.RETURN_DAY6


def test_due_kind_long_gone_gets_day6_not_stale_day2():
    # Feature shipped after they lapsed (nothing sent yet, already 7 days gone) → day-6, not day-2.
    assert le.due_kind(7, frozenset(), W) == le.RETURN_DAY6


# ── days_inactive ─────────────────────────────────────────────────────────────
def test_days_inactive_floors_to_whole_days():
    assert le.days_inactive(NOW, NOW - timedelta(days=2, hours=12)) == 2


def test_days_inactive_never_negative_for_future_activity():
    assert le.days_inactive(NOW, NOW + timedelta(days=1)) == 0


def test_days_inactive_treats_naive_as_utc():
    naive = (NOW - timedelta(days=3)).replace(tzinfo=None)
    assert le.days_inactive(NOW, naive) == 3


# ── copy ──────────────────────────────────────────────────────────────────────
def test_build_return_email_embeds_cta_and_differs_per_kind():
    url = "https://relodojo.app/go"
    s2, t2, h2 = le.build_return_email(le.RETURN_DAY2, url)
    s6, t6, h6 = le.build_return_email(le.RETURN_DAY6, url)
    assert s2 and s6 and s2 != s6                  # both have a subject; they differ
    for body in (t2, h2, t6, h6):
        assert url in body                          # CTA link present in text + html, both kinds
    assert "<a" in h2 and "<a" in h6                # html has the button


def test_build_return_email_rejects_unknown_kind():
    with pytest.raises(ValueError):
        le.build_return_email("return_day99", "https://x")


# ── config plumbing ───────────────────────────────────────────────────────────
def test_windows_from_settings_reads_config(monkeypatch):
    monkeypatch.setattr(settings, "RETURN_DAY2_AFTER_DAYS", 3)
    monkeypatch.setattr(settings, "RETURN_DAY6_UNTIL_DAYS", 20)
    w = le.windows_from_settings()
    assert w.day2[0] == 3 and w.day6[1] == 20


def test_cta_url_prefers_explicit_then_base(monkeypatch):
    monkeypatch.setattr(settings, "RETURN_EMAIL_CTA_URL", "https://relodojo.app/go/")
    monkeypatch.setattr(settings, "APP_BASE_URL", "https://api.example.com")
    assert le.cta_url() == "https://relodojo.app/go"          # explicit wins, trailing slash trimmed
    monkeypatch.setattr(settings, "RETURN_EMAIL_CTA_URL", "")
    assert le.cta_url() == "https://api.example.com"          # falls back to APP_BASE_URL
