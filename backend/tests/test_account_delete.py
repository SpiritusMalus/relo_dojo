"""Store-compliance: in-app account deletion + data export.

Two layers, both without a real Postgres (the suite's fake-DB convention):
  - the DELETE/GET route handlers (delete fans out + commits; export loads + assembles), and
  - the ORM cascade *declarations* the delete relies on — verifying that one User row delete really
    does cascade progress/profile, cascade claimed_contracts/sent_emails, and SET NULL (anonymize)
    events / awarded_tokens / processed_payments, since the FK rules are what enforce that in PG.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.db.models import (
    AwardedToken,
    ClaimedContract,
    Event,
    LearnerProfile,
    ProcessedPayment,
    Progress,
    SentEmail,
    User,
)
from app.routers.auth import delete_account, export_account


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return SimpleNamespace(all=lambda: self._rows)


class _FakeDB:
    """Records db.delete/commit; serves db.get(model, id) and db.execute(select) from fixtures."""

    def __init__(self, gets=None, events=None):
        self._gets = gets or {}
        self._events = events or []
        self.deleted = []
        self.commits = 0

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.commits += 1

    async def get(self, model, ident):  # noqa: ANN001
        return self._gets.get(model)

    async def execute(self, stmt):  # noqa: ANN001 — select(Event)...
        return _FakeResult(self._events)


def _user(**over):
    base = dict(
        id=uuid.uuid4(), email="learner@example.org", is_verified=True, is_premium=False,
        premium_until=None, coins=42, freezes=3, cosmetics=["sensei_sage"],
        equipped={"sensei": "sensei_sage"}, unlocks=["arc_office"],
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        pd_consent_version="", pd_consent_at=None,
    )
    base.update(over)
    return SimpleNamespace(**base)


# --- DELETE /auth/account ----------------------------------------------------------------------
async def test_delete_account_deletes_user_and_commits():
    db = _FakeDB()
    user = _user()
    resp = await delete_account(user, db)
    assert resp.status_code == 204
    assert db.deleted == [user]  # the single row delete that triggers the cascade
    assert db.commits == 1


# --- the cascade the delete relies on (FK declarations are what enforce it in Postgres) --------
def _fk_ondelete(model, col):
    fk = next(iter(model.__table__.c[col].foreign_keys))
    return fk.ondelete


def test_owned_rows_cascade_on_user_delete():
    # progress + learner_profile are deleted with the user (relationship + FK CASCADE)...
    assert "delete-orphan" in User.progress.property.cascade
    assert "delete-orphan" in User.learner_profile.property.cascade
    assert _fk_ondelete(Progress, "user_id") == "CASCADE"
    # ...and so are the small per-user guard rows.
    assert _fk_ondelete(ClaimedContract, "user_id") == "CASCADE"
    assert _fk_ondelete(SentEmail, "user_id") == "CASCADE"


def test_audit_rows_are_anonymized_not_deleted():
    # Payment receipts must SURVIVE anonymized (user_id NULL) for refund/audit — never orphaned or
    # cascaded away. Same for analytics + anti-replay tokens.
    assert _fk_ondelete(ProcessedPayment, "user_id") == "SET NULL"
    assert ProcessedPayment.__table__.c.user_id.nullable is True
    assert _fk_ondelete(Event, "user_id") == "SET NULL"
    assert _fk_ondelete(AwardedToken, "user_id") == "SET NULL"


# --- GET /auth/export --------------------------------------------------------------------------
async def test_export_assembles_full_payload():
    user = _user()
    progress = SimpleNamespace(data={"xp": 120, "dailyStreak": 5})
    profile = SimpleNamespace(data={"goal": "email my boss", "tone": "strict"})
    events = [
        SimpleNamespace(name="session_complete", props={"n": 3}, ts=datetime(2026, 6, 1, tzinfo=timezone.utc)),
        SimpleNamespace(name="app_open", props={}, ts=datetime(2026, 6, 2, tzinfo=timezone.utc)),
    ]
    db = _FakeDB(gets={Progress: progress, LearnerProfile: profile}, events=events)

    out = await export_account(user, db)

    assert out.account.email == "learner@example.org"
    assert out.account.coins == 42 and out.account.freezes == 3
    assert out.account.cosmetics == ["sensei_sage"]
    assert out.account.created_at == "2026-01-02T00:00:00+00:00"
    assert "password" not in out.account.model_dump()  # secrets never exported
    assert out.progress == {"xp": 120, "dailyStreak": 5}
    assert out.learner_profile == {"goal": "email my boss", "tone": "strict"}
    assert [e.name for e in out.events] == ["session_complete", "app_open"]
    assert out.events[0].ts == "2026-06-01T00:00:00+00:00"


async def test_export_handles_no_progress_or_profile():
    # A user who never synced: progress/profile rows absent → empty objects, not a crash.
    db = _FakeDB(gets={}, events=[])
    out = await export_account(_user(), db)
    assert out.progress == {}
    assert out.learner_profile == {}
    assert out.events == []
