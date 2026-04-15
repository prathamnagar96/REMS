"""Security helpers for password hashing and JWT handling."""
from __future__ import annotations

import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext
from dotenv import load_dotenv

_SERVER_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(dotenv_path=_SERVER_ROOT / ".env", override=True)

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise ValueError(f"{name} is not configured. Set it in the environment or .env file.")
    return value


JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_PASSWORD_RESET_EXPIRE_MINUTES", "30"))


def hash_password(password: str) -> str:
    """Hash plaintext passwords before persisting them."""
    if not password:
        raise ValueError("Password value is required for hashing")
    return _pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    """Return True when the provided password matches the stored hash."""
    if not plain_password or not hashed_password:
        return False
    return _pwd_context.verify(plain_password, hashed_password)


def create_access_token(
    subject: str | int,
    expires_delta: timedelta | None = None,
    additional_claims: dict[str, Any] | None = None,
) -> str:
    """Create a signed JWT for the authenticated subject."""
    if not subject:
        raise ValueError("Token subject is required")

    expiry_delta = expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    expire_at = datetime.now(timezone.utc) + expiry_delta
    payload: dict[str, Any] = {"sub": str(subject), "exp": expire_at}
    if additional_claims:
        payload.update(additional_claims)
    jwt_secret_key = _get_required_env("JWT_SECRET_KEY")
    return jwt.encode(payload, jwt_secret_key, algorithm=JWT_ALGORITHM)


def create_password_reset_token(
    *,
    email: str,
    subject: str | int,
    role: str,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a short-lived JWT used for password reset flows."""
    if not email:
        raise ValueError("Email is required")

    expiry_delta = expires_delta or timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES)
    expire_at = datetime.now(timezone.utc) + expiry_delta
    payload = {
        "sub": str(subject),
        "email": email,
        "role": role,
        "purpose": "password_reset",
        "exp": expire_at,
    }
    jwt_secret_key = _get_required_env("JWT_SECRET_KEY")
    return jwt.encode(payload, jwt_secret_key, algorithm=JWT_ALGORITHM)


def verify_password_reset_token(token: str) -> dict[str, str]:
    """Decode and validate password reset JWT payload."""
    if not token:
        raise ValueError("Reset token is required")

    jwt_secret_key = _get_required_env("JWT_SECRET_KEY")
    try:
        payload = jwt.decode(token, jwt_secret_key, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired reset token") from exc

    if payload.get("purpose") != "password_reset":
        raise ValueError("Invalid reset token")

    subject = payload.get("sub")
    email = payload.get("email")
    role = payload.get("role")
    if not subject or not email or not role:
        raise ValueError("Invalid reset token payload")

    return {
        "sub": str(subject),
        "email": str(email),
        "role": str(role),
    }
