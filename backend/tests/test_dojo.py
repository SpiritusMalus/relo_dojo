"""My Dojo contracts against isolated in-memory SQLAlchemy storage; no services/providers.

SQLite exercises actual constraints/transactions/cascades. PostgreSQL row-lock declarations are
asserted separately; concurrent live PG behavior is a release integration check, not claimed here.
"""
import hashlib
import json
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, delete, event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.base import Base
from app.db.models import AwardedToken, DojoGrant, DojoPracticeDay, LearningIssuedItem, LearningSession, User
from app.schemas import CheckIn, CheckRetellIn, ExerciseIn
from app.services import analytics, cosmetics, dojo, tokens, wallet


@compiles(JSONB, "sqlite")
def _json_sqlite(type_, compiler, **kw):
    return "JSON"


class AsyncStorage:
    def __init__(self, sync):
        self.sync = sync
        self.locked = 0
        self.fail_commit = False
    def add(self, obj): self.sync.add(obj)
    async def execute(self, stmt): return self.sync.execute(stmt)
    async def get(self, model, key): return self.sync.get(model, key)
    async def flush(self): self.sync.flush()
    async def delete(self, obj): self.sync.delete(obj)
    async def rollback(self): self.sync.rollback()
    async def refresh(self, obj, **kw):
        self.locked += bool(kw.get("with_for_update"))
        self.sync.refresh(obj)
    async def commit(self):
        if self.fail_commit:
            self.sync.rollback()
            raise RuntimeError("simulated lost database commit")
        self.sync.commit()


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setattr(settings, "DOJO_ENABLED", True)
    engine = create_engine("sqlite:///:memory:")
    @event.listens_for(engine, "connect")
    def fk(dbapi, record): dbapi.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        user = User(id=uuid.uuid4(), email="dojo@example.org", password_hash="fake", is_verified=True,
                    cosmetics=["sensei_sage"], equipped={"sensei": "sensei_sage"}, coins=500)
        session.add(user)
        session.commit()
        yield user, AsyncStorage(session)
    engine.dispose()


def exercise():
    return {"type": "multiple-choice", "topic": "articles", "text": "She is ___ engineer.",
            "token": tokens.seal({"t": "multiple-choice", "answer": "an", "topic": "articles"})}


async def answer(user, db, session, ordinal, correct=False):
    data = await dojo.bind_exercise(user, db, session.id, ordinal, exercise(), "en")
    evidence = await dojo.validate_grade(user, db, tokens.unseal(data["token"]), data["token"])
    await dojo.record_grade(user, db, evidence, correct)
    return data


async def finish(user, db):
    session = await dojo.start_session(user, db, uuid.uuid4())
    for i in range(10):
        await answer(user, db, session, i)
    return await dojo.complete_session(user, db, session.id)


async def test_first_day_completion_grants_once_and_preserves_inventory(store):
    user, db = store
    session = await finish(user, db)
    assert session.reward_day == dojo.now_utc().date().isoformat()
    state = await dojo.state(user, db)
    assert state.practice_days == 1 and state.next_milestone == 3
    assert "sensei_sage" in state.owned and state.equipped["sensei"] == "sensei_sage"
    assert "dojo_display_first_scroll" in state.owned
    assert len(state.receipts) == 1
    await dojo.complete_session(user, db, session.id)  # lost response/retry returns durable outcome
    await finish(user, db)  # another full session on same UTC day does not advance milestone
    assert (await dojo.state(user, db)).practice_days == 1
    assert len((await dojo.state(user, db)).receipts) == 1


async def test_nonconsecutive_days_grant_three_thresholds(store, monkeypatch):
    user, db = store
    baseline = dojo.now_utc()
    for gap in [0, 2, 5, 8, 13, 17, 22]:
        monkeypatch.setattr(dojo, "now_utc", lambda gap=gap: baseline + timedelta(days=gap))
        await finish(user, db)
    state = await dojo.state(user, db)
    assert state.practice_days == 7 and state.next_milestone is None
    assert {g.item_id for g in state.receipts} == set(dojo.MILESTONES.values())


async def test_create_idempotency_is_owner_scoped_and_foreign_access_rejected(store):
    user, db = store
    key = uuid.uuid4()
    first = await dojo.start_session(user, db, key)
    assert (await dojo.start_session(user, db, key)).id == first.id
    foreign = User(id=uuid.uuid4(), email="other@example.org", password_hash="fake")
    db.add(foreign)
    await db.commit()
    assert (await dojo.start_session(foreign, db, key)).id != first.id
    with pytest.raises(HTTPException) as e:
        await dojo.get_session(foreign, db, first.id)
    assert e.value.status_code == 404


