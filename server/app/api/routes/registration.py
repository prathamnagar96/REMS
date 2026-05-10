import os
import logging
import re
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
import httpx
from pydantic import BaseModel, EmailStr, Field
from supabase import Client

from .dependencies import get_supabase_client
from ...core.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    hash_password,
    verify_password,
)
from ...core.mailer import send_password_reset_otp_email
from ...core.mailer import send_signup_otp_email
from ...core.otp_store import (
    generate_reset_otp,
    generate_signup_otp,
    validate_signup_otp,
    verify_reset_otp,
    verify_signup_otp,
)

router = APIRouter(prefix="/api", tags=["registration"])
logger = logging.getLogger(__name__)

TENANT_TABLE = os.getenv("SUPABASE_TENANT_TABLE", "tenants")
OWNER_TABLE = os.getenv("SUPABASE_OWNER_TABLE", "owners")
SCHEMA_MODE = os.getenv("SUPABASE_SCHEMA_MODE", "legacy").lower()
USERS_TABLE = os.getenv("SUPABASE_USERS_TABLE", "users")
TENANT_PROFILE_TABLE = os.getenv("SUPABASE_TENANT_PROFILE_TABLE", "tenant_profiles")
PROPERTIES_TABLE = os.getenv("SUPABASE_PROPERTIES_TABLE", "properties")
PROPERTY_TERMS_TABLE = os.getenv("SUPABASE_PROPERTY_TERMS_TABLE", "property_terms")
PROPERTY_MEDIA_TABLE = os.getenv("SUPABASE_PROPERTY_MEDIA_TABLE", "property_media")
AUTH_CREDENTIALS_TABLE = os.getenv("SUPABASE_AUTH_CREDENTIALS_TABLE", "auth_credentials")
USER_NAME_COLUMN = os.getenv("SUPABASE_USER_NAME_COLUMN", "fullName")
USER_PHONE_COUNTRY_COLUMN = os.getenv("SUPABASE_USER_PHONE_COUNTRY_COLUMN", "phoneCountry")
USER_PASSWORD_COLUMN = os.getenv("SUPABASE_USER_PASSWORD_COLUMN", "password")


class TenantRegistration(BaseModel):
    fullName: str
    email: EmailStr
    phoneCountry: str
    phone: str
    dob: Optional[str] = None
    password: str
    confirmPassword: str
    emailOtp: str
    idType: Optional[str] = None
    idNumber: Optional[str] = None
    occupation: Optional[str] = None
    employer: Optional[str] = None
    monthlyIncome: Optional[str] = None
    workCity: Optional[str] = None
    preferredCity: Optional[str] = None
    maxBudget: Optional[str] = None
    occupants: Optional[str] = None
    petOwner: Optional[str] = None
    furnishingPref: Optional[str] = None
    leaseDuration: Optional[str] = None
    moveInDate: Optional[str] = None
    specialRequirements: Optional[str] = None
    amenities: List[str] = Field(default_factory=list)
    emergencyName: Optional[str] = None
    emergencyRelation: Optional[str] = None
    emergencyPhoneCountry: Optional[str] = None
    emergencyPhone: Optional[str] = None
    tenantConsent: bool = False

    class Config:
        extra = "allow"


class OwnerRegistration(BaseModel):
    fullName: str
    email: EmailStr
    phoneCountry: str
    phone: str
    altPhoneCountry: Optional[str] = None
    altPhone: Optional[str] = None
    password: str
    confirmPassword: str
    emailOtp: str
    propertyName: str
    propertyType: str
    bhk: Optional[str] = None
    totalUnits: Optional[str] = None
    address: str
    city: str
    stateRegion: str
    propertyCountry: str
    postalCode: str
    sizeSqft: Optional[str] = None
    builtupSqft: Optional[str] = None
    floorNumber: Optional[str] = None
    totalFloors: Optional[str] = None
    furnishing: Optional[str] = None
    parking: Optional[str] = None
    petPolicy: Optional[str] = None
    facing: Optional[str] = None
    amenities: List[str] = Field(default_factory=list)
    expectedRent: Optional[str] = None
    securityDeposit: Optional[str] = None
    maintenanceCharges: Optional[str] = None
    negotiable: Optional[str] = None
    minAgreement: Optional[str] = None
    maxAgreement: Optional[str] = None
    noticePeriod: Optional[str] = None
    preferredTenants: Optional[str] = None
    houseRules: Optional[str] = None
    availableFrom: Optional[str] = None
    description: Optional[str] = None
    exteriorImages: List[str] = Field(default_factory=list)
    livingRoomImages: List[str] = Field(default_factory=list)
    galleryImages: List[str] = Field(default_factory=list)
    washroomImages: List[str] = Field(default_factory=list)
    documents: List[str] = Field(default_factory=list)
    ownerConsent: bool = False

    class Config:
        extra = "allow"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role: Literal["tenant", "owner"] = "tenant"


