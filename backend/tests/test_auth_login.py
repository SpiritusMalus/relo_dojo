"""Login anti-enumeration (RD-02 → RD-01 in the audit): an unknown email and a wrong password must
return the SAME generic 401, and must cost the same time — so the missing-user path runs a dummy
argon2 verify too. No real DB (the suite's fake-DB convention); we spy on verify_password to prove
the equalizer ran."""

import uuid
from types import SimpleNamespace

import pytest

from app.routers import auth
from app.schemas import LoginIn, RegisterIn


class _FakeResult:
    def __init__(self, user):
        self._user = user

    def scalar_one_or_none(self):
        return self._user


class _FakeDB:
    """Serves db.execute(select(User)...) with a fixed user (or None for "no such email")."""

    def __init__(self, user):
        self._user = user

    async def execute(self, stmt):  # noqa: ANN001
        return _FakeResult(self._user)


async def test_login_unknown_email_runs_dummy_verify_and_401s(monkeypatch):
    calls = []
    monkeypatch.setattr(auth, "verify_password", lambda pw, h: calls.append(h) or False)

    with pytest.raises(auth.HTTPException) as exc:
        await auth.login(LoginIn(email="nobody@example.org", password="whatever"), _FakeDB(None))

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid email or password."
    # The equalizer verified against the fixed dummy hash even though the account doesn't exist —
    # so an unknown email isn't faster (and thus distinguishable) from a wrong password.
    assert calls == [auth._DUMMY_PASSWORD_HASH]


async def test_login_wrong_password_same_generic_401(monkeypatch):
    monkeypatch.setattr(auth, "verify_password", lambda pw, h: False)
    user = SimpleNamespace(id=uuid.uuid4(), password_hash="$argon2id$real")

    with pytest.raises(auth.HTTPException) as exc:
        await auth.login(LoginIn(email="real@example.org", password="wrong"), _FakeDB(user))

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid email or password."  # identical to the unknown-email case


async def test_login_success_returns_token(monkeypatch):
    monkeypatch.setattr(auth, "verify_password", lambda pw, h: True)
    user = SimpleNamespace(id=uuid.uuid4(), password_hash="$argon2id$real")

    out = await auth.login(LoginIn(email="real@example.org", password="right"), _FakeDB(user))

    assert out.access_token


@pytest.mark.parametrize("email", ["owner@gmail.com", "Old.User@googlemail.com"])
async def test_login_google_email_blocked_before_any_lookup(monkeypatch, email):
    """RU restriction: Google-mail sign-IN is refused outright — even for an account that exists.
    The 400 must fire before credentials are touched, so no verify (and no timing signal) runs."""
    monkeypatch.setattr(
        auth, "verify_password", lambda pw, h: pytest.fail("blocked email must not reach verify")
    )
    existing = SimpleNamespace(id=uuid.uuid4(), password_hash="$argon2id$real")

    with pytest.raises(auth.HTTPException) as exc:
        await auth.login(LoginIn(email=email, password="whatever"), _FakeDB(existing))

    assert exc.value.status_code == 400
    assert exc.value.detail == auth.BLOCKED_EMAIL_MESSAGE


async def test_register_google_email_blocked(monkeypatch):
    monkeypatch.setattr(
        auth, "verify_password", lambda pw, h: pytest.fail("blocked email must not reach verify")
    )

    with pytest.raises(auth.HTTPException) as exc:
        await auth.register(RegisterIn(email="new@google.com", password="password123"), _FakeDB(None))

    assert exc.value.status_code == 400
    assert exc.value.detail == auth.BLOCKED_EMAIL_MESSAGE
