import logging
import os
import re
from datetime import date, datetime, timezone
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from supabase import Client

from .dependencies import get_supabase_client, require_owner, require_tenant

router = APIRouter(prefix="/api", tags=["workflow"])
logger = logging.getLogger(__name__)

PROPERTIES_TABLE = os.getenv("SUPABASE_PROPERTIES_TABLE", "properties")
PROPERTY_TERMS_TABLE = os.getenv("SUPABASE_PROPERTY_TERMS_TABLE", "property_terms")
PROPERTY_MEDIA_TABLE = os.getenv("SUPABASE_PROPERTY_MEDIA_TABLE", "property_media")
USERS_TABLE = os.getenv("SUPABASE_USERS_TABLE", "users")

VISIT_REQUESTS_TABLE = os.getenv("SUPABASE_VISIT_REQUESTS_TABLE", "visit_requests")
STAY_APPLICATIONS_TABLE = os.getenv("SUPABASE_STAY_APPLICATIONS_TABLE", "stay_applications")
TENANCIES_TABLE = os.getenv("SUPABASE_TENANCIES_TABLE", "tenancies")
PAYMENTS_TABLE = os.getenv("SUPABASE_PAYMENTS_TABLE", "rent_payments")
MAINTENANCE_TABLE = os.getenv("SUPABASE_MAINTENANCE_TABLE", "maintenance_requests")
DOCUMENTS_TABLE = os.getenv("SUPABASE_DOCUMENTS_TABLE", "property_documents")

GEOCODE_PROVIDER = os.getenv("GEOCODE_PROVIDER", "nominatim").strip().lower()
GEOCODE_API_KEY = os.getenv("GEOCODE_API_KEY", "").strip()
GEOCODE_USER_AGENT = os.getenv(
    "GEOCODE_USER_AGENT",
    "rems-app/1.0 (contact: admin@example.com)",
).strip()
GEOCODE_ENABLED = os.getenv("GEOCODE_ENABLED", "true").strip().lower() not in {"false", "0", "no"}


class OwnerPropertyPayload(BaseModel):
    title: str
    propertyType: str
    bhk: str | None = None
    totalUnits: str | int | None = None
    address: str
    city: str
    state: str
    pincode: str
    propertyCountry: str | None = "IN"
    sizeCarpet: str | float | int | None = None
    sizeBuiltup: str | float | int | None = None
    floorNumber: str | int | None = None
    totalFloors: str | int | None = None
    furnishing: str | None = None
    parking: str | None = None
    petPolicy: str | None = None
    facing: str | None = None
    availableFrom: str | None = None
    description: str | None = None
    amenities: list[str] = Field(default_factory=list)

    rent: str | float | int | None = None
    deposit: str | float | int | None = None
    maintenanceCharges: str | float | int | None = None
    minLease: str | int | None = None
    houseRules: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class VisitRequestPayload(BaseModel):
    preferredDate: str | None = None
    preferredTimeSlot: str | None = None
    note: str | None = None
    fullName: str | None = None
    email: EmailStr | None = None
    phone: str | None = None


class StayApplicationPayload(BaseModel):
    moveInDate: str | None = None
    leaseMonths: int | None = None
    offeredRent: float | None = None
    note: str | None = None
    fullName: str | None = None
    email: EmailStr | None = None
    phone: str | None = None


class TenantVideoReviewPayload(BaseModel):
    decision: Literal["accept", "decline"]
    note: str | None = None


class TenantMoveOutVideoPayload(BaseModel):
    videoUrl: str
    capturedAt: str | None = None
    geoLat: float | None = None
    geoLng: float | None = None
    geoAccuracy: float | None = None
    note: str | None = None


class OwnerMoveOutReviewPayload(BaseModel):
    status: Literal["accepted", "rejected"]
    note: str | None = None


class OwnerApplicationReviewPayload(BaseModel):
    status: Literal["approved", "rejected"]
    comment: str | None = None
    leaseStart: str | None = None
    leaseEnd: str | None = None
    monthlyRent: float | None = None
    securityDeposit: float | None = None


class OwnerLeaseCreatePayload(BaseModel):
    propertyId: str
    tenantName: str | None = None
    tenantEmail: EmailStr | None = None
    tenantPhone: str | None = None
    rent: float | None = None
    deposit: float | None = None
    maintenance: float | None = None
    startDate: str
    endDate: str
    noticePeriod: int | None = 2
    paymentDay: int | None = 5
    gracePeriod: int | None = 3
    escalation: str | None = None
    notes: str | None = None


class OwnerLeaseActionPayload(BaseModel):
    action: Literal["send_renewal", "send_notice", "terminate"]
    note: str | None = None


class OwnerPaymentRecordPayload(BaseModel):
    amount: float | None = None
    paidDate: str | None = None
    method: str | None = None
    txnId: str | None = None
    note: str | None = None


class OwnerMaintenanceCreatePayload(BaseModel):
    propertyId: str
    title: str
    category: str | None = "General"
    priority: Literal["high", "medium", "low"] | None = "medium"
    description: str | None = None
    tenantId: str | None = None


class OwnerMaintenanceUpdatePayload(BaseModel):
    status: Literal["pending", "in_progress", "resolved"] | None = None
    assignedTo: str | None = None
    assignedPhone: str | None = None
    actualCost: float | None = None
    comment: str | None = None


class OwnerDocumentUpdatePayload(BaseModel):
    sharedWithTenant: bool | None = None
    verified: bool | None = None
    category: str | None = None
    tags: list[str] | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_missing_relation_error(message: str) -> bool:
    lower = message.lower()
    return "does not exist" in lower and "relation" in lower


def _extract_unknown_column(message: str) -> str | None:
    patterns = [
        r"column ['\"]?([a-zA-Z0-9_]+)['\"]? of relation ['\"]?[a-zA-Z0-9_]+['\"]? does not exist",
        r"column ['\"]?([a-zA-Z0-9_]+)['\"]? does not exist",
        r"could not find the ['\"]([a-zA-Z0-9_]+)['\"] column",
    ]
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _compact_dict(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in payload.items() if v not in (None, "", [], {})}


