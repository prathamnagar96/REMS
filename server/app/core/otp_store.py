"""In-memory OTP store for password reset flows."""
from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

_RESET_OTP_STORE: dict[str, dict[str, object]] = {}
_SIGNUP_OTP_STORE: dict[str, dict[str, object]] = {}


def _hash_otp(email: str, otp: str) -> str:
    pepper = os.getenv("JWT_SECRET_KEY", "fallback-pepper")
    raw = f"{email.lower()}:{otp}:{pepper}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _generate_otp_record(*, email: str, store: dict[str, dict[str, object]], expires_minutes: int) -> tuple[str, datetime]:
    otp = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    store[email.lower()] = {
        "otp_hash": _hash_otp(email, otp),
        "expires_at": expires_at,
        "attempts": 0,
    }
    return otp, expires_at


def _verify_otp_record(
    *,
    email: str,
    otp: str,
    store: dict[str, dict[str, object]],
    max_attempts: int,
    consume_on_success: bool = True,
) -> bool:
    key = email.lower()
    entry = store.get(key)
    if not entry:
        return False

    expires_at = entry.get("expires_at")
    if not isinstance(expires_at, datetime) or datetime.now(timezone.utc) >= expires_at:
        store.pop(key, None)
        return False

    attempts_raw = entry.get("attempts", 0)
    attempts = attempts_raw if isinstance(attempts_raw, int) else 0
    if attempts >= max_attempts:
        store.pop(key, None)
        return False

    if _hash_otp(email, otp) != entry.get("otp_hash"):
        entry["attempts"] = attempts + 1
        return False

    if consume_on_success:
        store.pop(key, None)
    return True


def generate_reset_otp(*, email: str, expires_minutes: int = 10) -> tuple[str, datetime]:
    return _generate_otp_record(email=email, store=_RESET_OTP_STORE, expires_minutes=expires_minutes)


def verify_reset_otp(*, email: str, otp: str, max_attempts: int = 5) -> bool:
    return _verify_otp_record(
        email=email,
        otp=otp,
        store=_RESET_OTP_STORE,
        max_attempts=max_attempts,
        consume_on_success=True,
    )


def generate_signup_otp(*, email: str, expires_minutes: int = 10) -> tuple[str, datetime]:
    return _generate_otp_record(email=email, store=_SIGNUP_OTP_STORE, expires_minutes=expires_minutes)


def verify_signup_otp(*, email: str, otp: str, max_attempts: int = 5) -> bool:
    return _verify_otp_record(
        email=email,
        otp=otp,
        store=_SIGNUP_OTP_STORE,
        max_attempts=max_attempts,
        consume_on_success=True,
    )


def validate_signup_otp(*, email: str, otp: str, max_attempts: int = 5) -> bool:
    return _verify_otp_record(
        email=email,
        otp=otp,
        store=_SIGNUP_OTP_STORE,
        max_attempts=max_attempts,
        consume_on_success=False,
    )