class GoogleLoginRequest(BaseModel):
    credential: str
    role: Literal["tenant", "owner"] = "tenant"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp: str
    newPassword: str
    confirmPassword: str


class SignupOtpRequest(BaseModel):
    email: EmailStr
    role: Literal["tenant", "owner"]


class SignupOtpVerifyRequest(BaseModel):
    email: EmailStr
    otp: str


def _extract_unknown_column(message: str) -> str | None:
    patterns = [
        r"Could not find the ['\"]([a-zA-Z0-9_]+)['\"] column",
        r"column ['\"]?([a-zA-Z0-9_]+)['\"]? of relation ['\"]?[a-zA-Z0-9_]+['\"]? does not exist",
        r"column ['\"]?([a-zA-Z0-9_]+)['\"]? does not exist",
    ]
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _insert_record(table: str, payload: dict[str, Any], client: Client) -> dict[str, Any]:
    attempt_payload = dict(payload)
    max_attempts = max(len(attempt_payload), 1)
    for _ in range(max_attempts):
        try:
            response = client.table(table).insert(attempt_payload).execute()
            break
        except Exception as exc:  # pragma: no cover - Supabase SDK surfaces rich errors
            message = str(exc)
            duplicate_error = "duplicate key value violates unique constraint" in message.lower() or "'code': '23505'" in message or '"code": "23505"' in message
            if duplicate_error and table == USERS_TABLE and "email" in message.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email is already registered. Please sign in or use a different email.",
                ) from exc

            unknown_column = _extract_unknown_column(message)
            if unknown_column and unknown_column in attempt_payload:
                logger.warning(
                    "Dropping unknown column '%s' from insert payload for table '%s'",
                    unknown_column,
                    table,
                )
                attempt_payload.pop(unknown_column, None)
                if not attempt_payload:
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=f"Insert payload for table '{table}' became empty after schema fallback",
                    ) from exc
                continue

            if "row-level security policy" in message.lower():
                message = (
                    "Supabase insert blocked by RLS policy. Use a Supabase service role key in "
                    "server/.env (SUPABASE_KEY) for backend writes, or add explicit insert policies."
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Supabase insert failed: {message}"
            ) from exc
    else:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase insert failed after schema fallback retries for table '{table}'",
        )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase returned no data for the insert operation"
        )
    record = response.data[0]
    if not isinstance(record, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase insert returned unexpected payload format",
        )
    return dict(record)


def _prepare_registration_payload(registration: BaseModel) -> dict[str, Any]:
    payload = registration.model_dump()
    payload["password"] = hash_password(payload["password"])
    payload.pop("confirmPassword", None)
    payload.pop("emailOtp", None)
    return payload


def _compact_dict(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in payload.items() if v not in (None, "", [], {})}


def _fetch_user_by_email_normalized(email: str, client: Client) -> dict[str, Any] | None:
    try:
        response = (
            client.table(USERS_TABLE)
            .select("*")
            .eq("email", email)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - surfaces Supabase errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase select failed: {exc}",
        ) from exc

    if response.data and isinstance(response.data[0], dict):
        return dict(response.data[0])
    return None


def _normalized_user_has_role(*, user_id: str, role: Literal["tenant", "owner"], client: Client) -> bool:
    if role == "tenant":
        table = TENANT_PROFILE_TABLE
        column = "user_id"
    else:
        table = PROPERTIES_TABLE
        column = "owner_id"

    try:
        response = (
            client.table(table)
            .select("id")
            .eq(column, user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - surfaces Supabase errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase select failed: {exc}",
        ) from exc

    return bool(response.data)


def _upsert_auth_credentials(user_id: Any, password_hash: str, client: Client) -> None:
    try:
        response = (
            client.table(AUTH_CREDENTIALS_TABLE)
            .select("id")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - surfaces Supabase errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase auth lookup failed: {exc}",
        ) from exc

    if response.data:
        try:
            client.table(AUTH_CREDENTIALS_TABLE).update({"password_hash": password_hash}).eq("user_id", user_id).execute()
        except Exception as exc:  # pragma: no cover - surfaces Supabase errors
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Supabase auth update failed: {exc}",
            ) from exc
        return

    _insert_auth_credentials(user_id, password_hash, client)


