import os
from typing import Any

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt
from supabase import Client

from ...db.database import supabase


SCHEMA_MODE = os.getenv("SUPABASE_SCHEMA_MODE", "legacy").lower()
USERS_TABLE = os.getenv("SUPABASE_USERS_TABLE", "users")
TENANT_TABLE = os.getenv("SUPABASE_TENANT_TABLE", "tenants")
OWNER_TABLE = os.getenv("SUPABASE_OWNER_TABLE", "owners")
TENANT_PROFILE_TABLE = os.getenv("SUPABASE_TENANT_PROFILE_TABLE", "tenant_profiles")
PROPERTIES_TABLE = os.getenv("SUPABASE_PROPERTIES_TABLE", "properties")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")


def get_supabase_client() -> Client:
	"""Provide a live Supabase client to route handlers."""
	if supabase is None:
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail="Supabase client is not initialized.",
		)
	return supabase


def _parse_bearer_token(authorization: str | None) -> str:
	if not authorization:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Missing Authorization header",
		)
	parts = authorization.split(" ", 1)
	if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Invalid Authorization header format",
		)
	return parts[1].strip()


def _fetch_user_record_by_id(*, client: Client, user_id: str) -> dict[str, Any] | None:
	if SCHEMA_MODE == "normalized":
		try:
			response = (
				client.table(USERS_TABLE)
				.select("*")
				.eq("id", user_id)
				.limit(1)
				.execute()
			)
		except Exception as exc:  # pragma: no cover - Supabase SDK runtime errors
			raise HTTPException(
				status_code=status.HTTP_502_BAD_GATEWAY,
				detail=f"Supabase user lookup failed: {exc}",
			) from exc
		if response.data and isinstance(response.data[0], dict):
			return dict(response.data[0])
		return None

	for table, role in ((TENANT_TABLE, "tenant"), (OWNER_TABLE, "owner")):
		try:
			response = (
				client.table(table)
				.select("*")
				.eq("id", user_id)
				.limit(1)
				.execute()
			)
		except Exception as exc:  # pragma: no cover - Supabase SDK runtime errors
			raise HTTPException(
				status_code=status.HTTP_502_BAD_GATEWAY,
				detail=f"Supabase user lookup failed: {exc}",
			) from exc
		if response.data and isinstance(response.data[0], dict):
			record = dict(response.data[0])
			record["role"] = role
			return record
	return None


def _normalized_user_has_role(*, client: Client, user_id: str, role: str) -> bool:
	role_value = role.lower()
	if role_value == "tenant":
		table = TENANT_PROFILE_TABLE
		column = "user_id"
	elif role_value == "owner":
		table = PROPERTIES_TABLE
		column = "owner_id"
	else:
		return False

	try:
		response = (
			client.table(table)
			.select("id")
			.eq(column, user_id)
			.limit(1)
			.execute()
		)
	except Exception as exc:  # pragma: no cover - Supabase SDK runtime errors
		raise HTTPException(
			status_code=status.HTTP_502_BAD_GATEWAY,
			detail=f"Supabase role lookup failed: {exc}",
		) from exc

	return bool(response.data)


def get_current_user(
	authorization: str | None = Header(default=None),
	client: Client = Depends(get_supabase_client),
) -> dict[str, Any]:
	token = _parse_bearer_token(authorization)
	jwt_secret_key = os.getenv("JWT_SECRET_KEY")
	if not jwt_secret_key:
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail="JWT_SECRET_KEY is not configured",
		)

	try:
		payload = jwt.decode(token, jwt_secret_key, algorithms=[JWT_ALGORITHM])
	except JWTError as exc:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Invalid or expired access token",
		) from exc

	user_id = payload.get("sub")
	if not user_id:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Invalid token payload",
		)

	user_record = _fetch_user_record_by_id(client=client, user_id=str(user_id))
	if not user_record:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Authenticated user was not found",
		)

	if SCHEMA_MODE == "normalized":
		requested_role_raw = payload.get("role")
		requested_role = requested_role_raw.lower() if isinstance(requested_role_raw, str) else ""
		if requested_role in {"owner", "tenant"}:
			if not _normalized_user_has_role(client=client, user_id=str(user_id), role=requested_role):
				raise HTTPException(
					status_code=status.HTTP_403_FORBIDDEN,
					detail=f"{requested_role.title()} role is not enabled for this account",
				)
			# For normalized mode, enforce active role from the token for route guards.
			user_record["role"] = requested_role

	return user_record


def require_owner(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
	if user.get("role") != "owner":
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="Owner role required",
		)
	return user


def require_tenant(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
	if user.get("role") != "tenant":
		raise HTTPException(
			status_code=status.HTTP_403_FORBIDDEN,
			detail="Tenant role required",
		)
	return user