async def test_partial_unissued_and_tampered_evidence_cannot_complete(store):
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    await answer(user, db, session, 0)
    with pytest.raises(HTTPException): await dojo.complete_session(user, db, session.id)
    token = tokens.seal({"t": "multiple-choice", "answer": "an", "_dojo": {
        "v": 1, "session": str(session.id), "owner": str(user.id), "item": str(uuid.uuid4()), "ordinal": 1}})
    with pytest.raises(HTTPException): await dojo.validate_grade(user, db, tokens.unseal(token), token)
    assert (await dojo.state(user, db)).practice_days == 0


async def test_replacements_replay_and_correction_keep_first_graded_item(store):
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    abandoned = await dojo.bind_exercise(user, db, session.id, 0, exercise(), "en")
    actual = await answer(user, db, session, 0, False)
    before = dict(session.grades)
    for token in [actual["token"], abandoned["token"]]:
        evidence = await dojo.validate_grade(user, db, tokens.unseal(token), token)
        await dojo.record_grade(user, db, evidence, True)
    assert session.grades == before and len(session.grades) == 1
    assert session.grades["0"]["correct"] is False


async def test_expired_bound_token_rejected_but_owner_review_not_session_evidence(store, monkeypatch):
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    data = await answer(user, db, session, 0)
    monkeypatch.setattr(dojo, "now_utc", lambda: datetime.now(timezone.utc) + timedelta(days=2))
    with pytest.raises(HTTPException):
        await dojo.validate_grade(user, db, tokens.unseal(data["token"]), data["token"])
    assert await dojo.validate_grade(user, db, tokens.unseal(data["review_token"]), data["review_token"]) is None
    other = User(id=uuid.uuid4())
    with pytest.raises(HTTPException) as e:
        await dojo.validate_grade(other, db, tokens.unseal(data["review_token"]), data["review_token"])
    assert e.value.status_code == 403


def test_scoped_review_ttl_covers_21_days_without_extending_ordinary_tokens(monkeypatch):
    monkeypatch.setattr(settings, "EXERCISE_TOKEN_TTL_S", 86400)
    old = int(time.time()) - 21 * 86400
    review = {"t": "multiple-choice", "answer": "an", "_dojo_review_owner": str(uuid.uuid4()), "_dojo_review_v": 1}
    token = tokens._fernet.encrypt_at_time(json.dumps(review).encode(), old).decode()
    assert tokens.unseal(token) == review
    ordinary = tokens._fernet.encrypt_at_time(json.dumps({"t": "multiple-choice"}).encode(), old).decode()
    with pytest.raises(tokens.TokenError): tokens.unseal(ordinary)
    expired_review = tokens._fernet.encrypt_at_time(json.dumps(review).encode(), old - 20 * 86400).decode()
    with pytest.raises(tokens.TokenError): tokens.unseal(expired_review)


async def test_earned_receipt_ack_is_owner_scoped_and_does_not_remove_ownership(store):
    user, db = store
    await finish(user, db)
    state = await dojo.state(user, db)
    receipt = uuid.UUID(state.receipts[0].id)
    other = User(id=uuid.uuid4())
    with pytest.raises(HTTPException): await dojo.acknowledge(other, db, receipt)
    await dojo.acknowledge(user, db, receipt)
    state = await dojo.acknowledge(user, db, receipt)
    assert state.receipts == [] and "dojo_display_first_scroll" in state.owned


async def test_target_validation_and_equipping_different_slots_preserve_other_inventory(store):
    user, db = store
    state = await dojo.select_target(user, db, "dojo_light_lantern")
    assert state.selected_target == "dojo_light_lantern"
    with pytest.raises(HTTPException): await dojo.select_target(user, db, "sensei_sage")
    await cosmetics.buy(user, db, "dojo_light_sunset")
    await cosmetics.equip(user, db, "dojo_light_sunset")
    await cosmetics.equip(user, db, "knot_classic")
    assert user.coins == 380 and user.equipped["sensei"] == "sensei_sage"
    assert user.equipped["dojo_light"] == "dojo_light_sunset" and user.equipped["knot"] == "knot_classic"
    assert db.locked >= 4