def _find_existing_signup_role(email: str, requested_role: Literal["tenant", "owner"], client: Client) -> str | None:
    if SCHEMA_MODE == "normalized":
        user = _fetch_user_by_email_normalized(email=email, client=client)
        if not user:
            return None

        user_id = user.get("id")
        if user_id in (None, ""):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase returned user without id",
            )

        if _normalized_user_has_role(user_id=str(user_id), role=requested_role, client=client):
            return requested_role
        return None

    tenant_account = _try_fetch_account(TENANT_TABLE, email, client)
    if requested_role == "tenant":
        return "tenant" if tenant_account else None

    owner_account = _try_fetch_account(OWNER_TABLE, email, client) if requested_role == "owner" else None
    if requested_role == "owner":
        return "owner" if owner_account else None

    return None


def _ensure_email_available_for_signup(
    *,
    email: str,
    requested_role: Literal["tenant", "owner"],
    client: Client,
) -> None:
    existing_role = _find_existing_signup_role(
        email=email,
        requested_role=requested_role,
        client=client,
    )
    if not existing_role:
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Email is already registered for {requested_role}. Please sign in.",
    )


def _insert_user(
    *,
    role: Literal["tenant", "owner"],
    payload: dict[str, Any],
    client: Client,
) -> dict[str, Any]:
    # Normalized schema stores identity in users and credentials separately.
    user_payload = _compact_dict({"email": payload.get("email"), "role": role})
    return _insert_record(USERS_TABLE, user_payload, client)


def _insert_auth_credentials(user_id: Any, password_hash: str, client: Client) -> dict[str, Any]:
    credentials_payload = _compact_dict({
        "user_id": user_id,
        "password_hash": password_hash,
    })
    return _insert_record(AUTH_CREDENTIALS_TABLE, credentials_payload, client)


def _insert_owner_media(property_id: str, payload: dict[str, Any], client: Client) -> None:
    media_entries: list[dict[str, Any]] = []
    media_map = {
        "exterior": payload.get("exteriorImages", []),
        "living_room": payload.get("livingRoomImages", []),
        "gallery": payload.get("galleryImages", []),
        "washroom": payload.get("washroomImages", []),
        "document": payload.get("documents", []),
    }
    for category, urls in media_map.items():
        for url in urls or []:
            media_entries.append({"property_id": property_id, "category": category, "url": url})

    if not media_entries:
        return

    try:
        client.table(PROPERTY_MEDIA_TABLE).insert(media_entries).execute()
    except Exception as exc:  # pragma: no cover - Supabase SDK surfaces rich errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase media insert failed: {exc}",
        ) from exc


def _register_tenant_normalized(registration: TenantRegistration, client: Client) -> dict[str, Any]:
    payload = _prepare_registration_payload(registration)
    existing_user = _fetch_user_by_email_normalized(email=str(payload.get("email") or ""), client=client)

    if existing_user:
        user_record = existing_user
        user_id = user_record.get("id")
        if user_id in (None, ""):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase returned user without id",
            )
        _upsert_auth_credentials(user_id, payload.get("password", ""), client)
    else:
        user_record = _insert_user(role="tenant", payload=payload, client=client)
        _insert_auth_credentials(user_record.get("id"), payload.get("password", ""), client)

    preferences = _compact_dict(
        {
            "preferred_city": payload.get("preferredCity"),
            "max_budget": payload.get("maxBudget"),
            "occupants": payload.get("occupants"),
            "pet_owner": payload.get("petOwner"),
            "furnishing_pref": payload.get("furnishingPref"),
            "lease_duration": payload.get("leaseDuration"),
            "move_in_date": payload.get("moveInDate"),
            "special_requirements": payload.get("specialRequirements"),
            "amenities": payload.get("amenities", []),
            "emergency": _compact_dict(
                {
                    "name": payload.get("emergencyName"),
                    "relation": payload.get("emergencyRelation"),
                    "phone_country": payload.get("emergencyPhoneCountry"),
                    "phone": payload.get("emergencyPhone"),
                }
            ),
            "work_city": payload.get("workCity"),
            "employer": payload.get("employer"),
            "tenant_consent": payload.get("tenantConsent"),
        }
    )

    profile_payload = _compact_dict(
        {
            "user_id": user_record.get("id"),
            "dob": payload.get("dob") or None,
            "id_type": payload.get("idType"),
            "id_number": payload.get("idNumber"),
            "occupation": payload.get("occupation"),
            "monthly_income": payload.get("monthlyIncome"),
            "preferences": preferences,
        }
    )
    profile_record = _insert_record(TENANT_PROFILE_TABLE, profile_payload, client)
    return {"user": user_record, "profile": profile_record}


