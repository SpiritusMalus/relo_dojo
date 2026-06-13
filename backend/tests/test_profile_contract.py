"""Contract test: the client sync snapshot must be fully mirrored by the server schemas.

Why this exists: the server Pydantic models silently DROP any field the client sends that
they don't declare. That exact bug shipped at least three times — `Profile.sphere`, then
`TopicStat.lastSeen`, then the `wins`/`plan*`/`remindHour`/`diary` batch — each time losing
client state on /progress sync with no error anywhere.

This test reads the TypeScript source of the client types and asserts every field is present
on the matching server model. If someone adds a field to the mobile `Profile` (or `Progress`,
or `TopicStat`) and forgets the server side, this fails — turning a silent data-loss bug into
a red test. It needs no running app, DB, or LLM.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.schemas import ProgressData, Profile, TopicStat

# repo_root/backend/tests/this_file -> parents[2] == repo root
_PROGRESS_TS = Path(__file__).resolve().parents[2] / "mobile" / "store" / "progress.tsx"


def _ts_type_fields(source: str, type_name: str) -> set[str]:
    """Extract the top-level field names of `export type <type_name> = { ... }` from TS source.

    Works for both single-line and multi-line type literals: brace-matches the outer `{...}`,
    then reads the leading identifier of each top-level (`;`-separated, brace-depth-0) member.
    Nested object keys are ignored; `//` line comments are stripped.
    """
    # strip line comments so `//` inside the block can't hide or fake a field
    code = "\n".join(line.split("//", 1)[0] for line in source.splitlines())
    m = re.search(rf"export type {re.escape(type_name)}\s*=\s*", code)
    assert m, f"could not find `export type {type_name}` in {_PROGRESS_TS.name}"
    start = code.index("{", m.start())
    depth = 0
    end = -1
    for i in range(start, len(code)):
        if code[i] == "{":
            depth += 1
        elif code[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    assert end != -1, f"unterminated `{type_name}` type literal in {_PROGRESS_TS.name}"
    interior = code[start + 1 : end]

    fields: set[str] = set()
    depth = 0
    segment = ""
    for ch in interior:
        if ch in "{<([":
            depth += 1
        elif ch in "}>)]":
            depth -= 1
        if ch == ";" and depth == 0:
            fm = re.match(r"\s*(\w+)\??\s*:", segment)
            if fm:
                fields.add(fm.group(1))
            segment = ""
        else:
            segment += ch
    fm = re.match(r"\s*(\w+)\??\s*:", segment)  # last member may lack a trailing ';'
    if fm:
        fields.add(fm.group(1))
    return fields


# (client TS type name, server Pydantic model) — the three shapes that travel over /progress sync.
_CONTRACTS = [
    ("Profile", Profile),
    ("Progress", ProgressData),  # client `Progress` <-> server `ProgressData`
    ("TopicStat", TopicStat),
]


@pytest.fixture(scope="module")
def ts_source() -> str:
    assert _PROGRESS_TS.exists(), f"client source not found at {_PROGRESS_TS}"
    return _PROGRESS_TS.read_text(encoding="utf-8")


@pytest.mark.parametrize("ts_name,model", _CONTRACTS, ids=[c[0] for c in _CONTRACTS])
def test_client_fields_are_mirrored_server_side(ts_source: str, ts_name: str, model) -> None:
    client_fields = _ts_type_fields(ts_source, ts_name)
    server_fields = set(model.model_fields.keys())
    assert client_fields, f"parsed no fields for client `{ts_name}` — parser/source drift"

    missing = client_fields - server_fields
    assert not missing, (
        f"client `{ts_name}` has field(s) {sorted(missing)} that the server model "
        f"`{model.__name__}` does not declare — they'll be SILENTLY DROPPED on /progress sync. "
        f"Add them to backend/app/schemas.py ({model.__name__})."
    )


def test_parser_self_check(ts_source: str) -> None:
    """Guard the regex parser itself: a known field must be found (so a silent parse failure
    can't make the contract test vacuously pass)."""
    assert "sphere" in _ts_type_fields(ts_source, "Profile")
    assert "lastSeen" in _ts_type_fields(ts_source, "TopicStat")
