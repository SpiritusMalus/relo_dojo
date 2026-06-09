"""Gmail sign-up block (app.core.email_policy.is_blocked_email)."""

import pytest

from app.core.email_policy import is_blocked_email


@pytest.mark.parametrize(
    "email",
    [
        "user@gmail.com",
        "USER@GMAIL.COM",
        "first.last+tag@gmail.com",
        "someone@googlemail.com",
    ],
)
def test_blocks_gmail_and_aliases(email):
    assert is_blocked_email(email) is True


@pytest.mark.parametrize(
    "email",
    [
        "user@yandex.ru",
        "user@mail.ru",
        "user@outlook.com",
        "user@notgmail.com",  # different domain that merely contains the word
        "user@gmail.com.evil.ru",  # gmail is not the actual domain
        "malformed-without-at",
    ],
)
def test_allows_everything_else(email):
    assert is_blocked_email(email) is False
