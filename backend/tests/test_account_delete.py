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


def _selected_entity(stmt):
    """The ORM entity a select targets (Event / ProcessedPayment), or None for non-selects."""
    try:
        return stmt.column_descriptions[0]["entity"]
    except Exception:
        return None


class _FakeDB:
    """Records db.delete/commit + every executed statement; serves db.get and db.execute(select)
    from fixtures, routing select(Event) vs select(ProcessedPayment) to the right fixture."""

    def __init__(self, gets=None, events=None, payments=None):
        self._gets = gets or {}
        self._events = events or []
        self._payments = payments or []
        self.deleted = []
        self.commits = 0
        self.statements = []

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.commits += 1

    async def get(self, model, ident):  # noqa: ANN001
        return self._gets.get(model)

    async def execute(self, stmt):  # noqa: ANN001 — select(Event)/select(ProcessedPayment)/update(Event)
        self.statements.append(stmt)
        if _selected_entity(stmt) is ProcessedPayment:
            return _FakeResult(self._payments)
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


async def test_delete_account_scrubs_event_subject():
    # RD-04: the FK SET NULL clears Event.user_id, but the subject still holds the user's id string.
    # Deletion must re-key the user's events to an opaque "deleted:" subject so the trail is no longer
    # linkable to the person (152-ФЗ erasure completeness), while still surviving for retention.
    db = _FakeDB()
    user = _user()
    await delete_account(user, db)

    updates = [s for s in db.statements if s.__visit_name__ == "update"]
    assert len(updates) == 1, "exactly one Event subject-scrub UPDATE before the delete"
    sql = str(updates[0].compile(compile_kwargs={"literal_binds": True}))
    assert "events" in sql.lower()
    # The SET clause (new values) re-keys subject to an opaque "deleted:" token — NOT the user's id.
    # (The user's id legitimately appears in the WHERE clause that targets their rows.)
    set_clause = sql.split("SET", 1)[1].split("WHERE")[0]
    assert "deleted:" in set_clause
    assert str(user.id) not in set_clause


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
    payments = [
        SimpleNamespace(provider="yookassa", plan="black_belt_12m", days=365,
                        created_at=datetime(2026, 5, 10, tzinfo=timezone.utc)),
    ]
    db = _FakeDB(gets={Progress: progress, LearnerProfile: profile}, events=events, payments=payments)

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
    # RD-05: purchase history is part of the export (personal data attributed to the caller).
    assert len(out.payments) == 1
    assert out.payments[0].plan == "black_belt_12m" and out.payments[0].days == 365
    assert out.payments[0].provider == "yookassa"
    assert out.payments[0].created_at == "2026-05-10T00:00:00+00:00"


async def test_export_handles_no_progress_or_profile():
    # A user who never synced and never paid: progress/profile/payments absent → empty, not a crash.
    db = _FakeDB(gets={}, events=[], payments=[])
    out = await export_account(_user(), db)
    assert out.progress == {}
    assert out.learner_profile == {}
    assert out.events == []
    assert out.payments == []
