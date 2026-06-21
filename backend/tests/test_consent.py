"""152-ФЗ cross-border consent: the POST /auth/consent audit write + export surfacing.

No real Postgres (the suite's fake-DB convention): we drive the route handler with a fake user +
fake session and assert it records version + timestamp and commits, and that the data export
carries the recorded consent so the acceptance is provable.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.db.models import User
from app.routers.auth import record_consent, export_account
from app.schemas import ConsentIn


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return SimpleNamespace(all=lambda: self._rows)


class _FakeDB:
    def __init__(self, gets=None, events=None):
        self._gets = gets or {}
        self._events = events or []
        self.commits = 0

    async def commit(self):
        self.commits += 1

    async def get(self, model, ident):  # noqa: ANN001
        return self._gets.get(model)

    async def execute(self, stmt):  # noqa: ANN001
        return _FakeResult(self._events)


def _user(**over):
    base = dict(
        id=uuid.uuid4(), email="learner@example.org", is_verified=True, is_premium=False,
        premium_until=None, coins=0, freezes=0, cosmetics=[], equipped={}, unlocks=[],
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        pd_consent_version="", pd_consent_at=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


# --- POST /auth/consent ------------------------------------------------------------------------
async def test_consent_records_version_and_timestamp():
    db = _FakeDB()
    user = _user()
    before = datetime.now(timezone.utc)

    out = await record_consent(ConsentIn(version="pd-1"), user, db)

    assert out.message
    assert user.pd_consent_version == "pd-1"
    assert user.pd_consent_at is not None and user.pd_consent_at >= before
    assert db.commits == 1


async def test_consent_reaccept_overwrites():
    db = _FakeDB()
    user = _user(pd_consent_version="pd-1", pd_consent_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    await record_consent(ConsentIn(version="pd-2"), user, db)
    assert user.pd_consent_version == "pd-2"
    assert user.pd_consent_at.year == 2026 and user.pd_consent_at > datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_consent_in_rejects_empty_version():
    with pytest.raises(Exception):
        ConsentIn(version="")


# --- the consent fact is surfaced in the export (provable acceptance) --------------------------
async def test_export_includes_consent():
    user = _user(
        pd_consent_version="pd-1",
        pd_consent_at=datetime(2026, 6, 21, 9, 30, tzinfo=timezone.utc),
    )
    db = _FakeDB(gets={}, events=[])
    out = await export_account(user, db)
    assert out.account.pd_consent_version == "pd-1"
    assert out.account.pd_consent_at == "2026-06-21T09:30:00+00:00"


async def test_export_consent_empty_when_not_accepted():
    db = _FakeDB(gets={}, events=[])
    out = await export_account(_user(), db)
    assert out.account.pd_consent_version == ""
    assert out.account.pd_consent_at is None


# --- the column exists on the model with the audit-safe defaults -------------------------------
def test_user_has_consent_columns():
    cols = User.__table__.c
    assert "pd_consent_version" in cols and "pd_consent_at" in cols
    assert cols["pd_consent_at"].nullable is True
