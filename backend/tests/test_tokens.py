"""Sealed-token round-trip and tamper resistance (app.services.tokens)."""

import pytest

from app.services import tokens


def test_seal_unseal_roundtrip():
    payload = {"t": "multiple-choice", "answer": "an"}
    sealed = tokens.seal(payload)
    assert isinstance(sealed, str) and sealed
    assert tokens.unseal(sealed) == payload


def test_unseal_rejects_tampered_token():
    sealed = tokens.seal({"t": "tap-the-error", "index": 2})
    tampered = sealed[:-4] + ("aaaa" if not sealed.endswith("aaaa") else "bbbb")
    with pytest.raises(tokens.TokenError):
        tokens.unseal(tampered)


def test_unseal_rejects_garbage():
    with pytest.raises(tokens.TokenError):
        tokens.unseal("not-a-real-token")


def test_answer_never_appears_in_plaintext_token():
    sealed = tokens.seal({"t": "multiple-choice", "answer": "supercalifragilistic"})
    assert "supercalifragilistic" not in sealed


def test_fresh_token_unseals_within_ttl(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "EXERCISE_TOKEN_TTL_S", 60)
    sealed = tokens.seal({"t": "multiple-choice", "answer": "an"})
    assert tokens.unseal(sealed) == {"t": "multiple-choice", "answer": "an"}


def test_expired_token_is_rejected(monkeypatch):
    import json
    import time

    from app.core.config import settings

    monkeypatch.setattr(settings, "EXERCISE_TOKEN_TTL_S", 10)
    # Craft a token timestamped well in the past — beyond the 10s TTL.
    old = tokens._fernet.encrypt_at_time(
        json.dumps({"t": "multiple-choice", "answer": "an"}).encode(), int(time.time()) - 1000
    ).decode()
    with pytest.raises(tokens.TokenError):
        tokens.unseal(old)


def test_generated_review_token_is_study_only_and_bound_to_learner():
    token = tokens.seal({"t": "multiple-choice", "answer": "an"})
    exercise = {"token": token}
    assert tokens.attach_review_token(exercise, None, None) == exercise
    for user_id, guest_id in (("learner-1", None), (None, "install-abcdef12")):
        issued = tokens.attach_review_token(exercise, user_id, guest_id)
        assert issued["token"] == token
        assert issued["review_token"] != token
        review = tokens.unseal(issued["review_token"])
        assert review["answer"] == "an"
        assert tokens.validate_review(review, user_id, guest_id)
        assert not tokens.validate_review(tokens.unseal(token), user_id, guest_id)
        with pytest.raises(tokens.ReviewScopeError):
            tokens.validate_review(review, "other-account", "install-other-ab")


def test_renew_can_recover_expired_owner_review_but_never_an_ordinary_key():
    import json
    import time

    old = int(time.time()) - 45 * 86400
    key = {"t": "multiple-choice", "answer": "an"}
    old_review = tokens._fernet.encrypt_at_time(json.dumps({
        **key, "_dojo_review_v": 1, "_dojo_review_owner": "learner-1",
        "_dojo_reward_item": "older-coin-receipt",
    }).encode(), old).decode()
    with pytest.raises(tokens.TokenError):
        tokens.unseal(old_review)
    with pytest.raises(tokens.ReviewScopeError):
        tokens.renew_review_token(old_review, "other", None)
    renewed = tokens.unseal(tokens.renew_review_token(old_review, "learner-1", None))
    assert tokens.validate_review(renewed, "learner-1", None)
    assert renewed["answer"] == "an" and "_dojo_reward_item" not in renewed
    assert renewed["_study_born"] == old
    old_ordinary = tokens._fernet.encrypt_at_time(json.dumps(key).encode(), old).decode()
    with pytest.raises(tokens.TokenError):
        tokens.renew_review_token(old_ordinary, "learner-1", None)


def test_generic_scope_expiry_and_absolute_renewal_limit():
    import json
    import time

    now = int(time.time())
    key = {"t": "listen-and-retell", "passage": "A short example."}
    guest_id = "install-abcdef12"
    issued_100_days_ago = tokens.STUDY_TOKEN_PREFIX + tokens._study_fernet.encrypt_at_time(json.dumps({
        **key, "_study_review": tokens._review_scope(None, guest_id), "_study_born": now - 100 * 86400,
    }).encode(), now - 100 * 86400).decode()
    review = tokens.unseal(issued_100_days_ago)
    assert tokens.validate_review(review, None, guest_id)
    expired_issued = tokens.STUDY_TOKEN_PREFIX + tokens._study_fernet.encrypt_at_time(json.dumps({
        **key, "_study_review": tokens._review_scope(None, guest_id), "_study_born": now - 366 * 86400,
    }).encode(), now - 181 * 86400).decode()
    with pytest.raises(tokens.TokenError):
        tokens.unseal(expired_issued)
    with pytest.raises(tokens.TokenError):
        tokens.renew_review_token(expired_issued, None, guest_id)



def test_study_review_ciphertext_cannot_be_reused_as_ordinary_grading_after_rollback():
    exercise = {"token": tokens.seal({"t": "multiple-choice", "answer": "an"})}
    review = tokens.attach_review_token(exercise, "learner-1", None)["review_token"]
    assert review.startswith(tokens.STUDY_TOKEN_PREFIX)
    ciphertext = review[len(tokens.STUDY_TOKEN_PREFIX):]
    with pytest.raises(tokens.InvalidToken):
        tokens._fernet.decrypt(ciphertext.encode())
    with pytest.raises(tokens.TokenError):
        tokens.unseal(ciphertext)