def _register_owner_normalized(registration: OwnerRegistration, client: Client) -> dict[str, Any]:
    payload = _prepare_registration_payload(registration)
    existing_user = _fetch_user_by_email_normalized(email=str(payload.get("email") or ""), client=client)

    if existing_user:
        user_record = existing_user
        user_id = user_record.get("id")
        if user_id in (None, ""):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase returned user without id",
            )
        _upsert_auth_credentials(user_id, payload.get("password", ""), client)
    else:
        user_record = _insert_user(role="owner", payload=payload, client=client)
        _insert_auth_credentials(user_record.get("id"), payload.get("password", ""), client)

    property_payload = _compact_dict(
        {
            "owner_id": user_record.get("id"),
            "property_name": payload.get("propertyName"),
            "property_type": payload.get("propertyType"),
            "bhk": payload.get("bhk"),
            "total_units": payload.get("totalUnits"),
            "address": payload.get("address"),
            "city": payload.get("city"),
            "state_region": payload.get("stateRegion"),
            "country": payload.get("propertyCountry"),
            "postal_code": payload.get("postalCode"),
            "size_sqft": payload.get("sizeSqft"),
            "builtup_sqft": payload.get("builtupSqft"),
            "floor_number": payload.get("floorNumber"),
            "total_floors": payload.get("totalFloors"),
            "furnishing": payload.get("furnishing"),
            "parking": payload.get("parking"),
            "pet_policy": payload.get("petPolicy"),
            "facing": payload.get("facing"),
            "available_from": payload.get("availableFrom") or None,
            "description": payload.get("description"),
            "amenities": payload.get("amenities", []),
        }
    )
    property_record = _insert_record(PROPERTIES_TABLE, property_payload, client)

    terms_payload = _compact_dict(
        {
            "property_id": property_record.get("id"),
            "expected_rent": payload.get("expectedRent"),
            "security_deposit": payload.get("securityDeposit"),
            "maintenance_charges": payload.get("maintenanceCharges"),
            "min_agreement_months": payload.get("minAgreement"),
            "house_rules": payload.get("houseRules"),
        }
    )
    terms_record = _insert_record(PROPERTY_TERMS_TABLE, terms_payload, client)

    property_id = property_record.get("id")
    if isinstance(property_id, str):
        _insert_owner_media(property_id, payload, client)

    return {"user": user_record, "property": property_record, "terms": terms_record}


def _fetch_account(table: str, email: str, client: Client) -> dict[str, Any]:
    try:
        response = (
            client.table(table)
            .select("*")
            .eq("email", email)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - surfaces Supabase errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase select failed: {exc}",
        ) from exc

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    account = response.data[0]
    if not isinstance(account, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase select returned unexpected payload format",
        )
    return dict(account)


def _try_fetch_account(table: str, email: str, client: Client) -> dict[str, Any] | None:
    try:
        return _fetch_account(table, email, client)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            return None
        raise


async def _verify_google_id_token(credential: str) -> dict[str, Any]:
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google credential is required",
        )

    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google client ID is not configured",
        )

    try:
        async with httpx.AsyncClient(timeout=8.0) as http_client:
            response = await http_client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": credential},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google token verification failed: {exc}",
        ) from exc

    if response.status_code != status.HTTP_200_OK:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google credentials",
        )

    token_info = response.json() or {}
    if token_info.get("aud") != client_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google token audience mismatch",
        )

    issuer = token_info.get("iss")
    if issuer and issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token issuer",
        )

    if str(token_info.get("email_verified")).lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email is not verified",
        )

    return token_info


@router.post("/tenant/register", status_code=status.HTTP_201_CREATED)
async def register_tenant(
    registration: TenantRegistration,
    client: Client = Depends(get_supabase_client),
):
    _ensure_email_available_for_signup(
        email=registration.email,
        requested_role="tenant",
        client=client,
    )

    if not verify_signup_otp(email=registration.email, otp=registration.emailOtp):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired signup OTP",
        )

    if SCHEMA_MODE == "normalized":
        record = _register_tenant_normalized(registration, client)
        return {"message": "Tenant registration stored", "record": record}

    payload = _prepare_registration_payload(registration)
    record = _insert_record(TENANT_TABLE, payload, client)
    return {"message": "Tenant registration stored", "record": record}