def _to_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _to_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()

    text = str(value).strip()
    if not text:
        return None

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        pass

    try:
        return datetime.strptime(text[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _to_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())

    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _coalesce(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _build_geocode_query(payload: OwnerPropertyPayload) -> str:
    parts = [
        payload.address,
        payload.city,
        payload.state,
        payload.pincode,
        payload.propertyCountry,
    ]
    cleaned = [str(part).strip() for part in parts if part not in (None, "") and str(part).strip()]
    return ", ".join(cleaned)


async def _geocode_address(address: str) -> tuple[float | None, float | None]:
    if not address or not GEOCODE_ENABLED:
        return None, None

    if GEOCODE_PROVIDER == "google":
        if not GEOCODE_API_KEY:
            return None, None
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {"address": address, "key": GEOCODE_API_KEY}
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
        if payload.get("status") != "OK" or not payload.get("results"):
            return None, None
        location = payload["results"][0].get("geometry", {}).get("location", {})
        return _to_float(location.get("lat")), _to_float(location.get("lng"))

    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": address, "format": "json", "limit": 1}
    headers = {"User-Agent": GEOCODE_USER_AGENT}
    async with httpx.AsyncClient(timeout=8.0, headers=headers) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
    if not payload:
        return None, None
    return _to_float(payload[0].get("lat")), _to_float(payload[0].get("lon"))


async def _apply_geocode_if_missing(
    property_payload: dict[str, Any],
    source: OwnerPropertyPayload,
) -> dict[str, Any]:
    if not GEOCODE_ENABLED:
        return property_payload
    if property_payload.get("latitude") is not None and property_payload.get("longitude") is not None:
        return property_payload
    address = _build_geocode_query(source)
    if not address:
        return property_payload
    try:
        latitude, longitude = await _geocode_address(address)
    except Exception as exc:  # pragma: no cover - do not block writes
        logger.warning("Geocode failed for '%s': %s", address, exc)
        return property_payload
    if latitude is None or longitude is None:
        return property_payload
    property_payload["latitude"] = latitude
    property_payload["longitude"] = longitude
    return property_payload


def _media_type_value(row: dict[str, Any]) -> str:
    raw = _coalesce(
        row.get("media_type"),
        row.get("type"),
        row.get("category"),
        row.get("tag"),
        row.get("label"),
        row.get("kind"),
    )
    return str(raw or "").strip().lower()


def _media_url_value(row: dict[str, Any]) -> str | None:
    return _coalesce(
        row.get("media_url"),
        row.get("url"),
        row.get("file_url"),
        row.get("video_url"),
        row.get("link"),
        row.get("media_link"),
    )


def _is_handover_media(row: dict[str, Any]) -> bool:
    media_type = _media_type_value(row)
    if media_type and any(token in media_type for token in ("handover", "move_out", "moveout", "checkout", "exit")):
        return True
    note = str(_coalesce(row.get("note"), row.get("description")) or "").lower()
    if any(token in note for token in ("handover", "move-out", "move out", "checkout")):
        return True
    return bool(row.get("tenant_id") and _media_url_value(row))


def _media_timestamp(row: dict[str, Any]) -> datetime:
    return _to_datetime(_coalesce(row.get("captured_at"), row.get("created_at"), row.get("updated_at"))) or datetime.min


def _shape_handover_media(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "url": _media_url_value(row),
        "capturedAt": _coalesce(row.get("captured_at"), row.get("created_at"), row.get("updated_at")),
        "geoLat": _to_float(_coalesce(row.get("geo_lat"), row.get("latitude"), row.get("lat"))),
        "geoLng": _to_float(_coalesce(row.get("geo_lng"), row.get("longitude"), row.get("lng"))),
        "geoAccuracy": _to_float(_coalesce(row.get("geo_accuracy"), row.get("accuracy"))),
        "note": _coalesce(row.get("note"), row.get("description")),
    }


def _latest_handover_by_property(media_rows: list[dict[str, Any]]) -> dict[Any, dict[str, Any]]:
    latest: dict[Any, dict[str, Any]] = {}
    for row in media_rows:
        if not _is_handover_media(row):
            continue
        property_id = row.get("property_id")
        if property_id in (None, ""):
            continue
        current = latest.get(property_id)
        if not current or _media_timestamp(row) > _media_timestamp(current):
            latest[property_id] = row
    return latest


def _period_label(value: Any) -> str:
    parsed = _to_date(value)
    if not parsed:
        return "-"
    return parsed.strftime("%b %Y")


def _period_sort_value(value: str) -> date:
    try:
        return datetime.strptime(value, "%b %Y").date()
    except ValueError:
        return date.min


def _initials(name: str | None) -> str:
    clean = (name or "").strip()
    if not clean:
        return "NA"
    parts = [part[0].upper() for part in clean.split() if part]
    return "".join(parts[:2]) or "NA"


def _lease_status_from_row(row: dict[str, Any]) -> str:
    raw_status = str(row.get("status") or "").lower()
    if raw_status in {"notice", "notice_given", "notice-period", "notice_period"}:
        return "notice_given"
    if raw_status in {"expired", "ended", "terminated", "closed"}:
        return "expired"

    lease_end = _to_date(row.get("lease_end"))
    if lease_end and lease_end < date.today():
        return "expired"
    if lease_end and (lease_end - date.today()).days <= 90:
        return "expiring_soon"
    return "active"


def _build_lease_history(row: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    created_at = row.get("created_at")
    if created_at:
        events.append(
            {
                "date": created_at,
                "event": "Lease record created.",
                "type": "signed",
            }
        )

    lease_start = row.get("lease_start")
    if lease_start:
        events.append(
            {
                "date": lease_start,
                "event": "Lease commenced.",
                "type": "start",
            }
        )

    raw_status = str(row.get("status") or "").lower()
    if raw_status in {"notice", "notice_given", "notice-period", "notice_period"}:
        events.append(
            {
                "date": _coalesce(row.get("notice_date"), row.get("updated_at"), _now_iso()),
                "event": "Notice period started.",
                "type": "notice",
            }
        )
    if raw_status in {"renewal_offered", "renewal_pending"}:
        events.append(
            {
                "date": _coalesce(row.get("updated_at"), _now_iso()),
                "event": "Renewal offer shared with tenant.",
                "type": "renewal",
            }
        )

    events.sort(key=lambda item: _to_date(item.get("date")) or date.today())
    return events[:8]


def _shape_owner_lease(
    *,
    row: dict[str, Any],
    property_map: dict[Any, dict[str, Any]],
    terms_map: dict[Any, dict[str, Any]],
    tenant_map: dict[Any, dict[str, Any]],
) -> dict[str, Any]:
    property_id = row.get("property_id")
    property_row = property_map.get(property_id, {})
    term_row = terms_map.get(property_id, {})
    tenant_row = tenant_map.get(row.get("tenant_id"), {})

    property_name = _coalesce(property_row.get("property_name"), f"Property {property_id}", "Property")
    property_address = ", ".join(
        [
            part
            for part in [property_row.get("address"), property_row.get("city")]
            if part not in (None, "")
        ]
    )
    tenant_name = _coalesce(
        tenant_row.get("full_name"),
        tenant_row.get("fullName"),
        tenant_row.get("name"),
        "Tenant Pending",
    )
    tenant_email = _coalesce(tenant_row.get("email"), "-")
    tenant_phone = _coalesce(tenant_row.get("phone"), tenant_row.get("phone_number"), "-")

    rent_value = _to_float(
        _coalesce(
            row.get("monthly_rent"),
            row.get("rent_amount"),
            term_row.get("expected_rent"),
        )
    ) or 0
    deposit_value = _to_float(
        _coalesce(
            row.get("security_deposit"),
            term_row.get("security_deposit"),
        )
    ) or 0
    maintenance_value = _to_float(
        _coalesce(
            row.get("maintenance_charges"),
            row.get("maintenance"),
            term_row.get("maintenance_charges"),
        )
    ) or 0

    raw_status = str(row.get("status") or "").lower()
    renewal_status = "renewal_offered" if raw_status in {"renewal_offered", "renewal_pending"} else None
    lease_status = _lease_status_from_row(row)

    return {
        "id": str(_coalesce(row.get("id"), f"LSE-{property_id or 'NA'}")),
        "propertyId": property_id,
        "propertyName": property_name,
        "propertyAddress": property_address or "-",
        "tenantId": row.get("tenant_id"),
        "tenantName": tenant_name,
        "tenantPhone": tenant_phone,
        "tenantEmail": tenant_email,
        "tenantInitials": _initials(str(tenant_name)),
        "rent": rent_value,
        "deposit": deposit_value,
        "maintenanceCharges": maintenance_value,
        "startDate": _coalesce(row.get("lease_start"), row.get("start_date")),
        "endDate": _coalesce(row.get("lease_end"), row.get("end_date")),
        "noticePeriod": _to_int(_coalesce(row.get("notice_period"), row.get("notice_period_months"), 2)) or 2,
        "status": lease_status,
        "renewalStatus": renewal_status,
        "signedDate": _coalesce(row.get("signed_at"), row.get("created_at")),
        "registrationNo": _coalesce(row.get("registration_no"), row.get("agreement_no"), "-") ,
        "renewalOffered": renewal_status == "renewal_offered",
        "noticedDate": _coalesce(row.get("notice_date"), row.get("updated_at") if lease_status == "notice_given" else None),
        "escalationClause": _coalesce(row.get("escalation_clause"), row.get("rent_escalation"), "None specified"),
        "paymentDay": _to_int(_coalesce(row.get("payment_day"), row.get("rent_due_day"), 5)) or 5,
        "gracePeriod": _to_int(_coalesce(row.get("grace_period"), row.get("rent_grace_days"), 3)) or 3,
        "history": _build_lease_history(row),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def _payment_status_from_row(row: dict[str, Any]) -> str:
    raw = str(row.get("status") or "").lower()
    if raw in {"paid", "success", "completed", "received"}:
        return "paid"

    if _to_date(_coalesce(row.get("paid_at"), row.get("paid_date"), row.get("paidDate"))):
        return "paid"

    due_date = _to_date(_coalesce(row.get("due_date"), row.get("dueDate")))
    if due_date and due_date < date.today():
        return "overdue"

    if raw in {"overdue", "late"}:
        return "overdue"

    return "upcoming"


def _shape_owner_payment(
    *,
    row: dict[str, Any],
    tenancy_by_id: dict[str, dict[str, Any]],
    tenancy_by_pair: dict[tuple[Any, Any], dict[str, Any]],
    property_map: dict[Any, dict[str, Any]],
    terms_map: dict[Any, dict[str, Any]],
    tenant_map: dict[Any, dict[str, Any]],
) -> dict[str, Any]:
    property_id = row.get("property_id")
    tenant_id = row.get("tenant_id")

    tenancy_row = None
    tenancy_id = row.get("tenancy_id")
    if tenancy_id not in (None, ""):
        tenancy_row = tenancy_by_id.get(str(tenancy_id))
    if tenancy_row is None:
        tenancy_row = tenancy_by_pair.get((property_id, tenant_id))
    tenancy_row = tenancy_row or {}

    property_row = property_map.get(property_id, {})
    term_row = terms_map.get(property_id, {})
    tenant_row = tenant_map.get(tenant_id, {})

    due_date = _coalesce(row.get("due_date"), row.get("dueDate"))
    period_source = _coalesce(
        row.get("billing_month"),
        row.get("month"),
        row.get("period"),
        due_date,
        row.get("created_at"),
    )
    period_label = _period_label(period_source)

    rent_value = _to_float(
        _coalesce(
            row.get("rent_amount"),
            row.get("monthly_rent"),
            tenancy_row.get("monthly_rent"),
            term_row.get("expected_rent"),
        )
    )
    maintenance_value = _to_float(
        _coalesce(
            row.get("maintenance_amount"),
            row.get("maintenance"),
            term_row.get("maintenance_charges"),
        )
    )

    total_value = _to_float(
        _coalesce(
            row.get("total_amount"),
            row.get("amount"),
        )
    )
    if total_value is None:
        total_value = (rent_value or 0) + (maintenance_value or 0)
    if rent_value is None:
        rent_value = max(total_value - (maintenance_value or 0), 0)
    if maintenance_value is None:
        maintenance_value = max(total_value - (rent_value or 0), 0)

    status_value = _payment_status_from_row(row)
    due_date_parsed = _to_date(due_date)
    late_by = None
    if status_value == "overdue" and due_date_parsed:
        late_by = max((date.today() - due_date_parsed).days, 0)

    paid_date = _coalesce(row.get("paid_at"), row.get("paid_date"), row.get("paidDate"))
    receipt = _coalesce(row.get("receipt_no"), row.get("receipt_id"), row.get("receipt"))
    if not receipt and status_value == "paid":
        record_tail = str(row.get("id") or "0000")[-4:]
        receipt = f"RCP-{period_label.replace(' ', '-').upper()}-{record_tail}"

    tenant_name = _coalesce(
        tenant_row.get("full_name"),
        tenant_row.get("fullName"),
        tenant_row.get("name"),
        "Tenant",
    )

    property_name = _coalesce(property_row.get("property_name"), f"Property {property_id}", "Property")
    property_address = ", ".join(
        [
            part
            for part in [property_row.get("address"), property_row.get("city")]
            if part not in (None, "")
        ]
    )

    return {
        "id": str(_coalesce(row.get("id"), f"PAY-{property_id or 'NA'}")),
        "propertyId": property_id,
        "propertyName": property_name,
        "propertyAddress": property_address or "-",
        "tenantId": tenant_id,
        "tenantName": tenant_name,
        "tenantInitials": _initials(str(tenant_name)),
        "tenantPhone": _coalesce(tenant_row.get("phone"), tenant_row.get("phone_number"), "-"),
        "period": period_label,
        "rent": round(rent_value, 2),
        "maintenance": round(maintenance_value, 2),
        "total": round(total_value, 2),
        "dueDate": due_date,
        "paidDate": paid_date,
        "status": status_value,
        "receipt": receipt,
        "txnId": _coalesce(row.get("transaction_id"), row.get("txn_id"), row.get("txnId")),
        "lateBy": late_by,
    }


def _normalize_maintenance_status(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"resolved", "closed", "completed", "done", "fixed"}:
        return "resolved"
    if raw in {"in_progress", "in-progress", "assigned", "working", "ongoing"}:
        return "in_progress"
    return "pending"


def _normalize_maintenance_priority(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"high", "urgent", "critical"}:
        return "high"
    if raw in {"low", "minor"}:
        return "low"
    return "medium"


def _shape_owner_maintenance(
    *,
    row: dict[str, Any],
    property_map: dict[Any, dict[str, Any]],
    tenant_map: dict[Any, dict[str, Any]],
) -> dict[str, Any]:
    property_id = row.get("property_id")
    tenant_id = row.get("tenant_id")

    property_row = property_map.get(property_id, {})
    tenant_row = tenant_map.get(tenant_id, {})

    property_name = _coalesce(
        property_row.get("property_name"),
        row.get("property_name"),
        f"Property {property_id}" if property_id not in (None, "") else "Property",
    )
    tenant_name = _coalesce(
        tenant_row.get("full_name"),
        tenant_row.get("fullName"),
        tenant_row.get("name"),
        row.get("tenant_name"),
        row.get("tenant"),
        "-",
    )
    tenant_phone = _coalesce(
        tenant_row.get("phone"),
        tenant_row.get("phone_number"),
        row.get("tenant_phone"),
        row.get("tenantPhone"),
        "-",
    )

    comments: list[dict[str, Any]] = []
    raw_comments = row.get("comments")
    if isinstance(raw_comments, list):
        for item in raw_comments:
            if isinstance(item, dict):
                comments.append(
                    {
                        "by": _coalesce(item.get("by"), item.get("author"), "Owner"),
                        "time": _coalesce(item.get("time"), item.get("date")),
                        "text": _coalesce(item.get("text"), item.get("comment"), ""),
                    }
                )
            elif isinstance(item, str) and item.strip():
                comments.append({"by": "Owner", "time": None, "text": item.strip()})
    elif isinstance(raw_comments, str) and raw_comments.strip():
        comments.append({"by": "Owner", "time": None, "text": raw_comments.strip()})

    owner_comment = _coalesce(row.get("owner_comment"), row.get("comment"))
    if owner_comment and not comments:
        comments.append({"by": "Owner", "time": None, "text": str(owner_comment)})

    raw_images = row.get("images")
    if isinstance(raw_images, list):
        image_count = len(raw_images)
    else:
        image_count = _to_int(_coalesce(row.get("image_count"), row.get("attachments_count"), raw_images)) or 0

    estimated_cost = _to_float(_coalesce(row.get("estimated_cost"), row.get("estimated_amount"), row.get("estimatedCost")))
    actual_cost = _to_float(_coalesce(row.get("actual_cost"), row.get("cost"), row.get("actualCost")))

    return {
        "id": str(_coalesce(row.get("id"), f"MNT-{property_id or 'NA'}")),
        "propertyId": property_id,
        "tenantId": tenant_id,
        "title": _coalesce(row.get("title"), row.get("issue"), row.get("subject"), "Maintenance request"),
        "property": property_name,
        "tenant": tenant_name,
        "tenantPhone": tenant_phone,
        "category": _coalesce(row.get("category"), "General"),
        "priority": _normalize_maintenance_priority(_coalesce(row.get("priority"), row.get("severity"))),
        "status": _normalize_maintenance_status(_coalesce(row.get("status"), row.get("ticket_status"))),
        "createdAt": _coalesce(row.get("created_at"), row.get("createdAt"), row.get("date")),
        "updatedAt": _coalesce(row.get("updated_at"), row.get("updatedAt"), row.get("created_at")),
        "assignedTo": _coalesce(row.get("assigned_to"), row.get("assigned_vendor"), row.get("vendor"), row.get("assignedTo")),
        "assignedPhone": _coalesce(row.get("assigned_phone"), row.get("vendor_phone"), row.get("assignedPhone")),
        "estimatedCost": round(estimated_cost, 2) if estimated_cost is not None else None,
        "actualCost": round(actual_cost, 2) if actual_cost is not None else None,
        "description": _coalesce(row.get("description"), row.get("details"), row.get("issue_description"), row.get("note"), ""),
        "images": image_count,
        "comments": comments,
    }


def _shape_owner_document(
    *,
    row: dict[str, Any],
    property_map: dict[Any, dict[str, Any]],
    tenant_map: dict[Any, dict[str, Any]],
) -> dict[str, Any]:
    property_id = row.get("property_id")
    tenant_id = row.get("tenant_id")

    property_row = property_map.get(property_id, {})
    tenant_row = tenant_map.get(tenant_id, {})

    name = _coalesce(row.get("name"), row.get("file_name"), row.get("title"), "Document")

    shared_raw = _coalesce(row.get("shared_with_tenant"), row.get("sharedWithTenant"), False)
    if isinstance(shared_raw, str):
        shared_with_tenant = shared_raw.strip().lower() in {"1", "true", "yes", "shared"}
    else:
        shared_with_tenant = bool(shared_raw)

    verified_raw = _coalesce(row.get("verified"), row.get("is_verified"), row.get("verification_status"), False)
    if isinstance(verified_raw, str):
        verified = verified_raw.strip().lower() in {"1", "true", "yes", "verified", "approved"}
    else:
        verified = bool(verified_raw)

    tags_raw = row.get("tags")
    tags: list[str] = []
    if isinstance(tags_raw, list):
        tags = [str(tag).strip() for tag in tags_raw if str(tag).strip()]
    elif isinstance(tags_raw, str):
        tags = [part.strip() for part in tags_raw.split(",") if part.strip()]

    size_raw = _coalesce(row.get("size"), row.get("file_size"), row.get("size_label"))
    size_value = str(size_raw).strip() if size_raw not in (None, "") else "-"

    file_type = _coalesce(row.get("file_type"), row.get("type"), row.get("mime_type"))
    if not file_type and isinstance(name, str) and "." in name:
        file_type = name.rsplit(".", 1)[1].lower()

    return {
        "id": str(_coalesce(row.get("id"), f"DOC-{property_id or 'NA'}")),
        "propertyId": property_id,
        "tenantId": tenant_id,
        "name": name,
        "category": _coalesce(row.get("category"), row.get("document_type"), "Other"),
        "property": _coalesce(property_row.get("property_name"), row.get("property_name"), "-"),
        "tenant": _coalesce(
            tenant_row.get("full_name"),
            tenant_row.get("fullName"),
            tenant_row.get("name"),
            row.get("tenant_name"),
        ),
        "size": size_value,
        "date": _coalesce(row.get("created_at"), row.get("uploaded_at"), row.get("date"), row.get("updated_at")),
        "type": str(file_type).lower() if file_type not in (None, "") else "file",
        "sharedWithTenant": shared_with_tenant,
        "verified": verified,
        "tags": tags,
    }


def _build_owner_payouts(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}

    for item in records:
        period = str(item.get("period") or "-")
        if period == "-":
            continue

        bucket = grouped.setdefault(
            period,
            {
                "period": period,
                "grossRent": 0.0,
                "latestPaid": None,
            },
        )

        if item.get("status") != "paid":
            continue

        total = _to_float(item.get("total")) or 0.0
        bucket["grossRent"] += total

        paid_date = _to_date(item.get("paidDate"))
        latest_paid = bucket.get("latestPaid")
        if paid_date and (latest_paid is None or paid_date > latest_paid):
            bucket["latestPaid"] = paid_date

    current_period = _period_label(date.today().isoformat())
    if current_period not in grouped:
        grouped[current_period] = {
            "period": current_period,
            "grossRent": 0.0,
            "latestPaid": None,
        }

    payouts: list[dict[str, Any]] = []
    for period, bucket in grouped.items():
        gross = round(float(bucket.get("grossRent") or 0.0), 2)
        platform_fee = round(gross * 0.03, 2) if gross else None
        tax = round(gross * 0.02, 2) if gross else None
        net_payout = round(gross - (platform_fee or 0) - (tax or 0), 2) if gross else None

        latest_paid = bucket.get("latestPaid")
        payouts.append(
            {
                "id": f"PO-{period.replace(' ', '-').upper()}",
                "period": period,
                "grossRent": gross if gross else None,
                "platformFee": platform_fee,
                "tax": tax,
                "netPayout": net_payout,
                "settledDate": latest_paid.isoformat() if latest_paid else None,
                "method": "Auto transfer",
                "status": "settled" if gross else "pending",
            }
        )

    payouts.sort(key=lambda item: _period_sort_value(str(item.get("period") or "")), reverse=True)
    return payouts[:12]


def _required_select(
    *,
    client: Client,
    table: str,
    columns: str = "*",
    filters: list[tuple[str, str, Any]] | None = None,
) -> list[dict[str, Any]]:
    try:
        query = client.table(table).select(columns)
        for op, key, value in filters or []:
            if op == "eq":
                query = query.eq(key, value)
            elif op == "in":
                query = query.in_(key, value)
            elif op == "ilike":
                query = query.ilike(key, value)
        response = query.execute()
    except Exception as exc:  # pragma: no cover - Supabase runtime errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase select failed for {table}: {exc}",
        ) from exc

    result: list[dict[str, Any]] = []
    for row in response.data or []:
        if isinstance(row, dict):
            result.append(dict(row))
    return result


def _safe_select(
    *,
    client: Client,
    table: str,
    columns: str = "*",
    filters: list[tuple[str, str, Any]] | None = None,
) -> list[dict[str, Any]]:
    try:
        return _required_select(client=client, table=table, columns=columns, filters=filters)
    except HTTPException as exc:
        if _is_missing_relation_error(str(exc.detail)):
            logger.warning("Optional table '%s' not available yet", table)
            return []
        raise


def _required_insert(*, client: Client, table: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        response = client.table(table).insert(payload).execute()
    except Exception as exc:  # pragma: no cover - Supabase runtime errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase insert failed for {table}: {exc}",
        ) from exc

    if not response.data or not isinstance(response.data[0], dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Supabase insert returned no data for {table}",
        )

    return dict(response.data[0])


def _optional_insert(*, client: Client, table: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        return _required_insert(client=client, table=table, payload=payload)
    except HTTPException as exc:
        if _is_missing_relation_error(str(exc.detail)):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    f"Workflow table '{table}' is not configured yet. "
                    "Create migration for workflow tables and retry."
                ),
            ) from exc
        raise


def _optional_insert_resilient(*, client: Client, table: str, payload: dict[str, Any]) -> dict[str, Any]:
    working_payload = dict(payload)
    attempts = 0
    max_attempts = max(len(working_payload), 1)

    while attempts < max_attempts:
        attempts += 1
        try:
            return _optional_insert(client=client, table=table, payload=working_payload)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
                raise

            missing_column = _extract_unknown_column(str(exc.detail))
            if missing_column and missing_column in working_payload:
                working_payload.pop(missing_column, None)
                if not working_payload:
                    break
                continue
            raise

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unable to create record in {table}: no compatible columns found for payload",
    )


def _optional_update_resilient(
    *,
    client: Client,
    table: str,
    payload: dict[str, Any],
    filters: list[tuple[str, Any]],
) -> dict[str, Any] | None:
    working_payload = dict(payload)
    attempts = 0
    max_attempts = max(len(working_payload), 1)

    while attempts < max_attempts:
        attempts += 1
        try:
            return _required_update(
                client=client,
                table=table,
                payload=working_payload,
                filters=filters,
            )
        except HTTPException as exc:
            missing_column = _extract_unknown_column(str(exc.detail))
            if missing_column and missing_column in working_payload:
                working_payload.pop(missing_column, None)
                if not working_payload:
                    return None
                continue
            raise

    return None


def _required_update(
    *,
    client: Client,
    table: str,
    payload: dict[str, Any],
    filters: list[tuple[str, Any]],
) -> dict[str, Any] | None:
    try:
        query = client.table(table).update(payload)
        for key, value in filters:
            query = query.eq(key, value)
        response = query.execute()
    except Exception as exc:  # pragma: no cover - Supabase runtime errors
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Supabase update failed for {table}: {exc}",
        ) from exc

    if not response.data:
        return None
    first = response.data[0]
    return dict(first) if isinstance(first, dict) else None


