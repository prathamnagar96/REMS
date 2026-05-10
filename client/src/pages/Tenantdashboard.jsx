import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    applyForProperty,
    browseProperties,
    getTenantDashboard,
    getTenantApplications,
    requestPropertyVisit,
    reviewTenantApplicationVideo,
    submitMoveOutVideo,
} from "../services/apiClient";
import { useAuth } from "../context/AuthContext";
import "./Dashboard.css";

const fmt = (value) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return "0";
    return new Intl.NumberFormat("en-IN").format(amount);
};

const fmtDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const toDate = (value) => {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? null : date;
};

const daysUntil = (value) => {
    const date = toDate(value);
    if (!date) return null;
    return Math.ceil((date.getTime() - Date.now()) / 86400000);
};

const normalizeName = (profile) => {
    const raw = profile?.full_name || profile?.fullName || profile?.name || "Tenant";
    return String(raw).trim() || "Tenant";
};

const normalizeText = (value, fallback = "-") => {
    if (value == null) return fallback;
    const text = String(value).trim();
    return text || fallback;
};

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const NAV_ITEMS = [
    { id: "overview", label: "Overview", icon: "◫" },
    { id: "my-property", label: "My Property", icon: "▣" },
    { id: "browse", label: "Browse Properties", icon: "◧" },
    { id: "payments", label: "Rent & Payments", icon: "₹" },
    { id: "maintenance", label: "Maintenance", icon: "🛠" },
    { id: "documents", label: "Documents", icon: "⌁" },
];

