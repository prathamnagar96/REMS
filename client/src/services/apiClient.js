import { getAuthHeader } from "./sessionService";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

async function requestJson(path, { method = "GET", payload, withAuth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (withAuth) Object.assign(headers, getAuthHeader());

    const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: payload == null ? undefined : JSON.stringify(payload),
    });

    let data;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        const message = data?.detail || data?.message || `Request failed with status ${response.status}`;
        throw new Error(message);
    }

    return data;
}

async function postJson(path, payload, { withAuth = false } = {}) {
    return requestJson(path, { method: "POST", payload, withAuth });
}

async function getJson(path, { withAuth = false } = {}) {
    return requestJson(path, { method: "GET", withAuth });
}

async function putJson(path, payload, { withAuth = false } = {}) {
    return requestJson(path, { method: "PUT", payload, withAuth });
}

async function patchJson(path, payload, { withAuth = false } = {}) {
    return requestJson(path, { method: "PATCH", payload, withAuth });
}

export const registerTenant = (payload) => postJson("/api/tenant/register", payload);
export const registerOwner = (payload) => postJson("/api/owner/register", payload);
export const login = (payload) => postJson("/api/auth/login", payload);
export const forgotPassword = (payload) => postJson("/api/auth/forgot-password", payload);
export const resetPassword = (payload) => postJson("/api/auth/reset-password", payload);
export const sendSignupOtp = (payload) => postJson("/api/auth/send-signup-otp", payload);
export const verifySignupOtp = (payload) => postJson("/api/auth/verify-signup-otp", payload);

export const getOwnerProperties = () => getJson("/api/owner/properties", { withAuth: true });
export const getOwnerPropertyById = (propertyId) => getJson(`/api/owner/properties/${propertyId}`, { withAuth: true });
export const createOwnerProperty = (payload) => postJson("/api/owner/properties", payload, { withAuth: true });
export const updateOwnerProperty = (propertyId, payload) => putJson(`/api/owner/properties/${propertyId}`, payload, { withAuth: true });

export const getOwnerDashboard = () => getJson("/api/owner/dashboard", { withAuth: true });
export const getTenantDashboard = () => getJson("/api/tenant/dashboard", { withAuth: true });

export const browseProperties = (params = {}) => {
    const query = new URLSearchParams(
        Object.entries(params).reduce((acc, [key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                acc[key] = String(value);
            }
            return acc;
        }, {}),
    );
    const qs = query.toString();
    return getJson(`/api/properties/browse${qs ? `?${qs}` : ""}`);
};

export const getTenantPropertyById = (propertyId) => getJson(`/api/tenant/properties/${propertyId}`, { withAuth: true });

export const requestPropertyVisit = (propertyId, payload) => postJson(`/api/tenant/properties/${propertyId}/visit-requests`, payload, { withAuth: true });
export const applyForProperty = (propertyId, payload) => postJson(`/api/tenant/properties/${propertyId}/applications`, payload, { withAuth: true });
export const getTenantApplications = () => getJson("/api/tenant/applications", { withAuth: true });

export const getOwnerApplications = (statusFilter) => {
    const qs = statusFilter ? `?statusFilter=${encodeURIComponent(statusFilter)}` : "";
    return getJson(`/api/owner/applications${qs}`, { withAuth: true });
};
export const reviewOwnerApplication = (applicationId, payload) => patchJson(`/api/owner/applications/${applicationId}`, payload, { withAuth: true });

export const getOwnerLeases = () => getJson("/api/owner/leases", { withAuth: true });
export const createOwnerLease = (payload) => postJson("/api/owner/leases", payload, { withAuth: true });
export const ownerLeaseAction = (leaseId, payload) => patchJson(`/api/owner/leases/${leaseId}`, payload, { withAuth: true });

export const getOwnerPayments = () => getJson("/api/owner/payments", { withAuth: true });
export const recordOwnerPayment = (paymentId, payload) => postJson(`/api/owner/payments/${paymentId}/record`, payload, { withAuth: true });

export const getOwnerMaintenance = (params = {}) => {
    const query = new URLSearchParams(
        Object.entries(params).reduce((acc, [key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                acc[key] = String(value);
            }
            return acc;
        }, {}),
    );
    const qs = query.toString();
    return getJson(`/api/owner/maintenance${qs ? `?${qs}` : ""}`, { withAuth: true });
};

export const createOwnerMaintenanceTicket = (payload) => postJson("/api/owner/maintenance", payload, { withAuth: true });
export const updateOwnerMaintenanceTicket = (ticketId, payload) => patchJson(`/api/owner/maintenance/${ticketId}`, payload, { withAuth: true });

export const getOwnerDocuments = (params = {}) => {
    const query = new URLSearchParams(
        Object.entries(params).reduce((acc, [key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
                acc[key] = String(value);
            }
            return acc;
        }, {}),
    );
    const qs = query.toString();
    return getJson(`/api/owner/documents${qs ? `?${qs}` : ""}`, { withAuth: true });
};

export const updateOwnerDocument = (documentId, payload) => patchJson(`/api/owner/documents/${documentId}`, payload, { withAuth: true });