def _serialize_property(property_row: dict[str, Any], term_row: dict[str, Any] | None = None) -> dict[str, Any]:
    terms = term_row or {}
    return {
        "id": property_row.get("id"),
        "title": property_row.get("property_name"),
        "propertyType": property_row.get("property_type"),
        "bhk": property_row.get("bhk"),
        "totalUnits": property_row.get("total_units"),
        "address": property_row.get("address"),
        "city": property_row.get("city"),
        "state": property_row.get("state_region"),
        "pincode": property_row.get("postal_code"),
        "propertyCountry": property_row.get("country"),
        "sizeCarpet": property_row.get("size_sqft"),
        "sizeBuiltup": property_row.get("builtup_sqft"),
        "floorNumber": property_row.get("floor_number"),
        "totalFloors": property_row.get("total_floors"),
        "furnishing": property_row.get("furnishing"),
        "parking": property_row.get("parking"),
        "petPolicy": property_row.get("pet_policy"),
        "facing": property_row.get("facing"),
        "availableFrom": property_row.get("available_from"),
        "description": property_row.get("description"),
        "amenities": property_row.get("amenities") or [],
        "status": property_row.get("status") or "vacant",
        "publishState": property_row.get("publish_state") or "published",
        "createdAt": property_row.get("created_at"),
        "updatedAt": property_row.get("updated_at"),
        "rent": terms.get("expected_rent"),
        "deposit": terms.get("security_deposit"),
        "maintenanceCharges": terms.get("maintenance_charges"),
        "minLease": terms.get("min_agreement_months"),
        "houseRules": terms.get("house_rules"),
        "listedAt": _coalesce(property_row.get("listed_at"), property_row.get("listedAt"), property_row.get("created_at")),
        "views": _to_int(_coalesce(property_row.get("views"), property_row.get("view_count"), property_row.get("viewCount"))) or 0,
        "inquiries": _to_int(_coalesce(property_row.get("inquiries"), property_row.get("inquiry_count"), property_row.get("inquiryCount"))) or 0,
        "rating": _to_float(_coalesce(property_row.get("rating"), property_row.get("tenant_rating"), property_row.get("tenantRating"))) or 0,
        "registrationNo": _coalesce(property_row.get("registration_no"), property_row.get("registrationNo")),
        "latitude": _to_float(
            _coalesce(property_row.get("latitude"), property_row.get("lat"), property_row.get("geo_lat"))
        ),
        "longitude": _to_float(
            _coalesce(property_row.get("longitude"), property_row.get("lng"), property_row.get("geo_lng"))
        ),
    }


