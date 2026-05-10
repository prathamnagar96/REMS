import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    getOwnerApplications,
    getOwnerDashboard,
    getOwnerProperties,
    getOwnerPropertyById,
    reviewOwnerApplication,
} from "../services/apiClient";
import { useAuth } from "../context/AuthContext";
import "./Dashboard.css";

const NAV_ITEMS = [
    { id: "overview", label: "Overview", icon: "◫" },
    { id: "properties", label: "Properties", icon: "▣" },
    { id: "applications", label: "Applications", icon: "◧" },
    { id: "visits", label: "Visit Requests", icon: "⌁" },
    { id: "settings", label: "Settings", icon: "○" },
];

const toNumber = (value) => {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
};

const fmt = (value) => new Intl.NumberFormat("en-IN").format(toNumber(value));

const fmtDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const normalizeText = (value, fallback = "-") => {
    if (value == null) return fallback;
    const text = String(value).trim();
    return text || fallback;
};

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const statusClass = (value) => {
    const status = String(value || "").toLowerCase();
    if (["approved", "occupied", "paid", "resolved", "active", "running", "current"].includes(status)) return "badge-green";
    if (["rejected", "overdue", "cancelled", "withdrawn", "declined"].includes(status)) return "badge-red";
    if (["pending", "notice", "scheduled", "under_review", "in_review"].includes(status)) return "badge-amber";
    return "badge-grey";
};

const isPending = (value) => String(value || "").toLowerCase() === "pending";