@router.post("/owner/register", status_code=status.HTTP_201_CREATED)
async def register_owner(
    registration: OwnerRegistration,
    client: Client = Depends(get_supabase_client),
):
    _ensure_email_available_for_signup(
        email=registration.email,
        requested_role="owner",
        client=client,
    )

    if not verify_signup_otp(email=registration.email, otp=registration.emailOtp):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired signup OTP",
        )

    if SCHEMA_MODE == "normalized":
        record = _register_owner_normalized(registration, client)
        return {"message": "Owner registration stored", "record": record}

    payload = _prepare_registration_payload(registration)
    record = _insert_record(OWNER_TABLE, payload, client)
    return {"message": "Owner registration stored", "record": record}


@router.post("/auth/login", status_code=status.HTTP_200_OK)
async def login_user(
    login: LoginRequest,
    client: Client = Depends(get_supabase_client),
):
    if SCHEMA_MODE == "normalized":
        account = _fetch_user_by_email_normalized(email=str(login.email), client=client)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )

        user_id = account.get("id")
        if user_id in (None, ""):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase returned user without id",
            )

        if not _normalized_user_has_role(user_id=str(user_id), role=login.role, client=client):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"No {login.role} account found for this email",
            )
    else:
        table = TENANT_TABLE if login.role == "tenant" else OWNER_TABLE
        account = _fetch_account(table, login.email, client)

    if SCHEMA_MODE == "normalized":
        user_id = account.get("id")
        try:
            auth_response = (
                client.table(AUTH_CREDENTIALS_TABLE)
                .select("password_hash")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:  # pragma: no cover - Supabase SDK surfaces rich errors
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Supabase auth lookup failed: {exc}",
            ) from exc

        if not auth_response.data or not isinstance(auth_response.data[0], dict):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )
        raw_password_hash = auth_response.data[0].get("password_hash")
        password_hash = raw_password_hash if isinstance(raw_password_hash, str) else None
    else:
        raw_password_hash = account.pop("password", None) or account.pop("password_hash", None)
        password_hash = raw_password_hash if isinstance(raw_password_hash, str) else None

    if not verify_password(login.password, password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if "full_name" in account and "fullName" not in account:
        account["fullName"] = account["full_name"]
    if "phone_country" in account and "phoneCountry" not in account:
        account["phoneCountry"] = account["phone_country"]

    try:
        token = create_access_token(account["id"], additional_claims={"role": login.role})
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    expires_in = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return {
        "message": "Login successful",
        "role": login.role,
        "profile": account,
        "accessToken": token,
        "expiresIn": expires_in,
    }


@router.post("/auth/google", status_code=status.HTTP_200_OK)
async def google_login_user(
    login: GoogleLoginRequest,
    client: Client = Depends(get_supabase_client),
):
    token_info = await _verify_google_id_token(login.credential)
    email = token_info.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google token did not include an email address",
        )

    if SCHEMA_MODE == "normalized":
        account = _fetch_user_by_email_normalized(email=str(email), client=client)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No account found for this email",
            )

        user_id = account.get("id")
        if user_id in (None, ""):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase returned user without id",
            )

        if not _normalized_user_has_role(user_id=str(user_id), role=login.role, client=client):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"No {login.role} account found for this email",
            )
    else:
        table = TENANT_TABLE if login.role == "tenant" else OWNER_TABLE
        account = _try_fetch_account(table, str(email), client)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No account found for this email",
            )

    if "password" in account:
        account.pop("password", None)
    if "password_hash" in account:
        account.pop("password_hash", None)

    if "full_name" in account and "fullName" not in account:
        account["fullName"] = account["full_name"]
    if "phone_country" in account and "phoneCountry" not in account:
        account["phoneCountry"] = account["phone_country"]

    try:
        token = create_access_token(account["id"], additional_claims={"role": login.role})
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc),
        ) from exc
    expires_in = ACCESS_TOKEN_EXPIRE_MINUTES * 60

    return {
        "message": "Login successful",
        "role": login.role,
        "profile": account,
        "accessToken": token,
        "expiresIn": expires_in,
    }