def _build_property_payload(owner_id: Any, payload: OwnerPropertyPayload) -> dict[str, Any]:
    return _compact_dict(
        {
            "owner_id": owner_id,
            "property_name": payload.title,
            "property_type": payload.propertyType,
            "bhk": payload.bhk,
            "total_units": _to_int(payload.totalUnits),
            "address": payload.address,
            "city": payload.city,
            "state_region": payload.state,
            "country": payload.propertyCountry,
            "postal_code": payload.pincode,
            "size_sqft": _to_float(payload.sizeCarpet),
            "builtup_sqft": _to_float(payload.sizeBuiltup),
            "floor_number": _to_int(payload.floorNumber),
            "total_floors": _to_int(payload.totalFloors),
            "furnishing": payload.furnishing,
            "parking": payload.parking,
            "pet_policy": payload.petPolicy,
            "facing": payload.facing,
            "available_from": payload.availableFrom,
            "description": payload.description,
            "amenities": payload.amenities,
            "latitude": _to_float(payload.latitude),
            "longitude": _to_float(payload.longitude),
        }
    )


def _build_terms_payload(property_id: Any, payload: OwnerPropertyPayload) -> dict[str, Any]:
    return _compact_dict(
        {
            "property_id": property_id,
            "expected_rent": _to_float(payload.rent),
            "security_deposit": _to_float(payload.deposit),
            "maintenance_charges": _to_float(payload.maintenanceCharges),
            "min_agreement_months": _to_int(payload.minLease),
            "house_rules": payload.houseRules,
        }
    )


def _increment_property_views(*, client: Client, property_row: dict[str, Any]) -> dict[str, Any] | None:
    if not property_row:
        return None

    property_id = property_row.get("id")
    if property_id in (None, ""):
        return None

    view_field = None
    for candidate in ("views", "view_count", "viewCount"):
        if candidate in property_row:
            view_field = candidate
            break

    if not view_field:
        return None

    current = _to_int(property_row.get(view_field)) or 0
    payload = {view_field: current + 1}
    if "updated_at" in property_row:
        payload["updated_at"] = _now_iso()

    updated = _optional_update_resilient(
        client=client,
        table=PROPERTIES_TABLE,
        payload=payload,
        filters=[("id", property_id)],
    )
    if updated and view_field in updated:
        property_row[view_field] = updated.get(view_field)

    return updated


def _get_property_terms_map(*, client: Client, property_ids: list[Any]) -> dict[Any, dict[str, Any]]:
    if not property_ids:
        return {}
    terms = _required_select(
        client=client,
        table=PROPERTY_TERMS_TABLE,
        filters=[("in", "property_id", property_ids)],
    )
    return {row.get("property_id"): row for row in terms}


def _get_property_for_owner(*, client: Client, owner_id: Any, property_id: Any) -> dict[str, Any]:
    rows = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "id", property_id), ("eq", "owner_id", owner_id)],
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found for this owner",
        )
    return rows[0]


@router.get("/owner/properties", status_code=status.HTTP_200_OK)
async def list_owner_properties(
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )

    property_ids = [row.get("id") for row in properties if row.get("id") is not None]
    terms_map = _get_property_terms_map(client=client, property_ids=property_ids)

    serialized = [_serialize_property(row, terms_map.get(row.get("id"))) for row in properties]
    return {"items": serialized, "count": len(serialized)}


@router.get("/owner/properties/{property_id}", status_code=status.HTTP_200_OK)
async def get_owner_property(
    property_id: str,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    property_row = _get_property_for_owner(client=client, owner_id=owner_id, property_id=property_id)

    term_rows = _required_select(
        client=client,
        table=PROPERTY_TERMS_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    term_row = term_rows[0] if term_rows else None

    media_rows = _safe_select(
        client=client,
        table=PROPERTY_MEDIA_TABLE,
        filters=[("eq", "property_id", property_id)],
    )

    payments = _safe_select(
        client=client,
        table=PAYMENTS_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    maintenance = _safe_select(
        client=client,
        table=MAINTENANCE_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    documents = _safe_select(
        client=client,
        table=DOCUMENTS_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    visit_rows = _safe_select(
        client=client,
        table=VISIT_REQUESTS_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    application_rows = _safe_select(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        filters=[("eq", "property_id", property_id)],
    )

    tenancy_rows = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    active_tenancy = next(
        (
            row
            for row in tenancy_rows
            if str(row.get("status", "")).lower() in {"active", "current", "running"}
        ),
        None,
    )

    property_payload = _serialize_property(property_row, term_row)
    inquiries_total = len(visit_rows) + len(application_rows)
    current_inquiries = _to_int(property_payload.get("inquiries")) or 0
    property_payload["inquiries"] = max(current_inquiries, inquiries_total)

    return {
        "property": property_payload,
        "media": media_rows,
        "activeTenancy": active_tenancy,
        "payments": payments,
        "maintenance": maintenance,
        "documents": documents,
    }


@router.post("/owner/properties", status_code=status.HTTP_201_CREATED)
async def create_owner_property(
    payload: OwnerPropertyPayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    property_payload = _build_property_payload(owner_id, payload)
    property_payload = await _apply_geocode_if_missing(property_payload, payload)
    property_row = _required_insert(client=client, table=PROPERTIES_TABLE, payload=property_payload)

    terms_payload = _build_terms_payload(property_row.get("id"), payload)
    term_row = _required_insert(client=client, table=PROPERTY_TERMS_TABLE, payload=terms_payload)

    return {
        "message": "Property created",
        "property": _serialize_property(property_row, term_row),
    }


@router.put("/owner/properties/{property_id}", status_code=status.HTTP_200_OK)
async def update_owner_property(
    property_id: str,
    payload: OwnerPropertyPayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    _get_property_for_owner(client=client, owner_id=owner_id, property_id=property_id)

    property_payload = _build_property_payload(owner_id, payload)
    property_payload.pop("owner_id", None)
    property_payload = await _apply_geocode_if_missing(property_payload, payload)
    property_row = _required_update(
        client=client,
        table=PROPERTIES_TABLE,
        payload=property_payload,
        filters=[("id", property_id), ("owner_id", owner_id)],
    )
    if not property_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found for update",
        )

    terms_payload = _build_terms_payload(property_id, payload)
    existing_terms = _required_select(
        client=client,
        table=PROPERTY_TERMS_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    if existing_terms:
        term_row = _required_update(
            client=client,
            table=PROPERTY_TERMS_TABLE,
            payload=terms_payload,
            filters=[("property_id", property_id)],
        )
    else:
        term_row = _required_insert(client=client, table=PROPERTY_TERMS_TABLE, payload=terms_payload)

    return {
        "message": "Property updated",
        "property": _serialize_property(property_row, term_row),
    }


@router.get("/owner/dashboard", status_code=status.HTTP_200_OK)
async def owner_dashboard(
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )

    property_ids = [row.get("id") for row in properties if row.get("id") is not None]
    terms_map = _get_property_terms_map(client=client, property_ids=property_ids)

    rents = []
    occupied = 0
    vacant = 0
    notice = 0

    for row in properties:
        status_value = str(row.get("status") or "vacant").lower()
        if status_value == "occupied":
            occupied += 1
        elif status_value == "notice":
            notice += 1
        else:
            vacant += 1

        term_row = terms_map.get(row.get("id"))
        rent_value = _to_float((term_row or {}).get("expected_rent"))
        if rent_value is not None:
            rents.append(rent_value)

    visit_requests = _safe_select(
        client=client,
        table=VISIT_REQUESTS_TABLE,
        filters=[("in", "property_id", property_ids)] if property_ids else None,
    ) if property_ids else []
    applications = _safe_select(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        filters=[("in", "property_id", property_ids)] if property_ids else None,
    ) if property_ids else []

    pending_visits = sum(1 for row in visit_requests if str(row.get("status", "")).lower() == "pending")
    pending_applications = sum(1 for row in applications if str(row.get("status", "")).lower() == "pending")

    return {
        "summary": {
            "totalProperties": len(properties),
            "occupiedProperties": occupied,
            "vacantProperties": vacant,
            "noticeProperties": notice,
            "totalExpectedRent": round(sum(rents), 2),
            "averageRent": round(sum(rents) / len(rents), 2) if rents else 0,
            "pendingVisitRequests": pending_visits,
            "pendingApplications": pending_applications,
        },
        "recentApplications": applications[:8],
        "recentVisitRequests": visit_requests[:8],
    }


@router.get("/properties/browse", status_code=status.HTTP_200_OK)
async def browse_properties(
    city: str | None = Query(default=None),
    propertyType: str | None = Query(default=None),
    bhk: str | None = Query(default=None),
    minRent: float | None = Query(default=None),
    maxRent: float | None = Query(default=None),
    availableOnly: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=200),
    client: Client = Depends(get_supabase_client),
):
    filters: list[tuple[str, str, Any]] = []
    if city:
        filters.append(("ilike", "city", f"%{city}%"))
    if propertyType:
        filters.append(("eq", "property_type", propertyType))
    if bhk:
        filters.append(("eq", "bhk", bhk))

    properties = _required_select(client=client, table=PROPERTIES_TABLE, filters=filters)
    properties = properties[:limit]

    property_ids = [row.get("id") for row in properties if row.get("id") is not None]
    terms_map = _get_property_terms_map(client=client, property_ids=property_ids)

    serialized = []
    for row in properties:
        term_row = terms_map.get(row.get("id"))
        item = _serialize_property(row, term_row)
        rent_value = _to_float(item.get("rent"))

        if availableOnly and str(item.get("status", "")).lower() == "occupied":
            continue
        if minRent is not None and (rent_value is None or rent_value < minRent):
            continue
        if maxRent is not None and (rent_value is None or rent_value > maxRent):
            continue

        serialized.append(item)

    return {"items": serialized, "count": len(serialized)}


@router.get("/tenant/properties/{property_id}", status_code=status.HTTP_200_OK)
async def get_tenant_property_detail(
    property_id: str,
    _: dict[str, Any] = Depends(require_tenant),
    client: Client = Depends(get_supabase_client),
):
    property_rows = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "id", property_id)],
    )
    if not property_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found",
        )

    property_row = property_rows[0]
    _increment_property_views(client=client, property_row=property_row)
    owner_id = property_row.get("owner_id")

    term_rows = _required_select(
        client=client,
        table=PROPERTY_TERMS_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    term_row = term_rows[0] if term_rows else None

    owner_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("eq", "id", owner_id)] if owner_id not in (None, "") else None,
    ) if owner_id not in (None, "") else []
    owner_row = owner_rows[0] if owner_rows else {}

    media_rows = _safe_select(
        client=client,
        table=PROPERTY_MEDIA_TABLE,
        filters=[("eq", "property_id", property_id)],
    )
    latest_handover = None
    for row in media_rows:
        if not _is_handover_media(row):
            continue
        if not latest_handover or _media_timestamp(row) > _media_timestamp(latest_handover):
            latest_handover = row

    return {
        "property": _serialize_property(property_row, term_row),
        "owner": {
            "id": owner_row.get("id"),
            "name": _coalesce(owner_row.get("full_name"), owner_row.get("fullName"), owner_row.get("name"), "Owner"),
            "email": owner_row.get("email"),
            "phone": _coalesce(owner_row.get("phone"), owner_row.get("phone_number")),
        },
        "mediaCount": len(media_rows),
        "handoverVideo": _shape_handover_media(latest_handover) if latest_handover else None,
    }


@router.post("/tenant/properties/{property_id}/visit-requests", status_code=status.HTTP_201_CREATED)
async def create_visit_request(
    property_id: str,
    payload: VisitRequestPayload,
    tenant: dict[str, Any] = Depends(require_tenant),
    client: Client = Depends(get_supabase_client),
):
    property_rows = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "id", property_id)],
    )
    if not property_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found",
        )

    property_row = property_rows[0]
    tenant_name = _coalesce(payload.fullName, tenant.get("full_name"), tenant.get("fullName"), tenant.get("name"))
    tenant_email = _coalesce(payload.email, tenant.get("email"))
    tenant_phone = _coalesce(payload.phone, tenant.get("phone"), tenant.get("phone_number"))
    visit_payload = _compact_dict(
        {
            "property_id": property_id,
            "owner_id": property_row.get("owner_id"),
            "tenant_id": tenant.get("id"),
            "status": "pending",
            "preferred_date": payload.preferredDate,
            "preferred_time_slot": payload.preferredTimeSlot,
            "note": payload.note,
            "tenant_name": tenant_name,
            "tenant_email": tenant_email,
            "tenant_phone": tenant_phone,
            "created_at": _now_iso(),
        }
    )
    visit_row = _optional_insert_resilient(client=client, table=VISIT_REQUESTS_TABLE, payload=visit_payload)
    return {"message": "Visit request submitted", "visitRequest": visit_row}