export default function TenantDashboard() {
    const navigate = useNavigate();
    const { profile, logout } = useAuth();

    const [tab, setTab] = useState("overview");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [dashboard, setDashboard] = useState(null);

    const [browseLoading, setBrowseLoading] = useState(true);
    const [browseError, setBrowseError] = useState("");
    const [browseItems, setBrowseItems] = useState([]);

    const [actionBusy, setActionBusy] = useState({});
    const [actionMessage, setActionMessage] = useState("");

    const [applications, setApplications] = useState([]);
    const [applicationsLoading, setApplicationsLoading] = useState(true);
    const [applicationsError, setApplicationsError] = useState("");

    const [moveOutForm, setMoveOutForm] = useState({
        videoUrl: "",
        geoLat: "",
        geoLng: "",
        geoAccuracy: "",
        note: "",
    });

    const activeProperty = dashboard?.activeProperty || null;
    const activeTenancy = dashboard?.activeTenancy || null;
    const upcomingPayments = normalizeArray(dashboard?.upcomingPayments);
    const maintenance = normalizeArray(dashboard?.maintenance);
    const documents = normalizeArray(dashboard?.documents);

    const pendingApplications = Number(dashboard?.summary?.pendingApplications || 0);
    const pendingVisitRequests = Number(dashboard?.summary?.pendingVisitRequests || 0);

    const nextPayment = useMemo(() => {
        const candidates = upcomingPayments
            .map((item) => {
                const dueDate = toDate(item?.due_date || item?.dueDate);
                return { item, dueDate };
            })
            .filter(({ dueDate }) => Boolean(dueDate))
            .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

        return candidates.length ? candidates[0].item : null;
    }, [upcomingPayments]);

    const openMaintenanceCount = useMemo(() => {
        return maintenance.filter((item) => {
            const status = String(item?.status || "").toLowerCase();
            return status !== "resolved" && status !== "closed";
        }).length;
    }, [maintenance]);

    const loadDashboard = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const data = await getTenantDashboard();
            setDashboard(data || null);
        } catch (err) {
            setError(err?.message || "Unable to load tenant dashboard.");
            setDashboard(null);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadBrowse = useCallback(async () => {
        setBrowseLoading(true);
        setBrowseError("");
        try {
            const response = await browseProperties({ availableOnly: true, limit: 24 });
            const items = normalizeArray(response?.items);
            setBrowseItems(items);
        } catch (err) {
            setBrowseError(err?.message || "Unable to browse properties.");
            setBrowseItems([]);
        } finally {
            setBrowseLoading(false);
        }
    }, []);

    const loadApplications = useCallback(async () => {
        setApplicationsLoading(true);
        setApplicationsError("");
        try {
            const response = await getTenantApplications();
            setApplications(normalizeArray(response?.items));
        } catch (err) {
            setApplicationsError(err?.message || "Unable to load applications.");
            setApplications([]);
        } finally {
            setApplicationsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDashboard();
        loadBrowse();
        loadApplications();
    }, [loadDashboard, loadBrowse, loadApplications]);

    const handleLogout = () => {
        logout();
        navigate("/auth", { replace: true });
    };

    const buildTenantContact = () => {
        const tenantSource = profile || dashboard?.tenant || {};
        const fullName = normalizeName(tenantSource);
        const email = tenantSource?.email || profile?.email || dashboard?.tenant?.email || null;
        const phone = tenantSource?.phone || tenantSource?.phone_number || profile?.phone || profile?.phone_number || dashboard?.tenant?.phone || dashboard?.tenant?.phone_number || null;
        return { fullName, email, phone };
    };

    const handleVisitRequest = async (propertyId) => {
        setActionMessage("");
        setActionBusy((prev) => ({ ...prev, [`visit-${propertyId}`]: true }));
        try {
            const { fullName, email, phone } = buildTenantContact();
            await requestPropertyVisit(propertyId, {
                preferredDate: null,
                preferredTimeSlot: null,
                note: "Requested from tenant dashboard",
                fullName,
                email,
                phone,
            });
            setActionMessage("Visit request submitted.");
            await loadDashboard();
            await loadApplications();
        } catch (err) {
            setActionMessage(err?.message || "Failed to submit visit request.");
        } finally {
            setActionBusy((prev) => ({ ...prev, [`visit-${propertyId}`]: false }));
        }
    };

    const handleApply = async (propertyId) => {
        setActionMessage("");
        setActionBusy((prev) => ({ ...prev, [`apply-${propertyId}`]: true }));
        try {
            const { fullName, email, phone } = buildTenantContact();
            await applyForProperty(propertyId, {
                moveInDate: null,
                leaseMonths: 11,
                offeredRent: null,
                note: "Submitted from tenant dashboard",
                fullName,
                email,
                phone,
            });
            setActionMessage("Application submitted successfully.");
            await loadDashboard();
            await loadApplications();
        } catch (err) {
            setActionMessage(err?.message || "Failed to submit application.");
        } finally {
            setActionBusy((prev) => ({ ...prev, [`apply-${propertyId}`]: false }));
        }
    };

    const videoReviewQueue = useMemo(() => {
        return applications.filter((app) => {
            const status = normalizeStatus(app?.status);
            const reviewStatus = normalizeStatus(app?.videoReviewStatus);
            return status === "approved" && (!reviewStatus || reviewStatus === "pending");
        });
    }, [applications]);

    const handleVideoDecision = async (applicationId, decision) => {
        if (!applicationId) return;
        const busyKey = `video-${decision}-${applicationId}`;
        setActionMessage("");
        setActionBusy((prev) => ({ ...prev, [busyKey]: true }));
        try {
            await reviewTenantApplicationVideo(applicationId, { decision });
            setActionMessage(decision === "accept" ? "Handover accepted. Lease activated." : "Handover declined.");
            await loadDashboard();
            await loadApplications();
        } catch (err) {
            setActionMessage(err?.message || "Unable to review handover video.");
        } finally {
            setActionBusy((prev) => ({ ...prev, [busyKey]: false }));
        }
    };

    const handleMoveOutChange = (event) => {
        const { name, value } = event.target;
        setMoveOutForm((prev) => ({ ...prev, [name]: value }));
    };

    const handleCaptureLocation = () => {
        if (!navigator.geolocation) {
            setActionMessage("Geolocation is not supported in this browser.");
            return;
        }
        setActionBusy((prev) => ({ ...prev, geo: true }));
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                setMoveOutForm((prev) => ({
                    ...prev,
                    geoLat: String(latitude.toFixed(6)),
                    geoLng: String(longitude.toFixed(6)),
                    geoAccuracy: accuracy ? String(Math.round(accuracy)) : prev.geoAccuracy,
                }));
                setActionBusy((prev) => ({ ...prev, geo: false }));
            },
            (error) => {
                setActionMessage(error?.message || "Unable to fetch location.");
                setActionBusy((prev) => ({ ...prev, geo: false }));
            },
        );
    };

    const handleMoveOutSubmit = async () => {
        if (!activeTenancy?.id) return;
        setActionMessage("");
        setActionBusy((prev) => ({ ...prev, "move-out": true }));
        try {
            const payload = {
                videoUrl: moveOutForm.videoUrl,
                capturedAt: null,
                geoLat: moveOutForm.geoLat ? Number(moveOutForm.geoLat) : null,
                geoLng: moveOutForm.geoLng ? Number(moveOutForm.geoLng) : null,
                geoAccuracy: moveOutForm.geoAccuracy ? Number(moveOutForm.geoAccuracy) : null,
                note: moveOutForm.note || null,
            };
            await submitMoveOutVideo(activeTenancy.id, payload);
            setActionMessage("Move-out video submitted. Awaiting owner review.");
            await loadDashboard();
        } catch (err) {
            setActionMessage(err?.message || "Unable to submit move-out video.");
        } finally {
            setActionBusy((prev) => ({ ...prev, "move-out": false }));
        }
    };

    const tenantName = normalizeName(profile || dashboard?.tenant || {});
    const firstName = tenantName.split(" ")[0] || "Tenant";
    const moveOutStatus = normalizeStatus(activeTenancy?.move_out_status || activeTenancy?.moveOutStatus);
    const moveOutSubmitted = ["submitted", "accepted"].includes(moveOutStatus);

    const headerTitle = {
        overview: "Overview",
        "my-property": "My Property",
        browse: "Browse Properties",
        payments: "Rent & Payments",
        maintenance: "Maintenance",
        documents: "Documents",
    }[tab] || "Dashboard";

    const headerSubtitle = {
        overview: `Good morning, ${firstName}`,
        "my-property": "Current tenancy details from backend",
        browse: "Live properties available for visits and applications",
        payments: "Payment records from backend tables",
        maintenance: "Track all maintenance requests",
        documents: "Lease and document center",
    }[tab] || "";

    return (
        <div className="dash-root">
            <aside className="dash-sidebar">
                <div className="sidebar-logo">
                    <div className="sidebar-logo-mark" style={{ color: "var(--gold)", fontSize: 18 }}>▦</div>
                    <div>
                        <div className="sidebar-logo-text">REMS</div>
                        <div className="sidebar-logo-sub">TENANT PORTAL</div>
                    </div>
                </div>

                <div className="sidebar-section-label">Navigation</div>
                <div className="sidebar-nav">
                    {NAV_ITEMS.map((item) => (
                        <div key={item.id} className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
                            <span className="nav-icon" style={{ fontSize: 12 }}>{item.icon}</span>
                            <span>{item.label}</span>
                            {item.id === "maintenance" && openMaintenanceCount > 0 && (
                                <span className="nav-badge">{openMaintenanceCount}</span>
                            )}
                        </div>
                    ))}
                </div>

                <div className="sidebar-footer">
                    <div className="sidebar-user" onClick={() => setTab("overview")}>
                        <div className="user-avatar">{firstName.slice(0, 1).toUpperCase()}</div>
                        <div className="user-info">
                            <div className="user-name">{tenantName}</div>
                            <div className="user-role">Tenant</div>
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
                        <div className="header-title">{headerTitle}</div>
                        <div className="header-subtitle">{headerSubtitle}</div>
                    </div>
                    <div className="header-actions">
                        <button className="btn-secondary" onClick={() => { loadDashboard(); loadBrowse(); loadApplications(); }}>
                            Refresh
                        </button>
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
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-gold">₹</div></div>
                                    <div>
                                        <div className="stat-value">₹{fmt(nextPayment?.amount || nextPayment?.total_amount || 0)}</div>
                                        <div className="stat-label">Next Payment Amount</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-navy">⌛</div></div>
                                    <div>
                                        <div className="stat-value">{daysUntil(activeTenancy?.lease_end) ?? "-"}d</div>
                                        <div className="stat-label">Days Until Lease End</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-amber">🛠</div></div>
                                    <div>
                                        <div className="stat-value">{openMaintenanceCount}</div>
                                        <div className="stat-label">Open Maintenance Requests</div>
                                    </div>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-card-top"><div className="stat-icon stat-icon-green">✓</div></div>
                                    <div>
                                        <div className="stat-value">{pendingApplications}</div>
                                        <div className="stat-label">Pending Applications</div>
                                    </div>
                                </div>
                            </div>

                            <div className="card" style={{ marginBottom: 18 }}>
                                <div className="card-header"><div className="card-title">Current Tenancy</div></div>
                                <div className="card-body">
                                    {activeProperty ? (
                                        <div>
                                            <div style={{ fontFamily: "var(--serif)", fontSize: 24, color: "var(--navy)", marginBottom: 8 }}>
                                                {normalizeText(activeProperty.title, "Untitled Property")}
                                            </div>
                                            <div style={{ color: "var(--text-mid)", marginBottom: 12 }}>
                                                {normalizeText(activeProperty.address, "-")}, {normalizeText(activeProperty.city, "-")}
                                            </div>
                                            <div className="info-grid">
                                                <div className="info-item"><span className="info-key">Lease Start</span><span className="info-val-strong">{fmtDate(activeTenancy?.lease_start)}</span></div>
                                                <div className="info-item"><span className="info-key">Lease End</span><span className="info-val-strong">{fmtDate(activeTenancy?.lease_end)}</span></div>
                                                <div className="info-item"><span className="info-key">Monthly Rent</span><span className="info-val-strong">₹{fmt(activeProperty.rent)}</span></div>
                                                <div className="info-item"><span className="info-key">Status</span><span className="info-val-strong">{normalizeText(activeTenancy?.status, "-")}</span></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <div style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--navy)", marginBottom: 6 }}>
                                                No Active Tenancy Yet
                                            </div>
                                            <div style={{ color: "var(--text-mid)", marginBottom: 12 }}>
                                                You are not currently linked to an active property. Browse available properties and apply.
                                            </div>
                                            <button className="btn-primary" onClick={() => navigate("/tenant/search")}>Browse Properties</button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="card" style={{ marginBottom: 18 }}>
                                <div className="card-header"><div className="card-title">Handover Video Review</div></div>
                                <div className="card-body">
                                    {applicationsLoading && (
                                        <div style={{ color: "var(--text-lite)" }}>Loading applications...</div>
                                    )}
                                    {applicationsError && (
                                        <div style={{ color: "var(--amber)" }}>{applicationsError}</div>
                                    )}
                                    {!applicationsLoading && !applicationsError && videoReviewQueue.length === 0 && (
                                        <div style={{ color: "var(--text-lite)" }}>No handover videos awaiting your review.</div>
                                    )}
                                    {videoReviewQueue.map((app) => {
                                        const video = app?.handoverVideo;
                                        const hasVideo = Boolean(video?.url);
                                        const acceptKey = `video-accept-${app?.id}`;
                                        const declineKey = `video-decline-${app?.id}`;
                                        const busy = Boolean(actionBusy[acceptKey] || actionBusy[declineKey]);
                                        const geoLabel = video?.geoLat && video?.geoLng
                                            ? `${Number(video.geoLat).toFixed(4)}, ${Number(video.geoLng).toFixed(4)}`
                                            : null;

                                        return (
                                            <div key={app?.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                                    <div>
                                                        <div style={{ fontWeight: 600, color: "var(--navy)" }}>{normalizeText(app?.property?.title, "Property")}</div>
                                                        <div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 4 }}>{normalizeText(app?.property?.city, "-")}</div>
                                                        {geoLabel && <div style={{ fontSize: 11.5, color: "var(--text-mid)", marginTop: 4 }}>Geo-tag: {geoLabel}</div>}
                                                    </div>
                                                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                                        {hasVideo ? (
                                                            <a className="btn-secondary" style={{ fontSize: 12 }} href={video.url} target="_blank" rel="noreferrer">View Video</a>
                                                        ) : (
                                                            <span style={{ fontSize: 12, color: "var(--text-lite)" }}>Awaiting move-out video</span>
                                                        )}
                                                        <button className="btn-primary" style={{ fontSize: 12 }} disabled={!hasVideo || busy} onClick={() => handleVideoDecision(app?.id, "accept")}>
                                                            {actionBusy[acceptKey] ? "Accepting..." : "Accept"}
                                                        </button>
                                                        <button className="btn-secondary" style={{ fontSize: 12 }} disabled={busy} onClick={() => handleVideoDecision(app?.id, "decline")}>
                                                            {actionBusy[declineKey] ? "Declining..." : "Decline"}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="card">
                                <div className="card-header"><div className="card-title">Workflow Snapshot</div></div>
                                <div className="card-body">
                                    <div className="info-grid">
                                        <div className="info-item"><span className="info-key">Pending Visit Requests</span><span className="info-val-strong">{pendingVisitRequests}</span></div>
                                        <div className="info-item"><span className="info-key">Pending Applications</span><span className="info-val-strong">{pendingApplications}</span></div>
                                        <div className="info-item"><span className="info-key">Payments Loaded</span><span className="info-val-strong">{upcomingPayments.length}</span></div>
                                        <div className="info-item"><span className="info-key">Documents Loaded</span><span className="info-val-strong">{documents.length}</span></div>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {tab === "my-property" && (
                        <>
                            <div className="card">
                                <div className="card-header"><div className="card-title">My Property</div></div>
                                <div className="card-body">
                                    {activeProperty ? (
                                        <div className="info-grid">
                                            <div className="info-item"><span className="info-key">Title</span><span className="info-val-strong">{normalizeText(activeProperty.title)}</span></div>
                                            <div className="info-item"><span className="info-key">Type</span><span className="info-val-strong">{normalizeText(activeProperty.propertyType)}</span></div>
                                            <div className="info-item"><span className="info-key">BHK</span><span className="info-val-strong">{normalizeText(activeProperty.bhk)}</span></div>
                                            <div className="info-item"><span className="info-key">Address</span><span className="info-val-strong">{normalizeText(activeProperty.address)}</span></div>
                                            <div className="info-item"><span className="info-key">City</span><span className="info-val-strong">{normalizeText(activeProperty.city)}</span></div>
                                            <div className="info-item"><span className="info-key">Rent</span><span className="info-val-strong">₹{fmt(activeProperty.rent)}</span></div>
                                        </div>
                                    ) : (
                                        <div style={{ color: "var(--text-mid)" }}>No property linked yet.</div>
                                    )}
                                </div>
                            </div>

                            <div className="card" style={{ marginTop: 16 }}>
                                <div className="card-header"><div className="card-title">Move-out Handover</div></div>
                                <div className="card-body">
                                    {!activeTenancy && (
                                        <div style={{ color: "var(--text-lite)" }}>You can submit a move-out video once you have an active tenancy.</div>
                                    )}
                                    {activeTenancy && (
                                        <>
                                            {moveOutSubmitted && (
                                                <div style={{ marginBottom: 12, color: "var(--green)" }}>
                                                    Move-out video submitted. Status: {normalizeText(moveOutStatus, "submitted")}.
                                                </div>
                                            )}
                                            <div className="info-grid">
                                                <div className="info-item" style={{ gridColumn: "span 2" }}>
                                                    <span className="info-key">Video URL</span>
                                                    <input className="f-ctrl" name="videoUrl" value={moveOutForm.videoUrl} onChange={handleMoveOutChange} placeholder="https://drive.google.com/..." />
                                                </div>
                                                <div className="info-item">
                                                    <span className="info-key">Geo Latitude</span>
                                                    <input className="f-ctrl" name="geoLat" value={moveOutForm.geoLat} onChange={handleMoveOutChange} placeholder="28.6139" />
                                                </div>
                                                <div className="info-item">
                                                    <span className="info-key">Geo Longitude</span>
                                                    <input className="f-ctrl" name="geoLng" value={moveOutForm.geoLng} onChange={handleMoveOutChange} placeholder="77.2090" />
                                                </div>
                                                <div className="info-item">
                                                    <span className="info-key">Accuracy (m)</span>
                                                    <input className="f-ctrl" name="geoAccuracy" value={moveOutForm.geoAccuracy} onChange={handleMoveOutChange} placeholder="20" />
                                                </div>
                                                <div className="info-item" style={{ gridColumn: "span 2" }}>
                                                    <span className="info-key">Note</span>
                                                    <input className="f-ctrl" name="note" value={moveOutForm.note} onChange={handleMoveOutChange} placeholder="Any remarks about the handover" />
                                                </div>
                                            </div>
                                            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                                <button className="btn-secondary" disabled={Boolean(actionBusy.geo)} onClick={handleCaptureLocation}>
                                                    {actionBusy.geo ? "Locating..." : "Use Current Location"}
                                                </button>
                                                <button className="btn-primary" disabled={!moveOutForm.videoUrl || Boolean(actionBusy["move-out"])} onClick={handleMoveOutSubmit}>
                                                    {actionBusy["move-out"] ? "Submitting..." : "Submit Move-out Video"}
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {tab === "browse" && (
                        <>
                            <div className="section-head">
                                <div>
                                    <div className="section-title">Browse Properties</div>
                                    <div className="section-sub">Preview live inventory or open the full search flow</div>
                                </div>
                                <button className="btn-secondary" onClick={() => navigate("/tenant/search")}>Open Full Search</button>
                            </div>

                            {browseLoading && <div className="card"><div className="card-body">Loading available properties...</div></div>}
                            {browseError && <div className="card"><div className="card-body" style={{ color: "var(--amber)" }}>{browseError}</div></div>}

                            <div className="property-grid" style={{ marginTop: 12 }}>
                                {!browseLoading && browseItems.map((item) => {
                                    const id = item?.id;
                                    const visitKey = `visit-${id}`;
                                    const applyKey = `apply-${id}`;
                                    const visitBusy = Boolean(actionBusy[visitKey]);
                                    const applyBusy = Boolean(actionBusy[applyKey]);

                                    return (
                                        <div key={id} className="property-card">
                                            <div className="property-body">
                                                <div className="property-name">{normalizeText(item?.title, "Untitled Property")}</div>
                                                <div className="property-address">{normalizeText(item?.address, "-")}, {normalizeText(item?.city, "-")}</div>
                                                <div className="property-meta" style={{ marginTop: 8 }}>
                                                    <div className="property-meta-item"><span className="meta-label">Type</span><span className="meta-value">{normalizeText(item?.propertyType, "-")}</span></div>
                                                    <div className="property-meta-item"><span className="meta-label">BHK</span><span className="meta-value">{normalizeText(item?.bhk, "-")}</span></div>
                                                    <div className="property-meta-item"><span className="meta-label">Rent</span><span className="meta-value">₹{fmt(item?.rent)}</span></div>
                                                </div>
                                                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                                                    <button className="btn-secondary" disabled={visitBusy || applyBusy} onClick={() => handleVisitRequest(id)}>
                                                        {visitBusy ? "Requesting..." : "Request Visit"}
                                                    </button>
                                                    <button className="btn-primary" disabled={visitBusy || applyBusy} onClick={() => handleApply(id)}>
                                                        {applyBusy ? "Applying..." : "Apply Now"}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {!browseLoading && browseItems.length === 0 && (
                                <div className="card" style={{ marginTop: 12 }}><div className="card-body">No available properties right now.</div></div>
                            )}
                        </>
                    )}

                    {tab === "payments" && (
                        <div className="card">
                            <div className="card-header"><div className="card-title">Payments</div></div>
                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Period</th>
                                            <th>Amount</th>
                                            <th>Due Date</th>
                                            <th>Paid Date</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {upcomingPayments.map((item, idx) => {
                                            const status = String(item?.status || "pending").toLowerCase();
                                            return (
                                                <tr key={item?.id || idx}>
                                                    <td className="td-primary">{normalizeText(item?.month || item?.billing_month, `Payment ${idx + 1}`)}</td>
                                                    <td className="td-mono">₹{fmt(item?.total_amount || item?.amount || item?.rent_amount || 0)}</td>
                                                    <td>{fmtDate(item?.due_date || item?.dueDate)}</td>
                                                    <td>{fmtDate(item?.paid_at || item?.paidDate)}</td>
                                                    <td>
                                                        <span className={`badge ${status === "paid" ? "badge-green" : "badge-amber"}`}>
                                                            <span className="badge-dot" />
                                                            {status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {upcomingPayments.length === 0 && (
                                            <tr><td colSpan={5} style={{ color: "var(--text-lite)" }}>No payment records yet.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {tab === "maintenance" && (
                        <div className="card">
                            <div className="card-header"><div className="card-title">Maintenance</div></div>
                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Issue</th>
                                            <th>Category</th>
                                            <th>Priority</th>
                                            <th>Status</th>
                                            <th>Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {maintenance.map((item, idx) => (
                                            <tr key={item?.id || idx}>
                                                <td className="td-primary">{normalizeText(item?.title || item?.issue, "Maintenance request")}</td>
                                                <td>{normalizeText(item?.category, "General")}</td>
                                                <td>{normalizeText(item?.priority, "-")}</td>
                                                <td>
                                                    <span className={`badge ${String(item?.status || "").toLowerCase() === "resolved" ? "badge-green" : "badge-amber"}`}>
                                                        <span className="badge-dot" />
                                                        {normalizeText(item?.status, "pending")}
                                                    </span>
                                                </td>
                                                <td>{fmtDate(item?.created_at || item?.date)}</td>
                                            </tr>
                                        ))}
                                        {maintenance.length === 0 && (
                                            <tr><td colSpan={5} style={{ color: "var(--text-lite)" }}>No maintenance requests found.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {tab === "documents" && (
                        <div className="card">
                            <div className="card-header"><div className="card-title">Documents</div></div>
                            <div className="table-container">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Category</th>
                                            <th>Date</th>
                                            <th>Shared</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {documents.map((item, idx) => (
                                            <tr key={item?.id || idx}>
                                                <td className="td-primary">{normalizeText(item?.name || item?.file_name, "Document")}</td>
                                                <td>{normalizeText(item?.category, "Other")}</td>
                                                <td>{fmtDate(item?.created_at || item?.date)}</td>
                                                <td>{item?.shared_with_tenant || item?.sharedWithTenant ? "Yes" : "No"}</td>
                                            </tr>
                                        ))}
                                        {documents.length === 0 && (
                                            <tr><td colSpan={4} style={{ color: "var(--text-lite)" }}>No documents available.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