async def test_completion_transaction_failure_does_not_leave_grant_or_day(store):
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    for i in range(10): await answer(user, db, session, i)
    db.fail_commit = True
    with pytest.raises(RuntimeError): await dojo.complete_session(user, db, session.id)
    db.fail_commit = False
    assert (await dojo.state(user, db)).practice_days == 0
    assert "dojo_display_first_scroll" not in user.cosmetics
    await dojo.complete_session(user, db, session.id)
    assert (await dojo.state(user, db)).practice_days == 1


async def test_durable_economic_guard_survives_awarded_token_pruning(store):
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    data = await answer(user, db, session, 0, True)
    bound = tokens.unseal(data["token"])
    item_id = uuid.UUID(bound["_dojo"]["item"])
    jti = hashlib.sha256(data["token"].encode()).hexdigest()
    first = await wallet.award_correct_check(user, db, jti=jti, durable_item_id=item_id)
    assert first[0] > 0
    balance = user.coins
    await db.execute(delete(AwardedToken).where(AwardedToken.jti == jti))
    await db.commit()
    review = tokens.unseal(data["review_token"])
    assert review["_dojo_reward_jti"] == jti
    retry = await wallet.award_correct_check(user, db, jti=review["_dojo_reward_jti"],
                                             durable_item_id=uuid.UUID(review["_dojo_reward_item"]))
    assert retry == (0, balance, 0, 0) and user.coins == balance


async def test_new_evidence_export_delete_and_retention_are_explicit(store):
    user, db = store
    await finish(user, db)
    data = await dojo.export_data(user, db)
    assert len(data["sessions"]) == 1 and len(data["issued_items"]) == 10 and len(data["grants"]) == 1
    assert "token" not in json.dumps(data) and "answer" not in json.dumps(data)
    await db.delete(user)
    await db.commit()
    for model in [LearningSession, LearningIssuedItem, DojoPracticeDay, DojoGrant]:
        assert (await db.execute(select(model))).scalars().all() == []


async def test_capability_off_preserves_legacy_inventory_but_blocks_new_mutations(store, monkeypatch):
    user, db = store
    monkeypatch.setattr(settings, "DOJO_ENABLED", False)
    for call in [dojo.state(user, db), dojo.start_session(user, db, uuid.uuid4()),
                 cosmetics.buy(user, db, "dojo_light_sunset")]:
        with pytest.raises(HTTPException) as e: await call
        assert e.value.status_code == 404
    await cosmetics.buy(user, db, "knot_gold")
    assert "sensei_sage" in user.cosmetics and "knot_gold" in user.cosmetics


def test_learning_d7_has_mature_cohort_even_without_any_return():
    now = date(2026, 11, 1)
    rows = [("a", date(2026, 10, 20)), ("b", date(2026, 10, 26))]
    assert analytics.compute_learning_retention(rows, today=now) == {"cohort": 1, "retained": 0, "rate": 0.0, "day_n": 7}
    rows += [("a", date(2026, 10, 27))]
    assert analytics.compute_learning_retention(rows, today=now)["rate"] == 1.0


async def test_bound_free_text_uses_existing_llm_rubric_and_no_koku(store, monkeypatch):
    from app import main
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    issued = await dojo.bind_exercise(user, db, session.id, 0,
        {"type": "free-text", "text": "She ___ a book.", "topic": "tenses", "token": None}, "ru")
    grader = AsyncMock(return_value={"correct": False, "correct_answer": "reads", "explanation": "Present simple", "tip": "Try again"})
    monkeypatch.setattr(main.grammar, "check_answer", grader)
    before = user.coins
    result = await main.check(CheckIn(token=issued["token"], response="read"), user=user, db=db)
    assert grader.await_args.args[:3] == ("She ___ a book.", "read", "ru")
    assert result.correct is False and result.score == 0 and result.explanation == "Present simple"
    assert result.coins_earned == 0 and user.coins == before
    assert len(session.grades) == 1


async def test_bound_retell_requires_retell_rubric_and_records_receipt(store, monkeypatch):
    from app import main
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    issued = await dojo.bind_exercise(user, db, session.id, 0,
        {"type": "listen-and-retell", "topic": "tenses", "token": tokens.seal({"t": "listen-and-retell", "passage": "A man read a book."})}, "en")
    with pytest.raises(HTTPException):
        await main.check(CheckIn(token=issued["token"], response="A man read."), user=user, db=db)
    assert session.grades == {}
    grader = AsyncMock(return_value={"correct": True, "correct_answer": "A man read a book.", "explanation": "Good", "tip": ""})
    monkeypatch.setattr(main.grammar, "check_retell", grader)
    result = await main.check_retell(CheckRetellIn(token=issued["token"], retell="A man read.", lang="en"), user=user, db=db)
    assert result.correct is True and session.grades["0"]["correct"] is True
    assert user.coins == 500