@router.post("/tenant/properties/{property_id}/applications", status_code=status.HTTP_201_CREATED)
async def create_stay_application(
    property_id: str,
    payload: StayApplicationPayload,
    tenant: dict[str, Any] = Depends(require_tenant),
    client: Client = Depends(get_supabase_client),
):
    property_rows = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "id", property_id)],
    )
    if not property_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found",
        )

    property_row = property_rows[0]
    tenant_id = tenant.get("id")
    existing_apps = _safe_select(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        filters=[("eq", "property_id", property_id), ("eq", "tenant_id", tenant_id)],
    )
    if existing_apps:
        blocked_statuses = {
            "pending",
            "approved",
            "active",
            "under_review",
            "in_review",
            "accepted",
            "video_accepted",
            "handover_pending",
        }
        allow_retry_statuses = {"rejected", "cancelled", "withdrawn"}
        for app in existing_apps:
            status_value = str(app.get("status") or "pending").strip().lower()
            if status_value in allow_retry_statuses:
                continue
            if status_value in blocked_statuses or status_value:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="You already have an active application for this property.",
                )

    tenant_name = _coalesce(payload.fullName, tenant.get("full_name"), tenant.get("fullName"), tenant.get("name"))
    tenant_email = _coalesce(payload.email, tenant.get("email"))
    tenant_phone = _coalesce(payload.phone, tenant.get("phone"), tenant.get("phone_number"))
    application_payload = _compact_dict(
        {
            "property_id": property_id,
            "owner_id": property_row.get("owner_id"),
            "tenant_id": tenant_id,
            "status": "pending",
            "requested_move_in_date": payload.moveInDate,
            "requested_lease_months": payload.leaseMonths,
            "offered_rent": payload.offeredRent,
            "note": payload.note,
            "property_title": property_row.get("property_name"),
            "property_city": property_row.get("city"),
            "property_address": property_row.get("address"),
            "tenant_name": tenant_name,
            "tenant_email": tenant_email,
            "tenant_phone": tenant_phone,
            "created_at": _now_iso(),
        }
    )
    application_row = _optional_insert_resilient(client=client, table=STAY_APPLICATIONS_TABLE, payload=application_payload)
    return {"message": "Stay application submitted", "application": application_row}


@router.get("/tenant/applications", status_code=status.HTTP_200_OK)
async def list_tenant_applications(
    tenant: dict[str, Any] = Depends(require_tenant),
    client: Client = Depends(get_supabase_client),
):
    tenant_id = tenant.get("id")
    applications = _safe_select(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        filters=[("eq", "tenant_id", tenant_id)],
    )

    property_ids = sorted(
        {row.get("property_id") for row in applications if row.get("property_id") not in (None, "")},
        key=str,
    )
    properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("in", "id", property_ids)] if property_ids else None,
    ) if property_ids else []
    property_map = {row.get("id"): row for row in properties}
    media_rows = _safe_select(
        client=client,
        table=PROPERTY_MEDIA_TABLE,
        filters=[("in", "property_id", property_ids)] if property_ids else None,
    ) if property_ids else []
    handover_by_property = _latest_handover_by_property(media_rows)

    shaped = []
    for app in applications:
        property_row = property_map.get(app.get("property_id"), {})
        property_title = _coalesce(property_row.get("property_name"), app.get("property_title"), "Property")
        property_city = _coalesce(property_row.get("city"), app.get("property_city"))
        property_address = _coalesce(property_row.get("address"), app.get("property_address"))
        handover_media = handover_by_property.get(app.get("property_id"))
        video_review_status = _coalesce(app.get("video_review_status"), app.get("videoReviewStatus"))
        shaped.append(
            {
                "id": app.get("id"),
                "propertyId": app.get("property_id"),
                "status": _coalesce(app.get("status"), "pending"),
                "requestedMoveInDate": app.get("requested_move_in_date"),
                "requestedLeaseMonths": app.get("requested_lease_months"),
                "offeredRent": app.get("offered_rent"),
                "createdAt": app.get("created_at"),
                "reviewedAt": app.get("reviewed_at"),
                "ownerComment": _coalesce(app.get("owner_comment"), app.get("comment"), app.get("owner_note")),
                "leaseStart": _coalesce(app.get("lease_start"), app.get("leaseStart")),
                "leaseEnd": _coalesce(app.get("lease_end"), app.get("leaseEnd")),
                "monthlyRent": _coalesce(app.get("monthly_rent"), app.get("monthlyRent")),
                "securityDeposit": _coalesce(app.get("security_deposit"), app.get("securityDeposit")),
                "videoReviewStatus": video_review_status,
                "handoverVideo": _shape_handover_media(handover_media) if handover_media else None,
                "property": {
                    "id": property_row.get("id"),
                    "title": property_title,
                    "city": property_city,
                    "address": property_address,
                },
            }
        )

    shaped.sort(key=lambda item: _to_date(item.get("createdAt")) or date.min, reverse=True)
    return {"items": shaped, "count": len(shaped)}


@router.get("/owner/applications", status_code=status.HTTP_200_OK)
async def list_owner_applications(
    statusFilter: str | None = Query(default=None),
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    owner_property_ids = [row.get("id") for row in owner_properties if row.get("id") not in (None, "")]

    if not owner_property_ids:
        return {"items": [], "count": 0}

    filters: list[tuple[str, str, Any]] = [("in", "property_id", owner_property_ids)]
    if statusFilter:
        filters.append(("eq", "status", statusFilter))

    applications = _safe_select(client=client, table=STAY_APPLICATIONS_TABLE, filters=filters)
    property_ids = [row.get("property_id") for row in applications if row.get("property_id") is not None]
    tenant_ids = [row.get("tenant_id") for row in applications if row.get("tenant_id") is not None]

    properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("in", "id", property_ids)] if property_ids else None,
    ) if property_ids else []
    users = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("in", "id", tenant_ids)] if tenant_ids else None,
    ) if tenant_ids else []

    property_map = {row.get("id"): row for row in properties}
    user_map = {row.get("id"): row for row in users}

    shaped = []
    for app in applications:
        property_row = property_map.get(app.get("property_id"), {})
        tenant_row = user_map.get(app.get("tenant_id"), {})
        tenant_name = _coalesce(
            tenant_row.get("full_name"),
            tenant_row.get("fullName"),
            tenant_row.get("name"),
            app.get("tenant_name"),
            "Tenant",
        )
        tenant_email = _coalesce(tenant_row.get("email"), app.get("tenant_email"))
        tenant_phone = _coalesce(tenant_row.get("phone"), tenant_row.get("phone_number"), app.get("tenant_phone"))
        property_title = _coalesce(property_row.get("property_name"), app.get("property_title"), "Property")
        property_city = _coalesce(property_row.get("city"), app.get("property_city"))
        video_review_status = _coalesce(app.get("video_review_status"), app.get("videoReviewStatus"))
        shaped.append(
            {
                **app,
                "property": {
                    "id": property_row.get("id"),
                    "title": property_title,
                    "city": property_city,
                },
                "tenant": {
                    "id": tenant_row.get("id"),
                    "email": tenant_email,
                    "name": tenant_name,
                    "phone": tenant_phone,
                },
                "leaseStart": _coalesce(app.get("lease_start"), app.get("leaseStart")),
                "leaseEnd": _coalesce(app.get("lease_end"), app.get("leaseEnd")),
                "monthlyRent": _coalesce(app.get("monthly_rent"), app.get("monthlyRent")),
                "securityDeposit": _coalesce(app.get("security_deposit"), app.get("securityDeposit")),
                "videoReviewStatus": video_review_status,
            }
        )

    return {"items": shaped, "count": len(shaped)}


@router.patch("/owner/applications/{application_id}", status_code=status.HTTP_200_OK)
async def review_owner_application(
    application_id: str,
    payload: OwnerApplicationReviewPayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    owner_property_ids = {row.get("id") for row in owner_properties if row.get("id") not in (None, "")}

    applications = _safe_select(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        filters=[("eq", "id", application_id)],
    )
    if not applications:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    app = applications[0]
    if app.get("property_id") not in owner_property_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    comment_key = None
    for key in ("owner_comment", "comment", "owner_note"):
        if key in app:
            comment_key = key
            break

    update_payload = _compact_dict(
        {
            "status": payload.status,
            (comment_key or "owner_comment"): payload.comment,
            "reviewed_at": _now_iso(),
        }
    )
    if payload.status == "approved":
        update_payload.update(
            _compact_dict(
                {
                    "lease_start": payload.leaseStart,
                    "lease_end": payload.leaseEnd,
                    "monthly_rent": payload.monthlyRent,
                    "security_deposit": payload.securityDeposit,
                    "video_review_status": "pending",
                    "owner_approved_at": _now_iso(),
                }
            )
        )
    updated = _optional_update_resilient(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        payload=update_payload,
        filters=[("id", application_id)],
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found for update",
        )

    return {
        "message": "Application reviewed",
        "application": updated,
        "tenancy": None,
    }


@router.post("/tenant/applications/{application_id}/video-review", status_code=status.HTTP_200_OK)
async def review_tenant_application_video(
    application_id: str,
    payload: TenantVideoReviewPayload,
    tenant: dict[str, Any] = Depends(require_tenant),
    client: Client = Depends(get_supabase_client),
):
    tenant_id = tenant.get("id")
    applications = _safe_select(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        filters=[("eq", "id", application_id)],
    )
    if not applications:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    app = applications[0]
    if str(app.get("tenant_id")) != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
        )

    status_value = str(app.get("status") or "").strip().lower()
    if status_value != "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This application is not ready for video review.",
        )

    current_video_status = str(app.get("video_review_status") or "").strip().lower()
    if current_video_status in {"accepted", "declined"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Video review is already completed for this application.",
        )

    property_id = app.get("property_id")
    media_rows = _safe_select(
        client=client,
        table=PROPERTY_MEDIA_TABLE,
        filters=[("eq", "property_id", property_id)] if property_id not in (None, "") else None,
    ) if property_id not in (None, "") else []
    handover_media = _latest_handover_by_property(media_rows).get(property_id)

    if payload.decision == "decline":
        update_payload = _compact_dict(
            {
                "status": "withdrawn",
                "video_review_status": "declined",
                "video_review_note": payload.note,
                "video_reviewed_at": _now_iso(),
            }
        )
        updated = _optional_update_resilient(
            client=client,
            table=STAY_APPLICATIONS_TABLE,
            payload=update_payload,
            filters=[("id", application_id)],
        )
        return {
            "message": "Handover video declined",
            "application": updated,
        }

    if not handover_media:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Handover video is not available yet.",
        )

    update_payload = _compact_dict(
        {
            "video_review_status": "accepted",
            "video_review_note": payload.note,
            "video_reviewed_at": _now_iso(),
        }
    )
    updated = _optional_update_resilient(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        payload=update_payload,
        filters=[("id", application_id)],
    )

    tenancy = None
    existing_tenancies = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("eq", "property_id", property_id), ("eq", "tenant_id", tenant_id)] if property_id not in (None, "") else None,
    ) if property_id not in (None, "") else []
    if existing_tenancies:
        tenancy = existing_tenancies[0]
    else:
        tenancy_payload = _compact_dict(
            {
                "property_id": property_id,
                "owner_id": app.get("owner_id"),
                "tenant_id": tenant_id,
                "status": "active",
                "lease_start": _coalesce(app.get("lease_start"), app.get("requested_move_in_date")),
                "lease_end": app.get("lease_end"),
                "monthly_rent": _coalesce(app.get("monthly_rent"), app.get("offered_rent")),
                "security_deposit": app.get("security_deposit"),
                "source_application_id": app.get("id"),
                "created_at": _now_iso(),
            }
        )
        tenancy = _optional_insert_resilient(client=client, table=TENANCIES_TABLE, payload=tenancy_payload)

    if property_id not in (None, ""):
        property_rows = _required_select(
            client=client,
            table=PROPERTIES_TABLE,
            filters=[("eq", "id", property_id)],
        )
        property_row = property_rows[0] if property_rows else None
        if property_row and property_row.get("status") != "occupied":
            property_update_payload = {"status": "occupied"}
            if "updated_at" in property_row:
                property_update_payload["updated_at"] = _now_iso()
            _required_update(
                client=client,
                table=PROPERTIES_TABLE,
                payload=property_update_payload,
                filters=[("id", property_id)],
            )

    return {
        "message": "Handover video accepted",
        "application": updated,
        "tenancy": tenancy,
        "handoverVideo": _shape_handover_media(handover_media),
    }