const toIsoDate = (value) => {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const addMonthsIso = (isoDate, months) => {
    const source = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(source.getTime())) return "";
    const date = new Date(source);
    date.setMonth(date.getMonth() + months);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const ownerName = (profile) => {
    const raw = profile?.full_name || profile?.fullName || profile?.name || "Owner";
    const clean = String(raw).trim();
    return clean || "Owner";
};

export default function OwnerDashboard() {
    const navigate = useNavigate();
    const { profile, logout } = useAuth();

    const [tab, setTab] = useState("overview");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [actionMessage, setActionMessage] = useState("");

    const [dashboard, setDashboard] = useState(null);
    const [properties, setProperties] = useState([]);
    const [applications, setApplications] = useState([]);

    const [propertiesFilter, setPropertiesFilter] = useState("all");
    const [propertiesSearch, setPropertiesSearch] = useState("");

    const [applicationFilter, setApplicationFilter] = useState("all");
    const [applicationSearch, setApplicationSearch] = useState("");

    const [actionBusy, setActionBusy] = useState({});

    const [selectedPropertyId, setSelectedPropertyId] = useState("");
    const [propertyDetails, setPropertyDetails] = useState({});
    const [propertyDetailLoading, setPropertyDetailLoading] = useState(false);
    const [propertyDetailError, setPropertyDetailError] = useState("");

    const summary = dashboard?.summary || {};
    const visits = normalizeArray(dashboard?.recentVisitRequests);
    const pendingApplicationCount = toNumber(summary.pendingApplications ?? applications.filter((app) => isPending(app?.status)).length);
    const pendingVisitCount = toNumber(summary.pendingVisitRequests ?? visits.filter((item) => isPending(item?.status)).length);

    const propertyById = useMemo(() => {
        const map = new Map();
        for (const item of properties) {
            if (item?.id != null) {
                map.set(String(item.id), item);
            }
        }
        return map;
    }, [properties]);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [dashboardResponse, propertiesResponse, applicationsResponse] = await Promise.all([
                getOwnerDashboard(),
                getOwnerProperties(),
                getOwnerApplications(),
            ]);

            setDashboard(dashboardResponse || null);
            setProperties(normalizeArray(propertiesResponse?.items));

            const apps = normalizeArray(applicationsResponse?.items).sort((a, b) => {
                const aTime = new Date(a?.created_at || a?.createdAt || 0).getTime();
                const bTime = new Date(b?.created_at || b?.createdAt || 0).getTime();
                return bTime - aTime;
            });
            setApplications(apps);
        } catch (err) {
            setDashboard(null);
            setProperties([]);
            setApplications([]);
            setError(err?.message || "Unable to load owner dashboard.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const fetchPropertyDetails = useCallback(async (propertyId) => {
        if (!propertyId) return;
        const key = String(propertyId);
        setSelectedPropertyId(key);
        setPropertyDetailError("");

        if (propertyDetails[key]) return;

        setPropertyDetailLoading(true);
        try {
            const details = await getOwnerPropertyById(key);
            setPropertyDetails((prev) => ({ ...prev, [key]: details }));
        } catch (err) {
            setPropertyDetailError(err?.message || "Unable to load property details.");
        } finally {
            setPropertyDetailLoading(false);
        }
    }, [propertyDetails]);

    const handleReview = async (application, decision) => {
        if (!application?.id) return;

        const busyKey = `${decision}-${application.id}`;
        setActionMessage("");
        setActionBusy((prev) => ({ ...prev, [busyKey]: true }));

        try {
            if (decision === "approved") {
                const propertyId = String(application.property_id || application?.property?.id || "");
                const property = propertyById.get(propertyId);
                const offeredRent = toNumber(application.offered_rent);
                const monthlyRent = offeredRent || toNumber(property?.rent) || 0;
                const leaseMonths = Math.max(1, Math.round(toNumber(application.requested_lease_months) || 11));
                const leaseStart = toIsoDate(application.requested_move_in_date) || toIsoDate(new Date());
                const leaseEnd = addMonthsIso(leaseStart, leaseMonths);

                await reviewOwnerApplication(application.id, {
                    status: "approved",
                    comment: "Approved from owner dashboard",
                    leaseStart,
                    leaseEnd,
                    monthlyRent: monthlyRent || null,
                    securityDeposit: monthlyRent ? monthlyRent * 2 : null,
                });
                setActionMessage("Application approved successfully.");
            } else {
                await reviewOwnerApplication(application.id, {
                    status: "rejected",
                    comment: "Rejected from owner dashboard",
                });
                setActionMessage("Application rejected.");
            }

            setPropertyDetails({});
            await loadData();
        } catch (err) {
            setActionMessage(err?.message || "Unable to review application.");
        } finally {
            setActionBusy((prev) => ({ ...prev, [busyKey]: false }));
        }
    };

    const handleLogout = () => {
        logout();
        navigate("/auth", { replace: true });
    };

    const ownerDisplayName = ownerName(profile || {});
    const firstName = ownerDisplayName.split(" ")[0] || "Owner";

    const filteredProperties = useMemo(() => {
        const query = propertiesSearch.toLowerCase().trim();

        return properties.filter((property) => {
            const status = String(property?.status || "vacant").toLowerCase();
            const statusMatch = propertiesFilter === "all" || status === propertiesFilter;

            if (!statusMatch) return false;
            if (!query) return true;

            const blob = [
                property?.title,
                property?.address,
                property?.city,
                property?.propertyType,
                property?.bhk,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return blob.includes(query);
        });
    }, [properties, propertiesFilter, propertiesSearch]);

    const filteredApplications = useMemo(() => {
        const query = applicationSearch.toLowerCase().trim();

        return applications.filter((application) => {
            const status = String(application?.status || "pending").toLowerCase();
            const statusMatch = applicationFilter === "all" || status === applicationFilter;

            if (!statusMatch) return false;
            if (!query) return true;

            const blob = [
                application?.tenant?.name,
                application?.tenant?.email,
                application?.property?.title,
                application?.property?.city,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return blob.includes(query);
        });
    }, [applications, applicationFilter, applicationSearch]);

    const selectedPropertyDetail = selectedPropertyId ? propertyDetails[selectedPropertyId] : null;

    const titleMap = {
        overview: "Overview",
        properties: "Properties",
        applications: "Applications",
        visits: "Visit Requests",
        settings: "Settings",
    };

    const subtitleMap = {
        overview: `Good morning, ${firstName}`,
        properties: "Live property inventory from backend",
        applications: "Approve or reject tenant applications",
        visits: "Latest visit requests from tenants",
        settings: "Session and account controls",
    };

    return (
        <div className="dash-root">
            <aside className="dash-sidebar">
                <div className="sidebar-logo">
                    <div className="sidebar-logo-mark" style={{ color: "var(--gold)", fontSize: 18 }}>▦</div>
                    <div>
                        <div className="sidebar-logo-text">REMS</div>
                        <div className="sidebar-logo-sub">OWNER PORTAL</div>
                    </div>
                </div>

                <div className="sidebar-section-label">Navigation</div>
                <div className="sidebar-nav">
                    {NAV_ITEMS.map((item) => {
                        const badge = item.id === "applications" ? pendingApplicationCount : item.id === "visits" ? pendingVisitCount : 0;
                        return (
                            <div key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
                                <span className="nav-icon" style={{ fontSize: 12 }}>{item.icon}</span>
                                <span>{item.label}</span>
                                {badge > 0 && <span className="nav-badge">{badge}</span>}
                            </div>
                        );
                    })}
                </div>

                <div className="sidebar-footer">
                    <div className="sidebar-user" onClick={() => setTab("settings")}>
                        <div className="user-avatar">{firstName.slice(0, 1).toUpperCase()}</div>
                        <div className="user-info">
                            <div className="user-name">{ownerDisplayName}</div>
                            <div className="user-role">Property Owner</div>
                        </div>
                    </div>
                    <button className="btn-secondary" style={{ width: "100%", marginTop: 10, justifyContent: "center" }} onClick={handleLogout}>
                        Logout
                    </button>
                </div>
            </aside>

            <main className="dash-main">
                <header className="dash-header">
                    <div className="header-title-group">
                        <div className="header-title">{titleMap[tab] || "Dashboard"}</div>
                        <div className="header-subtitle">{subtitleMap[tab] || ""}</div>
                    </div>
                    <div className="header-actions">
                        <button className="btn-secondary" onClick={loadData}>Refresh</button>
                    </div>
                </header>

                <div className="dash-content">
                    {loading && (
                        <div className="card" style={{ marginBottom: 16 }}>
                            <div className="card-body">Loading dashboard data...</div>
                        </div>
                    )}

                    {error && (
                        <div className="card" style={{ marginBottom: 16, borderColor: "rgba(196,123,26,0.4)" }}>
                            <div className="card-body" style={{ color: "var(--amber)" }}>{error}</div>
                        </div>
                    )}

                    {actionMessage && (
                        <div className="card" style={{ marginBottom: 16 }}>
                            <div className="card-body" style={{ color: "var(--text-mid)" }}>{actionMessage}</div>
                        </div>
                    )}

                    {tab === "overview" && (
                        <>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-navy">▣</div></div>
                                    <div>
                                        <div className="stat-value">{toNumber(summary.totalProperties ?? properties.length)}</div>
                                        <div className="stat-label">Total Properties</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-green">✓</div></div>
                                    <div>
                                        <div className="stat-value">{toNumber(summary.occupiedProperties)}</div>
                                        <div className="stat-label">Occupied Properties</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-gold">₹</div></div>
                                    <div>
                                        <div className="stat-value">₹{fmt(summary.totalExpectedRent)}</div>
                                        <div className="stat-label">Expected Monthly Rent</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-amber">⌛</div></div>
                                    <div>
                                        <div className="stat-value">{pendingApplicationCount}</div>
                                        <div className="stat-label">Pending Applications</div>
                                    </div>
                                </div>
                            </div>

                            <div className="two-col">
                                <div className="card">
                                    <div className="card-header"><div className="card-title">Recent Applications</div></div>
                                    <div className="table-container">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Tenant</th>
                                                    <th>Property</th>
                                                    <th>Status</th>
                                                    <th>Date</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {applications.slice(0, 6).map((app) => (
                                                    <tr key={app?.id}>
                                                        <td>
                                                            <div className="td-primary">{normalizeText(app?.tenant?.name, "Tenant")}</div>
                                                            <div className="td-secondary">{normalizeText(app?.tenant?.email, "-")}</div>
                                                        </td>
                                                        <td>
                                                            <div className="td-primary">{normalizeText(app?.property?.title, "Property")}</div>
                                                            <div className="td-secondary">{normalizeText(app?.property?.city, "-")}</div>
                                                        </td>
                                                        <td>
                                                            <span className={`badge ${statusClass(app?.status)}`}>
                                                                <span className="badge-dot" />
                                                                {normalizeText(app?.status, "pending")}
                                                            </span>
                                                            {normalizeStatus(app?.videoReviewStatus) && (
                                                                <div className="td-secondary">Video: {normalizeStatus(app?.videoReviewStatus)}</div>
                                                            )}
                                                        </td>
                                                        <td>{fmtDate(app?.created_at || app?.createdAt)}</td>
                                                    </tr>
                                                ))}
                                                {applications.length === 0 && (
                                                    <tr><td colSpan={4} style={{ color: "var(--text-lite)" }}>No applications yet.</td></tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="card">
                                    <div className="card-header"><div className="card-title">Recent Visit Requests</div></div>
                                    <div className="table-container">
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Property</th>
                                                    <th>Tenant</th>
                                                    <th>Status</th>
                                                    <th>Preferred Date</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {visits.slice(0, 6).map((visit) => (
                                                    <tr key={visit?.id}>
                                                        <td className="td-primary">{normalizeText(propertyById.get(String(visit?.property_id))?.title, `Property ${visit?.property_id || ""}`)}</td>
                                                        <td>{normalizeText(visit?.tenant_id, "-")}</td>
                                                        <td>
                                                            <span className={`badge ${statusClass(visit?.status)}`}>
                                                                <span className="badge-dot" />
                                                                {normalizeText(visit?.status, "pending")}
                                                            </span>
                                                        </td>
                                                        <td>{fmtDate(visit?.preferred_date || visit?.preferredDate)}</td>
                                                    </tr>
                                                ))}
                                                {visits.length === 0 && (
                                                    <tr><td colSpan={4} style={{ color: "var(--text-lite)" }}>No visit requests yet.</td></tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {tab === "properties" && (
                        <>
                            <div className="section-head">
                                <div>
                                    <div className="section-title">Properties</div>
                                    <div className="section-sub">
                                        {properties.length} total · {toNumber(summary.occupiedProperties)} occupied · {toNumber(summary.vacantProperties)} vacant
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button className="btn-secondary" onClick={() => navigate("/owner/properties")}>Manage List</button>
                                    <button className="btn-primary" onClick={() => navigate("/owner/properties/new")}>Add Property</button>
                                </div>
                            </div>

                            <div className="filter-row">
                                {["all", "occupied", "vacant", "notice"].map((status) => (
                                    <button key={status} className={`filter-chip ${propertiesFilter === status ? "active" : ""}`} onClick={() => setPropertiesFilter(status)}>
                                        {status === "all" ? "All" : status}
                                    </button>
                                ))}
                                <div className="filter-spacer" />
                                <div className="header-search" style={{ width: 240 }}>
                                    <input
                                        placeholder="Search properties..."
                                        value={propertiesSearch}
                                        onChange={(event) => setPropertiesSearch(event.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="property-grid">
                                {filteredProperties.map((property) => (
                                    <div key={property?.id} className="property-card" onClick={() => fetchPropertyDetails(property?.id)}>
                                        <div className="property-thumb">
                                            <div className="property-thumb-grid">{Array.from({ length: 24 }).map((_, idx) => <span key={idx} />)}</div>
                                            <div className="property-status-badge">
                                                <span className={`badge ${statusClass(property?.status)}`}>
                                                    <span className="badge-dot" />
                                                    {normalizeText(property?.status, "vacant")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="property-body">
                                            <div className="property-name">{normalizeText(property?.title, "Untitled Property")}</div>
                                            <div className="property-address">{normalizeText(property?.address, "-")}, {normalizeText(property?.city, "-")}</div>
                                            <div className="property-meta">
                                                <div className="property-meta-item"><span className="meta-label">Type</span><span className="meta-value">{normalizeText(property?.propertyType, "-")}</span></div>
                                                <div className="property-meta-item"><span className="meta-label">BHK</span><span className="meta-value">{normalizeText(property?.bhk, "-")}</span></div>
                                                <div className="property-meta-item"><span className="meta-label">Available</span><span className="meta-value">{fmtDate(property?.availableFrom)}</span></div>
                                                <div className="property-meta-item"><span className="meta-label">City</span><span className="meta-value">{normalizeText(property?.city, "-")}</span></div>
                                            </div>
                                            <div className="property-footer">
                                                <div className="property-rent">₹{fmt(property?.rent)}<span> / month</span></div>
                                                <button className="btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={(event) => { event.stopPropagation(); fetchPropertyDetails(property?.id); }}>
                                                    View Details
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {filteredProperties.length === 0 && (
                                <div className="card" style={{ marginTop: 12 }}><div className="card-body">No properties match this filter.</div></div>
                            )}

                            {(propertyDetailLoading || selectedPropertyDetail || propertyDetailError) && (
                                <div className="card" style={{ marginTop: 18 }}>
                                    <div className="card-header"><div className="card-title">Property Details</div></div>
                                    <div className="card-body">
                                        {propertyDetailLoading && <div>Loading property details...</div>}
                                        {propertyDetailError && <div style={{ color: "var(--amber)" }}>{propertyDetailError}</div>}

                                        {selectedPropertyDetail && !propertyDetailLoading && (
                                            <>
                                                <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--navy)", marginBottom: 8 }}>
                                                    {normalizeText(selectedPropertyDetail?.property?.title, "Property")}
                                                </div>
                                                <div style={{ color: "var(--text-mid)", marginBottom: 14 }}>
                                                    {normalizeText(selectedPropertyDetail?.property?.address, "-")}, {normalizeText(selectedPropertyDetail?.property?.city, "-")}
                                                </div>

                                                <div className="info-grid" style={{ marginBottom: 16 }}>
                                                    <div className="info-item"><span className="info-key">Monthly Rent</span><span className="info-val-strong">₹{fmt(selectedPropertyDetail?.property?.rent)}</span></div>
                                                    <div className="info-item"><span className="info-key">Deposit</span><span className="info-val-strong">₹{fmt(selectedPropertyDetail?.property?.deposit)}</span></div>
                                                    <div className="info-item"><span className="info-key">Active Tenancy</span><span className="info-val-strong">{selectedPropertyDetail?.activeTenancy ? "Yes" : "No"}</span></div>
                                                    <div className="info-item"><span className="info-key">Status</span><span className="info-val-strong">{normalizeText(selectedPropertyDetail?.property?.status, "-")}</span></div>
                                                </div>

                                                <div className="info-grid">
                                                    <div className="info-item"><span className="info-key">Payments</span><span className="info-val-strong">{normalizeArray(selectedPropertyDetail?.payments).length}</span></div>
                                                    <div className="info-item"><span className="info-key">Maintenance</span><span className="info-val-strong">{normalizeArray(selectedPropertyDetail?.maintenance).length}</span></div>
                                                    <div className="info-item"><span className="info-key">Documents</span><span className="info-val-strong">{normalizeArray(selectedPropertyDetail?.documents).length}</span></div>
                                                    <div className="info-item"><span className="info-key">Media</span><span className="info-val-strong">{normalizeArray(selectedPropertyDetail?.media).length}</span></div>
                                                </div>

                                                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                                                    <button className="btn-secondary" onClick={() => navigate(`/owner/properties/${selectedPropertyId}`)}>Open Full Detail</button>
                                                    <button className="btn-primary" onClick={() => navigate(`/owner/properties/${selectedPropertyId}/edit`)}>Edit Property</button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {tab === "applications" && (
                        <>
                            <div className="section-head">
                                <div>
                                    <div className="section-title">Applications</div>
                                    <div className="section-sub">Review tenant stay applications in real time</div>
                                </div>
                            </div>

                            <div className="filter-row">
                                {["all", "pending", "approved", "rejected", "withdrawn"].map((status) => (
                                    <button key={status} className={`filter-chip ${applicationFilter === status ? "active" : ""}`} onClick={() => setApplicationFilter(status)}>
                                        {status === "all" ? "All" : status}
                                    </button>
                                ))}
                                <div className="filter-spacer" />
                                <div className="header-search" style={{ width: 260 }}>
                                    <input
                                        placeholder="Search applications..."
                                        value={applicationSearch}
                                        onChange={(event) => setApplicationSearch(event.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="card">
                                <div className="table-container">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Tenant</th>
                                                <th>Property</th>
                                                <th>Offer</th>
                                                <th>Move In</th>
                                                <th>Lease</th>
                                                <th>Status</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredApplications.map((app) => {
                                                const approveKey = `approved-${app?.id}`;
                                                const rejectKey = `rejected-${app?.id}`;
                                                const busy = Boolean(actionBusy[approveKey] || actionBusy[rejectKey]);
                                                const pending = isPending(app?.status);

                                                return (
                                                    <tr key={app?.id}>
                                                        <td>
                                                            <div className="td-primary">{normalizeText(app?.tenant?.name, "Tenant")}</div>
                                                            <div className="td-secondary">{normalizeText(app?.tenant?.email, "-")}</div>
                                                        </td>
                                                        <td>
                                                            <div className="td-primary">{normalizeText(app?.property?.title, "Property")}</div>
                                                            <div className="td-secondary">{normalizeText(app?.property?.city, "-")}</div>
                                                        </td>
                                                        <td className="td-mono">₹{fmt(app?.offered_rent || propertyById.get(String(app?.property_id))?.rent || 0)}</td>
                                                        <td>{fmtDate(app?.requested_move_in_date)}</td>
                                                        <td>{toNumber(app?.requested_lease_months) || 11} months</td>
                                                        <td>
                                                            <span className={`badge ${statusClass(app?.status)}`}>
                                                                <span className="badge-dot" />
                                                                {normalizeText(app?.status, "pending")}
                                                            </span>
                                                            {normalizeStatus(app?.videoReviewStatus) && (
                                                                <div className="td-secondary">Video: {normalizeStatus(app?.videoReviewStatus)}</div>
                                                            )}
                                                        </td>
                                                        <td>
                                                            {pending ? (
                                                                <div style={{ display: "flex", gap: 8 }}>
                                                                    <button className="btn-primary" disabled={busy} style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => handleReview(app, "approved")}>
                                                                        {actionBusy[approveKey] ? "Approving..." : "Approve"}
                                                                    </button>
                                                                    <button className="btn-secondary" disabled={busy} style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => handleReview(app, "rejected")}>
                                                                        {actionBusy[rejectKey] ? "Rejecting..." : "Reject"}
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span style={{ fontSize: 12, color: "var(--text-lite)" }}>Reviewed {fmtDate(app?.reviewed_at)}</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}

                                            {filteredApplications.length === 0 && (
                                                <tr><td colSpan={7} style={{ color: "var(--text-lite)" }}>No applications found.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}

                    {tab === "visits" && (
                        <div className="card">
                            <div className="card-header"><div className="card-title">Visit Requests</div></div>
                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Property</th>
                                            <th>Tenant ID</th>
                                            <th>Preferred Date</th>
                                            <th>Time Slot</th>
                                            <th>Status</th>
                                            <th>Note</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visits.map((visit) => (
                                            <tr key={visit?.id}>
                                                <td className="td-primary">{normalizeText(propertyById.get(String(visit?.property_id))?.title, `Property ${visit?.property_id || ""}`)}</td>
                                                <td>{normalizeText(visit?.tenant_id, "-")}</td>
                                                <td>{fmtDate(visit?.preferred_date || visit?.preferredDate)}</td>
                                                <td>{normalizeText(visit?.preferred_time_slot || visit?.preferredTimeSlot, "-")}</td>
                                                <td>
                                                    <span className={`badge ${statusClass(visit?.status)}`}>
                                                        <span className="badge-dot" />
                                                        {normalizeText(visit?.status, "pending")}
                                                    </span>
                                                </td>
                                                <td>{normalizeText(visit?.note, "-")}</td>
                                            </tr>
                                        ))}
                                        {visits.length === 0 && (
                                            <tr><td colSpan={6} style={{ color: "var(--text-lite)" }}>No visit requests yet.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {tab === "settings" && (
                        <div className="card">
                            <div className="card-header"><div className="card-title">Account Settings</div></div>
                            <div className="card-body">
                                <div className="info-grid" style={{ marginBottom: 18 }}>
                                    <div className="info-item"><span className="info-key">Name</span><span className="info-val-strong">{ownerDisplayName}</span></div>
                                    <div className="info-item"><span className="info-key">Email</span><span className="info-val-strong">{normalizeText(profile?.email)}</span></div>
                                    <div className="info-item"><span className="info-key">Role</span><span className="info-val-strong">Owner</span></div>
                                    <div className="info-item"><span className="info-key">Session</span><span className="info-val-strong">Active</span></div>
                                </div>

                                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                    <button className="btn-secondary" onClick={() => navigate("/owner/properties")}>Open Property Manager</button>
                                    <button className="btn-secondary" onClick={() => navigate("/owner/leases")}>Open Lease Manager</button>
                                    <button className="btn-secondary" onClick={() => navigate("/owner/payments")}>Open Payments</button>
                                    <button className="btn-secondary" onClick={() => navigate("/owner/maintenance")}>Open Maintenance</button>
                                    <button className="btn-secondary" onClick={() => navigate("/owner/documents")}>Open Documents</button>
                                    <button className="btn-primary" onClick={handleLogout}>Logout</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