async def test_issue_pair_validation_happens_before_generation(store, monkeypatch):
    from app import main
    user, db = store
    generator = AsyncMock(return_value=exercise())
    monkeypatch.setattr(main.grammar, "generate_exercise", generator)
    with pytest.raises(HTTPException) as e:
        await main.exercise(ExerciseIn(learning_item=0), user=user, db=db)
    assert e.value.status_code == 422
    generator.assert_not_awaited()


async def test_correct_after_initial_wrong_earns_once_without_rewriting_evidence(store):
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    data = await answer(user, db, session, 0, False)
    review = tokens.unseal(data["review_token"])
    result = await wallet.award_correct_check(user, db, jti=review["_dojo_reward_jti"],
        durable_item_id=uuid.UUID(review["_dojo_reward_item"]))
    assert result[0] > 0 and session.grades["0"]["correct"] is False
    again = await wallet.award_correct_check(user, db, jti=review["_dojo_reward_jti"],
        durable_item_id=uuid.UUID(review["_dojo_reward_item"]))
    assert again[0] == 0


async def test_real_asgi_contract_issue_grade_complete_and_capability_fallback(store, monkeypatch):
    import httpx
    from app import main
    from app.deps import get_current_user, get_current_user_optional, get_db
    user, db = store
    monkeypatch.setattr(main.grammar, "generate_exercise", AsyncMock(side_effect=lambda **kw: exercise()))
    async def current(): return user
    async def storage(): yield db
    overrides = main.app.dependency_overrides.copy()
    main.app.dependency_overrides.update({get_current_user: current, get_current_user_optional: current, get_db: storage})
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://dojo.test") as client:
            state = await client.get("/dojo")
            assert state.status_code == 200 and len(state.json()["catalog"]) == 8
            key = str(uuid.uuid4())
            session = (await client.post("/dojo/sessions", json={"client_id": key})).json()
            assert (await client.post("/dojo/sessions", json={"client_id": key})).json()["id"] == session["id"]
            issued = await client.post("/exercise", json={"learning_session_id": session["id"], "learning_item": 0})
            assert issued.status_code == 200 and issued.json()["review_token"]
            checked = await client.post("/check", json={"token": issued.json()["token"], "response": "wrong"})
            assert checked.status_code == 200 and checked.json()["correct"] is False
            assert (await client.get(f"/dojo/sessions/{session['id']}")).json()["graded_count"] == 1
            assert (await client.post(f"/dojo/sessions/{session['id']}/complete")).status_code == 409
            monkeypatch.setattr(settings, "DOJO_ENABLED", False)
            assert (await client.get("/dojo")).status_code == 404
            fallback = await client.post("/exercise", json={"learning_session_id": session["id"], "learning_item": 1})
            assert fallback.status_code == 200
            assert "_dojo" not in tokens.unseal(fallback.json()["token"])
            # Turning off the room does not strand an already issued ordinary practice card.
            repeated = await client.post("/check", json={"token": issued.json()["token"], "response": "an"})
            assert repeated.status_code == 200 and repeated.json()["correct"] is True
    finally:
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(overrides)


async def test_repeated_backout_releases_capacity_without_losing_review_or_rewards(store):
    user, db = store
    for _ in range(8):
        session = await dojo.start_session(user, db, uuid.uuid4())
        data = await answer(user, db, session, 0, False)
        await dojo.abandon_session(user, db, session.id)
        assert await dojo.validate_grade(user, db, tokens.unseal(data["review_token"]), data["review_token"]) is None
        with pytest.raises(HTTPException) as e:
            await dojo.complete_session(user, db, session.id)
        assert e.value.status_code == 410 and e.value.detail["code"] == "learning_session_expired"
    assert (await dojo.state(user, db)).practice_days == 0
    assert (await dojo.state(user, db)).receipts == []
    assert user.coins == 500


async def test_abandon_race_cannot_expire_ten_answer_completion_or_committed_grant(store):
    user, db = store
    session = await dojo.start_session(user, db, uuid.uuid4())
    for i in range(10): await answer(user, db, session, i)
    original_expiry = dojo._aware(session.expires_at)
    await dojo.abandon_session(user, db, session.id)
    assert dojo._aware(session.expires_at) == original_expiry
    await dojo.complete_session(user, db, session.id)
    await dojo.abandon_session(user, db, session.id)
    assert session.completed_at is not None
    assert (await dojo.state(user, db)).practice_days == 1