@router.get("/tenant/dashboard", status_code=status.HTTP_200_OK)
async def tenant_dashboard(
    tenant: dict[str, Any] = Depends(require_tenant),
    client: Client = Depends(get_supabase_client),
):
    tenant_id = tenant.get("id")

    tenancies = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("eq", "tenant_id", tenant_id)],
    )
    active_tenancy = next(
        (
            row
            for row in tenancies
            if str(row.get("status", "")).lower() in {"active", "current", "running"}
        ),
        None,
    )

    active_property = None
    active_terms = None
    upcoming_payments: list[dict[str, Any]] = []
    maintenance: list[dict[str, Any]] = []
    documents: list[dict[str, Any]] = []

    if active_tenancy and active_tenancy.get("property_id") is not None:
        property_id = active_tenancy.get("property_id")
        property_rows = _required_select(
            client=client,
            table=PROPERTIES_TABLE,
            filters=[("eq", "id", property_id)],
        )
        term_rows = _required_select(
            client=client,
            table=PROPERTY_TERMS_TABLE,
            filters=[("eq", "property_id", property_id)],
        )

        if property_rows:
            active_property = property_rows[0]
        if term_rows:
            active_terms = term_rows[0]

        upcoming_payments = _safe_select(
            client=client,
            table=PAYMENTS_TABLE,
            filters=[("eq", "tenant_id", tenant_id), ("eq", "property_id", property_id)],
        )
        maintenance = _safe_select(
            client=client,
            table=MAINTENANCE_TABLE,
            filters=[("eq", "tenant_id", tenant_id), ("eq", "property_id", property_id)],
        )
        documents = _safe_select(
            client=client,
            table=DOCUMENTS_TABLE,
            filters=[("eq", "property_id", property_id)],
        )

    pending_applications = _safe_select(
        client=client,
        table=STAY_APPLICATIONS_TABLE,
        filters=[("eq", "tenant_id", tenant_id), ("eq", "status", "pending")],
    )
    pending_visits = _safe_select(
        client=client,
        table=VISIT_REQUESTS_TABLE,
        filters=[("eq", "tenant_id", tenant_id), ("eq", "status", "pending")],
    )

    return {
        "tenant": {
            "id": tenant.get("id"),
            "email": tenant.get("email"),
            "name": tenant.get("full_name") or tenant.get("fullName"),
        },
        "activeTenancy": active_tenancy,
        "activeProperty": _serialize_property(active_property, active_terms) if active_property else None,
        "upcomingPayments": upcoming_payments,
        "maintenance": maintenance,
        "documents": documents,
        "summary": {
            "pendingApplications": len(pending_applications),
            "pendingVisitRequests": len(pending_visits),
        },
    }


@router.post("/tenant/tenancies/{tenancy_id}/move-out-video", status_code=status.HTTP_201_CREATED)
async def submit_move_out_video(
    tenancy_id: str,
    payload: TenantMoveOutVideoPayload,
    tenant: dict[str, Any] = Depends(require_tenant),
    client: Client = Depends(get_supabase_client),
):
    tenant_id = tenant.get("id")
    tenancies = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("eq", "id", tenancy_id)],
    )
    if not tenancies:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenancy not found",
        )

    tenancy = tenancies[0]
    if str(tenancy.get("tenant_id")) != str(tenant_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenancy not found",
        )

    property_id = tenancy.get("property_id")
    media_payload = _compact_dict(
        {
            "property_id": property_id,
            "category": "handover",
            "url": payload.videoUrl,
            "tenancy_id": tenancy_id,
            "tenant_id": tenant_id,
            "media_type": "handover_video",
            "media_url": payload.videoUrl,
            "geo_lat": payload.geoLat,
            "geo_lng": payload.geoLng,
            "geo_accuracy": payload.geoAccuracy,
            "captured_at": payload.capturedAt,
            "note": payload.note,
            "created_at": _now_iso(),
        }
    )
    media_row = _optional_insert_resilient(client=client, table=PROPERTY_MEDIA_TABLE, payload=media_payload)

    update_payload = _compact_dict(
        {
            "move_out_status": "submitted",
            "move_out_video_id": media_row.get("id"),
            "move_out_video_url": _media_url_value(media_row) or payload.videoUrl,
            "move_out_requested_at": _now_iso(),
        }
    )
    updated_tenancy = _optional_update_resilient(
        client=client,
        table=TENANCIES_TABLE,
        payload=update_payload,
        filters=[("id", tenancy_id)],
    )

    return {
        "message": "Move-out video submitted",
        "media": media_row,
        "tenancy": updated_tenancy or tenancy,
    }


@router.get("/owner/maintenance", status_code=status.HTTP_200_OK)
async def list_owner_maintenance(
    statusFilter: str | None = Query(default=None),
    propertyId: str | None = Query(default=None),
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    property_map = {row.get("id"): row for row in owner_properties}
    property_ids = [row.get("id") for row in owner_properties if row.get("id") is not None]

    if propertyId and propertyId not in {str(pid) for pid in property_ids} and propertyId not in property_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found for this owner",
        )

    if not property_ids:
        return {
            "items": [],
            "count": 0,
            "summary": {
                "pending": 0,
                "inProgress": 0,
                "resolved": 0,
                "highPriorityOpen": 0,
            },
        }

    filters: list[tuple[str, str, Any]] = [("in", "property_id", property_ids)]
    if propertyId:
        filters.append(("eq", "property_id", propertyId))

    maintenance_rows = _safe_select(
        client=client,
        table=MAINTENANCE_TABLE,
        filters=filters,
    )

    tenant_ids = sorted(
        {row.get("tenant_id") for row in maintenance_rows if row.get("tenant_id") not in (None, "")},
        key=str,
    )
    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("in", "id", tenant_ids)] if tenant_ids else None,
    ) if tenant_ids else []
    tenant_map = {row.get("id"): row for row in tenant_rows}

    items = [
        _shape_owner_maintenance(
            row=row,
            property_map=property_map,
            tenant_map=tenant_map,
        )
        for row in maintenance_rows
    ]

    if statusFilter:
        normalized_filter = statusFilter.strip().lower()
        if normalized_filter == "open":
            items = [item for item in items if item.get("status") in {"pending", "in_progress"}]
        else:
            items = [item for item in items if str(item.get("status") or "").lower() == normalized_filter]

    items.sort(
        key=lambda item: _to_date(_coalesce(item.get("updatedAt"), item.get("createdAt"))) or date.min,
        reverse=True,
    )

    summary = {
        "pending": sum(1 for item in items if item.get("status") == "pending"),
        "inProgress": sum(1 for item in items if item.get("status") == "in_progress"),
        "resolved": sum(1 for item in items if item.get("status") == "resolved"),
        "highPriorityOpen": sum(
            1 for item in items if item.get("status") != "resolved" and item.get("priority") == "high"
        ),
    }

    return {"items": items, "count": len(items), "summary": summary}


@router.post("/owner/maintenance", status_code=status.HTTP_201_CREATED)
async def create_owner_maintenance_ticket(
    payload: OwnerMaintenanceCreatePayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    property_row = _get_property_for_owner(
        client=client,
        owner_id=owner_id,
        property_id=payload.propertyId,
    )

    now_iso = _now_iso()
    insert_payload = _compact_dict(
        {
            "property_id": payload.propertyId,
            "owner_id": owner_id,
            "tenant_id": payload.tenantId,
            "title": payload.title,
            "issue": payload.title,
            "category": payload.category,
            "priority": payload.priority,
            "status": "pending",
            "description": payload.description,
            "note": payload.description,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
    )

    created = _optional_insert_resilient(client=client, table=MAINTENANCE_TABLE, payload=insert_payload)

    tenant_id = created.get("tenant_id")
    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("eq", "id", tenant_id)] if tenant_id not in (None, "") else None,
    ) if tenant_id not in (None, "") else []

    shaped = _shape_owner_maintenance(
        row=created,
        property_map={property_row.get("id"): property_row},
        tenant_map={row.get("id"): row for row in tenant_rows},
    )

    return {"message": "Maintenance ticket created", "ticket": shaped}


@router.patch("/owner/maintenance/{ticket_id}", status_code=status.HTTP_200_OK)
async def update_owner_maintenance_ticket(
    ticket_id: str,
    payload: OwnerMaintenanceUpdatePayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    property_map = {row.get("id"): row for row in owner_properties}
    property_ids = set(property_map.keys())

    ticket_rows = _safe_select(
        client=client,
        table=MAINTENANCE_TABLE,
        filters=[("eq", "id", ticket_id)],
    )
    ticket_row = next(
        (
            row
            for row in ticket_rows
            if row.get("property_id") in property_ids or row.get("owner_id") == owner_id
        ),
        None,
    )
    if not ticket_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance ticket not found",
        )

    update_payload: dict[str, Any] = {}

    if payload.status is not None:
        normalized_status = _normalize_maintenance_status(payload.status)
        if "status" in ticket_row:
            update_payload["status"] = normalized_status
        elif "ticket_status" in ticket_row:
            update_payload["ticket_status"] = normalized_status

    if payload.assignedTo is not None:
        for key in ("assigned_to", "assigned_vendor", "vendor", "assignedTo"):
            if key in ticket_row:
                update_payload[key] = payload.assignedTo
                break

    if payload.assignedPhone is not None:
        for key in ("assigned_phone", "vendor_phone", "assignedPhone"):
            if key in ticket_row:
                update_payload[key] = payload.assignedPhone
                break

    if payload.actualCost is not None:
        for key in ("actual_cost", "cost", "actualCost"):
            if key in ticket_row:
                update_payload[key] = payload.actualCost
                break

    if payload.comment:
        if "comments" in ticket_row and isinstance(ticket_row.get("comments"), list):
            existing_comments = [item for item in ticket_row.get("comments", []) if isinstance(item, (dict, str))]
            existing_comments.append(
                {
                    "by": "Owner",
                    "time": _now_iso(),
                    "text": payload.comment,
                }
            )
            update_payload["comments"] = existing_comments
        elif "owner_comment" in ticket_row:
            update_payload["owner_comment"] = payload.comment
        elif "comment" in ticket_row:
            update_payload["comment"] = payload.comment
        elif "note" in ticket_row:
            update_payload["note"] = payload.comment

    if "updated_at" in ticket_row:
        update_payload["updated_at"] = _now_iso()

    if not update_payload:
        tenant_id = ticket_row.get("tenant_id")
        tenant_rows = _required_select(
            client=client,
            table=USERS_TABLE,
            filters=[("eq", "id", tenant_id)] if tenant_id not in (None, "") else None,
        ) if tenant_id not in (None, "") else []
        shaped_current = _shape_owner_maintenance(
            row=ticket_row,
            property_map=property_map,
            tenant_map={row.get("id"): row for row in tenant_rows},
        )
        return {"message": "No applicable fields to update", "ticket": shaped_current}

    updated = _required_update(
        client=client,
        table=MAINTENANCE_TABLE,
        payload=update_payload,
        filters=[("id", ticket_row.get("id"))],
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance ticket not found for update",
        )

    tenant_id = updated.get("tenant_id")
    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("eq", "id", tenant_id)] if tenant_id not in (None, "") else None,
    ) if tenant_id not in (None, "") else []

    shaped = _shape_owner_maintenance(
        row=updated,
        property_map=property_map,
        tenant_map={row.get("id"): row for row in tenant_rows},
    )
    return {"message": "Maintenance ticket updated", "ticket": shaped}


