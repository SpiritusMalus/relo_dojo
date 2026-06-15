"""Feature-access registry (app.services.access) — the single source of truth for gating."""

from types import SimpleNamespace

import pytest

from app.services import access


def _user(verified: bool = True, premium: bool = False) -> SimpleNamespace:
    return SimpleNamespace(is_verified=verified, is_premium=premium)


def test_open_features_allow_everyone_including_anonymous():
    for feat in ("story", "challenge", "review", "review_text"):
        assert access.can(feat, None) is True  # anonymous
        assert access.can(feat, _user(verified=False)) is True
        assert access.can(feat, _user(premium=False)) is True


def test_sync_requires_an_account():
    assert access.can("sync", None) is False  # anonymous can't sync
    assert access.can("sync", _user(verified=False)) is True  # any account, even unverified


def test_premium_gate():
    assert access.can("premium_unlimited", None) is False
    assert access.can("premium_unlimited", _user(premium=False)) is False
    assert access.can("premium_unlimited", _user(premium=True)) is True


def test_unknown_feature_fails_open():
    assert access.can("not_a_feature", None) is True


def test_access_map_covers_all_registered_features():
    m = access.access_map(None)
    assert set(m.keys()) == set(access.FEATURES.keys())
    assert m["sync"] is False and m["story"] is True


def test_require_raises_structured_403_when_locked():
    with pytest.raises(Exception) as exc:
        access.require("sync", None)
    assert getattr(exc.value, "status_code", None) == 403
    detail = exc.value.detail
    assert detail["code"] == "locked" and detail["feature"] == "sync"
    access.require("sync", _user())  # account present → no raise
    access.require("story", None)  # open → no raise


def test_client_mirror_matches_registry():
    """The mobile mirror in store/access.ts must declare the same features with the same gates —
    otherwise the client and server disagree about what's locked. Parsed from the TS source."""
    import pathlib
    import re

    ts = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "store" / "access.ts"
    src = ts.read_text(encoding="utf-8")
    block = re.search(r"FEATURES\s*:\s*Record<Feature,\s*Gate>\s*=\s*\{(.*?)\n\}", src, re.S)
    assert block, "could not find FEATURES table in store/access.ts"
    client: dict[str, dict[str, bool]] = {}
    for name, body in re.findall(r'"?(\w+)"?\s*:\s*\{([^}]*)\}', block.group(1)):
        flags = {k: True for k in re.findall(r"(account|verified|premium)\s*:\s*true", body)}
        client[name] = flags
    server = {
        name: {k: True for k in ("account", "verified", "premium") if getattr(g, k)}
        for name, g in access.FEATURES.items()
    }
    assert client == server
