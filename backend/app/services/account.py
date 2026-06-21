"""Account data export (store-compliance: the "export your data" right).

Pure assembly layer — takes already-loaded ORM rows and produces the AccountExport schema. Kept
free of DB access so it unit-tests with plain objects (the suite's fake-DB convention), and so the
route stays a thin loader. Secrets never leave: the password hash is intentionally not exported.
"""

from __future__ import annotations

from typing import Iterable, Optional

from ..db.models import Event, LearnerProfile, Progress, User
from ..schemas import AccountExport, ExportAccount, ExportEvent


def _iso(dt) -> Optional[str]:  # noqa: ANN001 — datetime | None
    return dt.isoformat() if dt is not None else None


def build_account_export(
    user: User,
    progress: Optional[Progress],
    profile: Optional[LearnerProfile],
    events: Iterable[Event],
) -> AccountExport:
    """Assemble the caller's full data export. `progress`/`profile` are None when never synced."""
    return AccountExport(
        account=ExportAccount(
            id=str(user.id),
            email=user.email,
            is_verified=user.is_verified,
            is_premium=user.is_premium,  # effective status (comp OR live paid sub)
            premium_until=_iso(user.premium_until),
            coins=user.coins,
            freezes=user.freezes,
            cosmetics=list(user.cosmetics or []),
            equipped=dict(user.equipped or {}),
            unlocks=list(user.unlocks or []),
            created_at=_iso(user.created_at),
            pd_consent_version=user.pd_consent_version or "",
            pd_consent_at=_iso(user.pd_consent_at),
        ),
        progress=dict(progress.data) if progress is not None else {},
        learner_profile=dict(profile.data) if profile is not None else {},
        events=[ExportEvent(name=e.name, props=dict(e.props or {}), ts=_iso(e.ts)) for e in events],
    )