@router.get("/owner/documents", status_code=status.HTTP_200_OK)
async def list_owner_documents(
    categoryFilter: str | None = Query(default=None),
    propertyId: str | None = Query(default=None),
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    property_map = {row.get("id"): row for row in owner_properties}
    property_ids = [row.get("id") for row in owner_properties if row.get("id") is not None]

    if propertyId and propertyId not in {str(pid) for pid in property_ids} and propertyId not in property_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Property not found for this owner",
        )

    if not property_ids:
        return {
            "items": [],
            "count": 0,
            "summary": {
                "shared": 0,
                "verified": 0,
            },
        }

    filters: list[tuple[str, str, Any]] = [("in", "property_id", property_ids)]
    if propertyId:
        filters.append(("eq", "property_id", propertyId))

    document_rows = _safe_select(
        client=client,
        table=DOCUMENTS_TABLE,
        filters=filters,
    )

    tenant_ids = sorted(
        {row.get("tenant_id") for row in document_rows if row.get("tenant_id") not in (None, "")},
        key=str,
    )
    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("in", "id", tenant_ids)] if tenant_ids else None,
    ) if tenant_ids else []
    tenant_map = {row.get("id"): row for row in tenant_rows}

    items = [
        _shape_owner_document(
            row=row,
            property_map=property_map,
            tenant_map=tenant_map,
        )
        for row in document_rows
    ]

    if categoryFilter:
        normalized = categoryFilter.strip().lower()
        items = [
            item
            for item in items
            if str(item.get("category") or "").strip().lower() == normalized
        ]

    items.sort(key=lambda item: _to_date(item.get("date")) or date.min, reverse=True)

    summary = {
        "shared": sum(1 for item in items if item.get("sharedWithTenant")),
        "verified": sum(1 for item in items if item.get("verified")),
    }

    return {"items": items, "count": len(items), "summary": summary}


@router.patch("/owner/documents/{document_id}", status_code=status.HTTP_200_OK)
async def update_owner_document(
    document_id: str,
    payload: OwnerDocumentUpdatePayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    property_map = {row.get("id"): row for row in owner_properties}
    property_ids = set(property_map.keys())

    document_rows = _safe_select(
        client=client,
        table=DOCUMENTS_TABLE,
        filters=[("eq", "id", document_id)],
    )
    document_row = next(
        (
            row
            for row in document_rows
            if row.get("property_id") in property_ids or row.get("owner_id") == owner_id
        ),
        None,
    )
    if not document_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )

    update_payload: dict[str, Any] = {}

    if payload.sharedWithTenant is not None:
        if "shared_with_tenant" in document_row:
            update_payload["shared_with_tenant"] = payload.sharedWithTenant
        elif "sharedWithTenant" in document_row:
            update_payload["sharedWithTenant"] = payload.sharedWithTenant

    if payload.verified is not None:
        if "verified" in document_row:
            update_payload["verified"] = payload.verified
        elif "is_verified" in document_row:
            update_payload["is_verified"] = payload.verified
        elif "verification_status" in document_row:
            update_payload["verification_status"] = "verified" if payload.verified else "pending"

    if payload.category is not None:
        if "category" in document_row:
            update_payload["category"] = payload.category
        elif "document_type" in document_row:
            update_payload["document_type"] = payload.category

    if payload.tags is not None and "tags" in document_row:
        update_payload["tags"] = payload.tags

    if "updated_at" in document_row:
        update_payload["updated_at"] = _now_iso()

    if not update_payload:
        tenant_id = document_row.get("tenant_id")
        tenant_rows = _required_select(
            client=client,
            table=USERS_TABLE,
            filters=[("eq", "id", tenant_id)] if tenant_id not in (None, "") else None,
        ) if tenant_id not in (None, "") else []
        shaped_current = _shape_owner_document(
            row=document_row,
            property_map=property_map,
            tenant_map={row.get("id"): row for row in tenant_rows},
        )
        return {"message": "No applicable fields to update", "document": shaped_current}

    updated = _required_update(
        client=client,
        table=DOCUMENTS_TABLE,
        payload=update_payload,
        filters=[("id", document_row.get("id"))],
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found for update",
        )

    tenant_id = updated.get("tenant_id")
    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("eq", "id", tenant_id)] if tenant_id not in (None, "") else None,
    ) if tenant_id not in (None, "") else []

    shaped = _shape_owner_document(
        row=updated,
        property_map=property_map,
        tenant_map={row.get("id"): row for row in tenant_rows},
    )
    return {"message": "Document updated", "document": shaped}


@router.get("/owner/leases", status_code=status.HTTP_200_OK)
async def list_owner_leases(
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    owner_property_ids = [row.get("id") for row in owner_properties if row.get("id") not in (None, "")]

    if not owner_property_ids:
        return {
            "items": [],
            "count": 0,
            "summary": {
                "total": 0,
                "active": 0,
                "expiringSoon": 0,
                "noticeGiven": 0,
                "renewalOffered": 0,
                "monthlyRevenue": 0,
            },
        }

    tenancies = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("in", "property_id", owner_property_ids)],
    )

    property_ids = sorted(
        {row.get("property_id") for row in tenancies if row.get("property_id") not in (None, "")},
        key=str,
    )
    tenant_ids = sorted(
        {row.get("tenant_id") for row in tenancies if row.get("tenant_id") not in (None, "")},
        key=str,
    )

    properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("in", "id", property_ids)] if property_ids else None,
    ) if property_ids else []
    tenants = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("in", "id", tenant_ids)] if tenant_ids else None,
    ) if tenant_ids else []
    terms_map = _get_property_terms_map(client=client, property_ids=property_ids)
    media_rows = _safe_select(
        client=client,
        table=PROPERTY_MEDIA_TABLE,
        filters=[("in", "property_id", property_ids)] if property_ids else None,
    ) if property_ids else []
    handover_by_property = _latest_handover_by_property(media_rows)

    property_map = {row.get("id"): row for row in properties}
    tenant_map = {row.get("id"): row for row in tenants}
    tenancy_map = {str(row.get("id")): row for row in tenancies if row.get("id") not in (None, "")}

    shaped = [
        _shape_owner_lease(
            row=row,
            property_map=property_map,
            terms_map=terms_map,
            tenant_map=tenant_map,
        )
        for row in tenancies
    ]
    for item in shaped:
        tenancy_row = tenancy_map.get(str(item.get("id")))
        move_out_status = _coalesce(
            tenancy_row.get("move_out_status") if tenancy_row else None,
            tenancy_row.get("moveOutStatus") if tenancy_row else None,
        )
        move_out_video_row = None
        if tenancy_row:
            move_out_video_url = _coalesce(
                tenancy_row.get("move_out_video_url"),
                tenancy_row.get("moveOutVideoUrl"),
            )
            if move_out_video_url:
                move_out_video_row = {
                    "id": tenancy_row.get("move_out_video_id"),
                    "media_url": move_out_video_url,
                    "captured_at": tenancy_row.get("move_out_captured_at"),
                    "geo_lat": tenancy_row.get("move_out_geo_lat"),
                    "geo_lng": tenancy_row.get("move_out_geo_lng"),
                    "geo_accuracy": tenancy_row.get("move_out_geo_accuracy"),
                    "note": tenancy_row.get("move_out_note"),
                }
        if not move_out_video_row:
            move_out_video_row = handover_by_property.get(item.get("propertyId"))
        item["moveOutStatus"] = move_out_status
        item["moveOutVideo"] = _shape_handover_media(move_out_video_row) if move_out_video_row else None
    shaped.sort(key=lambda item: _to_date(item.get("endDate")) or date.max)

    summary = {
        "total": len(shaped),
        "active": sum(1 for item in shaped if item.get("status") == "active"),
        "expiringSoon": sum(1 for item in shaped if item.get("status") == "expiring_soon"),
        "noticeGiven": sum(1 for item in shaped if item.get("status") == "notice_given"),
        "renewalOffered": sum(1 for item in shaped if item.get("renewalStatus") == "renewal_offered"),
        "monthlyRevenue": round(sum(_to_float(item.get("rent")) or 0 for item in shaped), 2),
    }

    return {
        "items": shaped,
        "count": len(shaped),
        "summary": summary,
    }


@router.post("/owner/leases", status_code=status.HTTP_201_CREATED)
async def create_owner_lease(
    payload: OwnerLeaseCreatePayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    property_row = _get_property_for_owner(
        client=client,
        owner_id=owner_id,
        property_id=payload.propertyId,
    )

    tenant_row: dict[str, Any] | None = None
    tenant_id = None
    if payload.tenantEmail:
        tenant_rows = _safe_select(
            client=client,
            table=USERS_TABLE,
            filters=[("eq", "email", str(payload.tenantEmail))],
        )
        if not tenant_rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant with this email not found. Ask tenant to register first.",
            )
        tenant_row = next(
            (row for row in tenant_rows if str(row.get("role") or "").lower() == "tenant"),
            tenant_rows[0],
        )
        tenant_id = tenant_row.get("id")

    term_rows = _required_select(
        client=client,
        table=PROPERTY_TERMS_TABLE,
        filters=[("eq", "property_id", payload.propertyId)],
    )
    term_row = term_rows[0] if term_rows else {}

    tenancy_payload = _compact_dict(
        {
            "property_id": payload.propertyId,
            "owner_id": owner_id,
            "tenant_id": tenant_id,
            "status": "active",
            "lease_start": payload.startDate,
            "lease_end": payload.endDate,
            "monthly_rent": _coalesce(payload.rent, term_row.get("expected_rent")),
            "security_deposit": _coalesce(payload.deposit, term_row.get("security_deposit")),
            "created_at": _now_iso(),
        }
    )
    lease_row = _optional_insert_resilient(client=client, table=TENANCIES_TABLE, payload=tenancy_payload)

    if property_row and property_row.get("status") != "occupied":
        property_update_payload = {"status": "occupied"}
        if "updated_at" in property_row:
            property_update_payload["updated_at"] = _now_iso()
        _required_update(
            client=client,
            table=PROPERTIES_TABLE,
            payload=property_update_payload,
            filters=[("id", payload.propertyId), ("owner_id", owner_id)],
        )

    property_map = {payload.propertyId: property_row}
    terms_map = {payload.propertyId: term_row} if term_row else {}
    tenant_map = {tenant_id: tenant_row} if tenant_id and tenant_row else {}

    shaped = _shape_owner_lease(
        row=lease_row,
        property_map=property_map,
        terms_map=terms_map,
        tenant_map=tenant_map,
    )

    if not tenant_row:
        if payload.tenantName:
            shaped["tenantName"] = payload.tenantName
            shaped["tenantInitials"] = _initials(payload.tenantName)
        if payload.tenantEmail:
            shaped["tenantEmail"] = str(payload.tenantEmail)
        if payload.tenantPhone:
            shaped["tenantPhone"] = payload.tenantPhone
    if payload.maintenance is not None:
        shaped["maintenanceCharges"] = payload.maintenance
    if payload.noticePeriod is not None:
        shaped["noticePeriod"] = payload.noticePeriod
    if payload.paymentDay is not None:
        shaped["paymentDay"] = payload.paymentDay
    if payload.gracePeriod is not None:
        shaped["gracePeriod"] = payload.gracePeriod
    if payload.escalation:
        shaped["escalationClause"] = payload.escalation

    return {
        "message": "Lease created",
        "lease": shaped,
    }