@router.post("/auth/forgot-password", status_code=status.HTTP_200_OK)
async def forgot_password(
    request: ForgotPasswordRequest,
    client: Client = Depends(get_supabase_client),
):
    account: dict[str, Any] | None = None
    role: str | None = None

    if SCHEMA_MODE == "normalized":
        account = _try_fetch_account(USERS_TABLE, request.email, client)
        role = str(account.get("role") or "account") if account else None
    else:
        tenant_account = _try_fetch_account(TENANT_TABLE, request.email, client)
        if tenant_account:
            account = tenant_account
            role = "tenant"
        else:
            owner_account = _try_fetch_account(OWNER_TABLE, request.email, client)
            if owner_account:
                account = owner_account
                role = "owner"

    if not account or not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found for this email",
        )

    expires_minutes = int(os.getenv("PASSWORD_RESET_OTP_EXPIRE_MINUTES", "10"))
    otp, _ = generate_reset_otp(email=request.email, expires_minutes=expires_minutes)

    expose_reset_token = os.getenv("EXPOSE_RESET_TOKEN", "false").lower() == "true"

    try:
        send_password_reset_otp_email(
            recipient_email=request.email,
            otp=otp,
            expires_minutes=expires_minutes,
        )
    except Exception as exc:  # pragma: no cover - email provider specific failures
        logger.exception("Failed to send password reset email")
        if expose_reset_token:
            return {
                "message": "Email delivery failed in current setup. Using development OTP fallback.",
                "otp": otp,
                "emailError": str(exc),
            }
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to send password reset OTP",
        ) from exc

    if expose_reset_token:
        return {
            "message": "Password reset OTP sent (development OTP included).",
            "otp": otp,
        }

    return {"message": "Password reset OTP sent to your email."}


@router.post("/auth/send-signup-otp", status_code=status.HTTP_200_OK)
async def send_signup_otp(
    request: SignupOtpRequest,
    client: Client = Depends(get_supabase_client),
):
    _ensure_email_available_for_signup(
        email=request.email,
        requested_role=request.role,
        client=client,
    )

    expires_minutes = int(os.getenv("SIGNUP_OTP_EXPIRE_MINUTES", "10"))
    otp, _ = generate_signup_otp(email=request.email, expires_minutes=expires_minutes)
    expose_otp = os.getenv("EXPOSE_RESET_TOKEN", "false").lower() == "true"

    try:
        send_signup_otp_email(
            recipient_email=request.email,
            otp=otp,
            expires_minutes=expires_minutes,
        )
    except Exception as exc:
        logger.exception("Failed to send signup OTP email")
        if expose_otp:
            return {
                "message": "Email delivery failed in current setup. Using development OTP fallback.",
                "otp": otp,
                "emailError": str(exc),
            }
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to send signup OTP",
        ) from exc

    if expose_otp:
        return {
            "message": "Signup OTP sent (development OTP included).",
            "otp": otp,
        }

    return {"message": "Signup OTP sent to your email."}


@router.post("/auth/verify-signup-otp", status_code=status.HTTP_200_OK)
async def verify_signup_otp_route(request: SignupOtpVerifyRequest):
    if not validate_signup_otp(email=request.email, otp=request.otp):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired signup OTP",
        )

    return {"message": "Signup OTP verified."}


@router.post("/auth/reset-password", status_code=status.HTTP_200_OK)
async def reset_password(
    request: ResetPasswordRequest,
    client: Client = Depends(get_supabase_client),
):
    if not request.newPassword or len(request.newPassword) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long",
        )

    if request.newPassword != request.confirmPassword:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords must match",
        )

    is_otp_valid = verify_reset_otp(email=request.email, otp=request.otp)
    if not is_otp_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OTP",
        )

    password_hash = hash_password(request.newPassword)

    if SCHEMA_MODE == "normalized":
        account = _try_fetch_account(USERS_TABLE, request.email, client)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No account found for email",
            )
        user_id = account.get("id")
        try:
            update_response = (
                client.table(AUTH_CREDENTIALS_TABLE)
                .update({"password_hash": password_hash})
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Supabase password reset failed: {exc}",
            ) from exc

        if not update_response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No matching credentials found for reset token",
            )
    else:
        tenant_account = _try_fetch_account(TENANT_TABLE, request.email, client)
        role = "tenant" if tenant_account else "owner"
        table = TENANT_TABLE if tenant_account else OWNER_TABLE
        password_column = "password_hash" if USER_PASSWORD_COLUMN == "password_hash" else USER_PASSWORD_COLUMN

        try:
            update_response = (
                client.table(table)
                .update({password_column: password_hash})
                .eq("email", request.email)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Supabase password reset failed: {exc}",
            ) from exc

        if not update_response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No matching account found for reset token",
            )

    return {"message": "Password reset successful"}
