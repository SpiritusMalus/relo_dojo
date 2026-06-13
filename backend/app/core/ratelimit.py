"""In-process sliding-window rate limiter (abuse / cost guard).

Why in-process: the deploy is single-instance (Mac now, one VPS later), so a process-local store is
enough and needs zero infra. The public surface is `SlidingWindowLimiter`, whose `allow(key, now)`
is a pure function of the injected clock — deterministic and unit-testable. If the backend ever
scales to multiple workers, swap the store behind this same interface for a shared one (e.g. Redis);
nothing else changes.

The FastAPI glue (deriving the client key from the request, raising 429) lives in `deps.py` so this
module stays dependency-free and trivially testable.
"""

from __future__ import annotations

import time
from collections import deque
from threading import Lock


class SlidingWindowLimiter:
    """Allow at most `limit` events per `window_s` seconds, per key.

    `limit <= 0` disables the limiter (always allows) — the kill-switch for dev/tests. State is a
    per-key deque of hit timestamps; old entries fall out of the window on each call, and a key whose
    window empties is dropped so the table can't grow without bound from one-off callers.
    """

    def __init__(self, limit: int, window_s: float) -> None:
        self.limit = limit
        self.window_s = window_s
        self._hits: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        """True if this hit is within the limit (and records it); False if the key is over budget."""
        if self.limit <= 0:
            return True  # disabled
        now = time.monotonic() if now is None else now
        cutoff = now - self.window_s
        with self._lock:
            dq = self._hits.get(key)
            if dq is None:
                dq = deque()
                self._hits[key] = dq
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= self.limit:
                return False
            dq.append(now)
            return True

    def retry_after(self, key: str, now: float | None = None) -> float:
        """Seconds until the oldest in-window hit expires (so the caller drops back under the limit).
        0 when the key is currently allowed / unknown. Advisory — for the Retry-After header."""
        if self.limit <= 0:
            return 0.0
        now = time.monotonic() if now is None else now
        with self._lock:
            dq = self._hits.get(key)
            if not dq or len(dq) < self.limit:
                return 0.0
            return max(0.0, dq[0] + self.window_s - now)

    def gc(self, now: float | None = None) -> int:
        """Drop keys whose entire window has expired. Returns the number removed. Call occasionally
        (or never — memory is bounded by the count of *active* keys, which for one instance is small)."""
        now = time.monotonic() if now is None else now
        cutoff = now - self.window_s
        with self._lock:
            stale = [k for k, dq in self._hits.items() if not dq or dq[-1] <= cutoff]
            for k in stale:
                del self._hits[k]
            return len(stale)

    def reset(self) -> None:
        """Clear all state (tests)."""
        with self._lock:
            self._hits.clear()