@router.patch("/owner/leases/{lease_id}", status_code=status.HTTP_200_OK)
async def owner_lease_action(
    lease_id: str,
    payload: OwnerLeaseActionPayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    owner_property_ids = {row.get("id") for row in owner_properties if row.get("id") not in (None, "")}

    lease_rows = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("eq", "id", lease_id)],
    )
    if not lease_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lease not found",
        )

    current_row = lease_rows[0]
    if current_row.get("property_id") not in owner_property_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lease not found",
        )
    status_by_action = {
        "send_renewal": "renewal_offered",
        "send_notice": "notice_given",
        "terminate": "terminated",
    }
    update_payload = {"status": status_by_action[payload.action]}
    if "updated_at" in current_row:
        update_payload["updated_at"] = _now_iso()
    if payload.note and "owner_comment" in current_row:
        update_payload["owner_comment"] = payload.note
    if payload.action == "send_notice" and "notice_date" in current_row:
        update_payload["notice_date"] = _now_iso()

    updated = _required_update(
        client=client,
        table=TENANCIES_TABLE,
        payload=update_payload,
        filters=[("id", lease_id)],
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lease not found for update",
        )

    property_id = updated.get("property_id")
    tenant_id = updated.get("tenant_id")

    property_rows = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "id", property_id)] if property_id is not None else None,
    ) if property_id is not None else []
    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("eq", "id", tenant_id)] if tenant_id is not None else None,
    ) if tenant_id is not None else []
    terms_map = _get_property_terms_map(client=client, property_ids=[property_id] if property_id is not None else [])

    shaped = _shape_owner_lease(
        row=updated,
        property_map={row.get("id"): row for row in property_rows},
        terms_map=terms_map,
        tenant_map={row.get("id"): row for row in tenant_rows},
    )

    action_message = {
        "send_renewal": "Renewal offer sent",
        "send_notice": "Notice issued",
        "terminate": "Lease terminated",
    }

    return {
        "message": action_message[payload.action],
        "lease": shaped,
    }


@router.post("/owner/tenancies/{tenancy_id}/move-out-review", status_code=status.HTTP_200_OK)
async def review_move_out_video(
    tenancy_id: str,
    payload: OwnerMoveOutReviewPayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    tenancy_rows = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("eq", "id", tenancy_id)],
    )
    if not tenancy_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenancy not found",
        )

    tenancy = tenancy_rows[0]
    property_id = tenancy.get("property_id")
    property_rows = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "id", property_id)] if property_id not in (None, "") else None,
    ) if property_id not in (None, "") else []
    property_row = property_rows[0] if property_rows else None

    if not property_row or str(property_row.get("owner_id")) != str(owner_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenancy not found",
        )

    update_payload: dict[str, Any] = {
        "move_out_status": payload.status,
    }
    if payload.status == "accepted":
        update_payload["status"] = "terminated"
        update_payload["move_out_confirmed_at"] = _now_iso()
    if payload.note and "owner_comment" in tenancy:
        update_payload["owner_comment"] = payload.note
    if "updated_at" in tenancy:
        update_payload["updated_at"] = _now_iso()

    updated = _optional_update_resilient(
        client=client,
        table=TENANCIES_TABLE,
        payload=update_payload,
        filters=[("id", tenancy_id)],
    )

    if payload.status == "accepted" and property_row:
        property_update_payload = {"status": "vacant"}
        if "updated_at" in property_row:
            property_update_payload["updated_at"] = _now_iso()
        _required_update(
            client=client,
            table=PROPERTIES_TABLE,
            payload=property_update_payload,
            filters=[("id", property_id), ("owner_id", owner_id)],
        )

    return {
        "message": "Move-out reviewed",
        "tenancy": updated or tenancy,
    }


@router.get("/owner/payments", status_code=status.HTTP_200_OK)
async def list_owner_payments(
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    owner_property_ids = sorted(
        {row.get("id") for row in owner_properties if row.get("id") not in (None, "")},
        key=str,
    )

    if not owner_property_ids:
        current_period = _period_label(date.today().isoformat())
        return {
            "items": [],
            "count": 0,
            "payouts": [
                {
                    "id": f"PO-{current_period.replace(' ', '-').upper()}",
                    "period": current_period,
                    "grossRent": None,
                    "platformFee": None,
                    "tax": None,
                    "netPayout": None,
                    "settledDate": None,
                    "method": "Auto transfer",
                    "status": "pending",
                }
            ],
            "summary": {
                "currentPeriod": current_period,
                "collected": 0,
                "expected": 0,
                "overdueAmount": 0,
                "overdueCount": 0,
            },
        }

    tenancies = _safe_select(
        client=client,
        table=TENANCIES_TABLE,
        filters=[("in", "property_id", owner_property_ids)],
    )
    property_ids = owner_property_ids

    payments = _safe_select(
        client=client,
        table=PAYMENTS_TABLE,
        filters=[("in", "property_id", property_ids)] if property_ids else None,
    )

    tenant_ids = {
        row.get("tenant_id")
        for row in tenancies
        if row.get("tenant_id") not in (None, "")
    }
    tenant_ids.update(
        row.get("tenant_id")
        for row in payments
        if row.get("tenant_id") not in (None, "")
    )

    properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("in", "id", property_ids)],
    )
    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("in", "id", sorted(tenant_ids, key=str))] if tenant_ids else None,
    ) if tenant_ids else []

    terms_map = _get_property_terms_map(client=client, property_ids=property_ids)
    property_map = {row.get("id"): row for row in properties}
    tenant_map = {row.get("id"): row for row in tenant_rows}

    tenancy_by_id = {
        str(row.get("id")): row
        for row in tenancies
        if row.get("id") not in (None, "")
    }
    tenancy_by_pair = {
        (row.get("property_id"), row.get("tenant_id")): row
        for row in tenancies
        if row.get("property_id") not in (None, "")
    }

    shaped = [
        _shape_owner_payment(
            row=row,
            tenancy_by_id=tenancy_by_id,
            tenancy_by_pair=tenancy_by_pair,
            property_map=property_map,
            terms_map=terms_map,
            tenant_map=tenant_map,
        )
        for row in payments
    ]
    shaped.sort(
        key=lambda item: _to_date(item.get("dueDate")) or _period_sort_value(str(item.get("period") or "")),
        reverse=True,
    )

    payouts = _build_owner_payouts(shaped)
    current_period = _period_label(date.today().isoformat())
    current_rows = [row for row in shaped if row.get("period") == current_period]

    summary = {
        "currentPeriod": current_period,
        "collected": round(
            sum(_to_float(item.get("total")) or 0 for item in current_rows if item.get("status") == "paid"),
            2,
        ),
        "expected": round(sum(_to_float(item.get("total")) or 0 for item in current_rows), 2),
        "overdueAmount": round(
            sum(_to_float(item.get("total")) or 0 for item in shaped if item.get("status") == "overdue"),
            2,
        ),
        "overdueCount": sum(1 for item in shaped if item.get("status") == "overdue"),
    }

    return {
        "items": shaped,
        "count": len(shaped),
        "payouts": payouts,
        "summary": summary,
    }


@router.post("/owner/payments/{payment_id}/record", status_code=status.HTTP_200_OK)
async def record_owner_payment(
    payment_id: str,
    payload: OwnerPaymentRecordPayload,
    owner: dict[str, Any] = Depends(require_owner),
    client: Client = Depends(get_supabase_client),
):
    owner_id = owner.get("id")
    owner_properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "owner_id", owner_id)],
    )
    property_ids = {
        row.get("id")
        for row in owner_properties
        if row.get("id") not in (None, "")
    }

    payment_rows = _safe_select(
        client=client,
        table=PAYMENTS_TABLE,
        filters=[("eq", "id", payment_id)],
    )
    payment_row = next(
        (
            row
            for row in payment_rows
            if row.get("property_id") in property_ids or row.get("owner_id") == owner_id
        ),
        None,
    )
    if not payment_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment record not found",
        )

    update_payload: dict[str, Any] = {"status": "paid"}
    paid_value = payload.paidDate or _now_iso()
    if "paid_at" in payment_row:
        update_payload["paid_at"] = paid_value
    elif "paid_date" in payment_row:
        update_payload["paid_date"] = paid_value

    if payload.amount is not None:
        if "amount" in payment_row:
            update_payload["amount"] = payload.amount
        elif "total_amount" in payment_row:
            update_payload["total_amount"] = payload.amount

    if payload.txnId:
        if "transaction_id" in payment_row:
            update_payload["transaction_id"] = payload.txnId
        elif "txn_id" in payment_row:
            update_payload["txn_id"] = payload.txnId

    if payload.method:
        if "payment_method" in payment_row:
            update_payload["payment_method"] = payload.method
        elif "method" in payment_row:
            update_payload["method"] = payload.method

    if payload.note:
        if "note" in payment_row:
            update_payload["note"] = payload.note
        elif "remarks" in payment_row:
            update_payload["remarks"] = payload.note

    if "updated_at" in payment_row:
        update_payload["updated_at"] = _now_iso()

    updated = _required_update(
        client=client,
        table=PAYMENTS_TABLE,
        payload=update_payload,
        filters=[("id", payment_id)],
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Payment record not found for update",
        )

    property_id = updated.get("property_id")
    tenant_id = updated.get("tenant_id")

    properties = _required_select(
        client=client,
        table=PROPERTIES_TABLE,
        filters=[("eq", "id", property_id)] if property_id is not None else None,
    ) if property_id is not None else []
    terms_map = _get_property_terms_map(client=client, property_ids=[property_id] if property_id is not None else [])

    tenant_rows = _required_select(
        client=client,
        table=USERS_TABLE,
        filters=[("eq", "id", tenant_id)] if tenant_id is not None else None,
    ) if tenant_id is not None else []

    tenancy_by_id = {
        str(row.get("id")): row
        for row in tenancies
        if row.get("id") not in (None, "")
    }
    tenancy_by_pair = {
        (row.get("property_id"), row.get("tenant_id")): row
        for row in tenancies
        if row.get("property_id") not in (None, "")
    }

    shaped = _shape_owner_payment(
        row=updated,
        tenancy_by_id=tenancy_by_id,
        tenancy_by_pair=tenancy_by_pair,
        property_map={row.get("id"): row for row in properties},
        terms_map=terms_map,
        tenant_map={row.get("id"): row for row in tenant_rows},
    )

    if payload.txnId and not shaped.get("txnId"):
        shaped["txnId"] = payload.txnId
    if payload.paidDate and not shaped.get("paidDate"):
        shaped["paidDate"] = payload.paidDate
    if not shaped.get("receipt"):
        period = str(shaped.get("period") or _period_label(date.today().isoformat()))
        shaped["receipt"] = f"RCP-{period.replace(' ', '-').upper()}-{payment_id[-4:]}"

    return {
        "message": "Payment recorded",
        "payment": shaped,
    }
