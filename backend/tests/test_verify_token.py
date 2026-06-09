"""Email-verification token: round-trip and scope isolation from access tokens."""

from app.core import security


def test_verify_token_roundtrip():
    token = security.create_verify_token("user-123")
    assert security.decode_verify_token(token) == "user-123"


def test_access_token_is_not_accepted_as_verify_token():
    access = security.create_access_token("user-123")
    assert security.decode_verify_token(access) is None


def test_verify_token_cannot_authenticate_a_request():
    # A verification token must never pass as an access token (decode_token rejects the scope).
    verify = security.create_verify_token("user-123")
    assert security.decode_token(verify) is None


def test_decode_verify_rejects_garbage():
    assert security.decode_verify_token("not-a-token") is None
