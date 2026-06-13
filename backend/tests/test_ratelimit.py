"""Rate limiter: pure sliding-window core + the FastAPI glue (key derivation + 429)."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import deps
from app.core.config import settings
from app.core.ratelimit import SlidingWindowLimiter


# --- pure core ---------------------------------------------------------------------------------
def test_allows_up_to_limit_then_blocks():
    lim = SlidingWindowLimiter(limit=3, window_s=60)
    assert [lim.allow("k", 1000.0) for _ in range(3)] == [True, True, True]
    assert lim.allow("k", 1000.0) is False


def test_window_slides_old_hits_out():
    lim = SlidingWindowLimiter(2, 10)
    assert lim.allow("k", 0) is True
    assert lim.allow("k", 1) is True
    assert lim.allow("k", 5) is False  # both still in the 10s window
    assert lim.allow("k", 11) is True  # the t=0 hit aged out


def test_non_positive_limit_disables():
    lim = SlidingWindowLimiter(0, 60)
    assert all(lim.allow("k", 0) for _ in range(100))


def test_keys_are_isolated():
    lim = SlidingWindowLimiter(1, 60)
    assert lim.allow("a", 0) is True
    assert lim.allow("b", 0) is True  # different key, own budget
    assert lim.allow("a", 0) is False


def test_retry_after_then_gc_prunes():
    lim = SlidingWindowLimiter(1, 10)
    assert lim.allow("k", 0) is True
    assert lim.retry_after("k", 3) == pytest.approx(7.0)
    assert lim.gc(5) == 0  # key still active
    assert lim.gc(11) == 1  # whole window expired → key removed
    assert lim.allow("k", 12) is True


# --- FastAPI glue ------------------------------------------------------------------------------
class _FakeReq:
    def __init__(self, host: str = "9.9.9.9", xff: str | None = None) -> None:
        self.client = type("C", (), {"host": host})()
        self.headers = {"x-forwarded-for": xff} if xff is not None else {}


def test_client_ip_prefers_socket_unless_proxy_trusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUST_FORWARDED_FOR", False)
    assert deps._client_ip(_FakeReq("5.5.5.5", xff="1.2.3.4")) == "5.5.5.5"
    monkeypatch.setattr(settings, "TRUST_FORWARDED_FOR", True)
    assert deps._client_ip(_FakeReq("5.5.5.5", xff="1.2.3.4, 7.7.7.7")) == "1.2.3.4"


def test_enforce_raises_429_with_retry_after(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    lim = SlidingWindowLimiter(2, 60)
    req = _FakeReq("8.8.8.8")
    deps._enforce(lim, req, "t")  # 1
    deps._enforce(lim, req, "t")  # 2
    with pytest.raises(HTTPException) as ei:
        deps._enforce(lim, req, "t")  # 3 → blocked
    assert ei.value.status_code == 429
    assert int(ei.value.headers["Retry-After"]) >= 1


def test_enforce_master_switch_off_never_blocks(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)
    lim = SlidingWindowLimiter(1, 60)
    req = _FakeReq("8.8.8.8")
    for _ in range(10):
        deps._enforce(lim, req, "t")  # no raise


def test_enforce_isolates_by_ip(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    lim = SlidingWindowLimiter(1, 60)
    deps._enforce(lim, _FakeReq("1.1.1.1"), "t")
    deps._enforce(lim, _FakeReq("2.2.2.2"), "t")  # different IP, own budget
    with pytest.raises(HTTPException):
        deps._enforce(lim, _FakeReq("1.1.1.1"), "t")
