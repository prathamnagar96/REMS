import { useCallback, useEffect, useMemo, useState } from "react";
import {
    createOwnerMaintenanceTicket,
    getOwnerMaintenance,
    getOwnerProperties,
    updateOwnerMaintenanceTicket,
} from "../services/apiClient";
import "./Dashboard.css";
import "./OwnerExtras.css";

const PRIORITY_CFG = {
    high: { label: "High", cls: "badge-red", dot: "var(--red)" },
    medium: { label: "Medium", cls: "badge-amber", dot: "var(--amber)" },
    low: { label: "Low", cls: "badge-grey", dot: "var(--text-lite)" },
};

const STATUS_CFG = {
    pending: { label: "Open", cls: "badge-amber", color: "var(--amber)" },
    in_progress: { label: "In Progress", cls: "badge-navy", color: "var(--blue)" },
    resolved: { label: "Resolved", cls: "badge-green", color: "var(--green)" },
};

const CAT_ICON = {
    Plumbing: "🔧",
    Electrical: "⚡",
    Appliance: "❄",
    Carpentry: "🪵",
    Civil: "🧱",
    Cleaning: "🧹",
    General: "🛠",
    Other: "🔨",
};

const fmt = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return "0";
    return new Intl.NumberFormat("en-IN").format(n);
};

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

function TicketDrawer({ ticket, saving, onClose, onSave }) {
    const [status, setStatus] = useState(ticket?.status || "pending");
    const [assignedTo, setAssignedTo] = useState(ticket?.assignedTo || "");
    const [assignedPhone, setAssignedPhone] = useState(ticket?.assignedPhone || "");
    const [actualCost, setActualCost] = useState(ticket?.actualCost ?? "");
    const [comment, setComment] = useState("");

    if (!ticket) return null;

    const priorityMeta = PRIORITY_CFG[ticket.priority] || PRIORITY_CFG.medium;
    const statusMeta = STATUS_CFG[ticket.status] || STATUS_CFG.pending;

    return (
        <div style={{ position: "fixed", inset: 0, zIndex: 220, display: "flex" }}>
            <div style={{ flex: 1, background: "rgba(12,27,46,0.45)" }} onClick={onClose} />
            <div style={{ width: 560, background: "var(--white)", boxShadow: "-4px 0 24px rgba(12,27,46,0.14)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ background: "linear-gradient(135deg,var(--navy) 0%,var(--navy-lite) 100%)", padding: "20px 24px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                                <span className={`badge ${priorityMeta.cls}`}><span className="badge-dot" />{priorityMeta.label}</span>
                                <span className={`badge ${statusMeta.cls}`}><span className="badge-dot" />{statusMeta.label}</span>
                            </div>
                            <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 4 }}>{normalizeText(ticket.title)}</div>
                            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{normalizeText(ticket.property)} · {normalizeText(ticket.tenant)}</div>
                        </div>
                        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", width: 32, height: 32, borderRadius: 6, cursor: "pointer", fontSize: 18 }}>x</button>
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 20px" }}>
                    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Details</div>
                        <div className="info-grid-3">
                            {[
                                ["Ticket ID", normalizeText(ticket.id)],
                                ["Category", normalizeText(ticket.category, "General")],
                                ["Property", normalizeText(ticket.property)],
                                ["Tenant", normalizeText(ticket.tenant)],
                                ["Reported", fmtDate(ticket.createdAt)],
                                ["Updated", fmtDate(ticket.updatedAt)],
                            ].map(([k, v]) => (
                                <div key={k} className="info-item">
                                    <span className="info-key">{k}</span>
                                    <span className="info-val-strong">{v}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--surface)", borderRadius: 4, border: "1px solid var(--border)", fontSize: 13.5, color: "var(--text-mid)", lineHeight: 1.6 }}>
                            {normalizeText(ticket.description, "No additional details provided.")}
                        </div>
                    </div>

                    <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Update Status</div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                            {Object.entries(STATUS_CFG).map(([value, meta]) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setStatus(value)}
                                    style={{
                                        padding: "7px 16px",
                                        fontFamily: "var(--sans)",
                                        fontSize: 13,
                                        fontWeight: status === value ? 600 : 400,
                                        color: status === value ? "#fff" : meta.color,
                                        background: status === value ? meta.color : "transparent",
                                        border: `1.5px solid ${meta.color}`,
                                        borderRadius: "var(--radius)",
                                        cursor: "pointer",
                                    }}
                                >
                                    {meta.label}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="f-grp">
                                <label className="f-lbl">Assign Vendor</label>
                                <input className="f-ctrl" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder="Vendor or technician" />
                            </div>
                            <div className="f-grp">
                                <label className="f-lbl">Vendor Phone</label>
                                <input className="f-ctrl" value={assignedPhone} onChange={(event) => setAssignedPhone(event.target.value)} placeholder="+91 ..." />
                            </div>
                            <div className="f-grp">
                                <label className="f-lbl">Actual Cost (INR)</label>
                                <input className="f-ctrl" type="number" min="0" value={actualCost} onChange={(event) => setActualCost(event.target.value)} placeholder="0" />
                            </div>
                        </div>
                    </div>

                    <div style={{ padding: "16px 0" }}>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Comments</div>
                        {Array.isArray(ticket.comments) && ticket.comments.length > 0 ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                                {ticket.comments.map((item, index) => (
                                    <div key={`${ticket.id}-comment-${index}`} style={{ padding: "10px 14px", background: "var(--surface)", borderRadius: 5, border: "1px solid var(--border)" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{normalizeText(item.by, "Owner")}</span>
                                            <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-lite)" }}>{normalizeText(item.time, "-")}</span>
                                        </div>
                                        <div style={{ fontSize: 13.5, color: "var(--text-mid)", lineHeight: 1.5 }}>{normalizeText(item.text, "-")}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontSize: 12, color: "var(--text-lite)", marginBottom: 10 }}>No comments yet.</div>
                        )}
                        <div className="f-grp">
                            <label className="f-lbl">Add Comment</label>
                            <textarea className="f-ctrl" rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add an update note..." style={{ resize: "none" }} />
                        </div>
                    </div>
                </div>

                <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
                    <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
                    <button
                        className="btn-primary"
                        style={{ flex: 2, justifyContent: "center" }}
                        disabled={saving}
                        onClick={() => onSave(ticket.id, {
                            status,
                            assignedTo,
                            assignedPhone,
                            actualCost: actualCost === "" ? null : Number(actualCost),
                            comment,
                        })}
                    >
                        {saving ? "Saving..." : "Save Changes"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function OwnerMaintenance() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [tickets, setTickets] = useState([]);
    const [summary, setSummary] = useState({ pending: 0, inProgress: 0, resolved: 0, highPriorityOpen: 0 });
    const [properties, setProperties] = useState([]);

    const [view, setView] = useState("kanban");
    const [search, setSearch] = useState("");
    const [propertyFilter, setPropertyFilter] = useState("all");
    const [categoryFilter, setCategoryFilter] = useState("all");

    const [selectedTicket, setSelectedTicket] = useState(null);
    const [drawerSaving, setDrawerSaving] = useState(false);

    const [showNew, setShowNew] = useState(false);
    const [newSaving, setNewSaving] = useState(false);
    const [newForm, setNewForm] = useState({
        title: "",
        propertyId: "",
        category: "General",
        priority: "medium",
        description: "",
    });

    const loadData = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const [maintenanceResponse, propertiesResponse] = await Promise.all([
                getOwnerMaintenance(),
                getOwnerProperties(),
            ]);

            const maintenanceItems = Array.isArray(maintenanceResponse?.items) ? maintenanceResponse.items : [];
            const propertyItems = Array.isArray(propertiesResponse?.items) ? propertiesResponse.items : [];

            setTickets(maintenanceItems);
            setSummary(maintenanceResponse?.summary || { pending: 0, inProgress: 0, resolved: 0, highPriorityOpen: 0 });
            setProperties(propertyItems.map((item) => ({ id: String(item.id), title: normalizeText(item.title, "Property") })));
        } catch (err) {
            setTickets([]);
            setError(err?.message || "Unable to load maintenance board.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const categories = useMemo(() => {
        const set = new Set(tickets.map((ticket) => normalizeText(ticket.category, "General")));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [tickets]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return tickets.filter((ticket) => {
            const matchesProperty = propertyFilter === "all" || String(ticket.propertyId) === propertyFilter;
            const matchesCategory = categoryFilter === "all" || normalizeText(ticket.category, "General") === categoryFilter;
            if (!matchesProperty || !matchesCategory) return false;

            if (!q) return true;
            const blob = [ticket.title, ticket.tenant, ticket.property, ticket.description]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return blob.includes(q);
        });
    }, [tickets, search, propertyFilter, categoryFilter]);

    const grouped = useMemo(() => {
        return {
            pending: filtered.filter((ticket) => ticket.status === "pending"),
            in_progress: filtered.filter((ticket) => ticket.status === "in_progress"),
            resolved: filtered.filter((ticket) => ticket.status === "resolved"),
        };
    }, [filtered]);

    const totalCost = useMemo(() => {
        return tickets.reduce((sum, ticket) => sum + Number(ticket.actualCost || 0), 0);
    }, [tickets]);

    const handleCreate = async () => {
        if (!newForm.title.trim() || !newForm.propertyId) {
            setError("Title and property are required to create a ticket.");
            return;
        }

        setError("");
        setNewSaving(true);
        try {
            const response = await createOwnerMaintenanceTicket({
                propertyId: newForm.propertyId,
                title: newForm.title.trim(),
                category: newForm.category,
                priority: newForm.priority,
                description: newForm.description.trim() || null,
            });
            const created = response?.ticket;
            if (created) {
                setTickets((prev) => [created, ...prev]);
            }
            setShowNew(false);
            setNewForm({ title: "", propertyId: "", category: "General", priority: "medium", description: "" });
            await loadData();
        } catch (err) {
            setError(err?.message || "Unable to create ticket.");
        } finally {
            setNewSaving(false);
        }
    };

    const handleUpdate = async (ticketId, updates) => {
        setDrawerSaving(true);
        setError("");
        try {
            const response = await updateOwnerMaintenanceTicket(ticketId, updates);
            const updated = response?.ticket;
            if (updated) {
                setTickets((prev) => prev.map((item) => (String(item.id) === String(ticketId) ? updated : item)));
                setSelectedTicket(updated);
            }
            await loadData();
        } catch (err) {
            setError(err?.message || "Unable to update ticket.");
        } finally {
            setDrawerSaving(false);
        }
    };

    const renderTicketCard = (ticket, delay = 0) => {
        const priorityMeta = PRIORITY_CFG[ticket.priority] || PRIORITY_CFG.medium;
        return (
            <div key={ticket.id} className="mnt-card" style={{ animationDelay: `${delay}ms`, borderLeft: `3px solid ${priorityMeta.dot}` }} onClick={() => setSelectedTicket(ticket)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>{CAT_ICON[normalizeText(ticket.category, "General")] || CAT_ICON.General}</span>
                    <span className={`badge ${priorityMeta.cls}`}><span className="badge-dot" />{priorityMeta.label}</span>
                </div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 13.5, fontWeight: 600, color: "var(--navy)", lineHeight: 1.35, marginBottom: 6 }}>{normalizeText(ticket.title, "Maintenance request")}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginBottom: 10 }}>{normalizeText(ticket.property)} · {normalizeText(ticket.tenant)}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-mid)", lineHeight: 1.5, marginBottom: 10 }}>{normalizeText(ticket.description, "No description provided.")}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, color: "var(--text-lite)", fontFamily: "var(--mono)" }}>{fmtDate(ticket.createdAt)}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {ticket.assignedTo && <span style={{ fontSize: 11, color: "var(--text-mid)", background: "var(--surface)", padding: "2px 7px", borderRadius: 20 }}>{ticket.assignedTo}</span>}
                        {Number(ticket.actualCost) > 0 && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--green)" }}>INR {fmt(ticket.actualCost)}</span>}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="dash-root">
            <main className="dash-main">
                <header className="dash-header">
                    <div className="header-title-group">
                        <div className="header-title">Maintenance Board</div>
                        <div className="header-subtitle">{summary.pending + summary.inProgress} open · {summary.highPriorityOpen} high-priority</div>
                    </div>
                    <div className="header-search">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input placeholder="Search tickets, tenants, properties..." value={search} onChange={(event) => setSearch(event.target.value)} />
                    </div>
                    <div className="header-actions">
                        <button className="btn-secondary" onClick={loadData}>Refresh</button>
                        <button className="btn-primary btn-gold" onClick={() => setShowNew(true)}>New Ticket</button>
                    </div>
                </header>

                <div className="dash-content">
                    {loading && <div className="card"><div className="card-body">Loading maintenance board...</div></div>}
                    {error && <div className="card"><div className="card-body" style={{ color: "var(--amber)" }}>{error}</div></div>}

                    {!loading && (
                        <>
                            <div className="stats-grid" style={{ marginBottom: 20 }}>
                                {[
                                    [summary.pending, "Open Tickets", "stat-icon-amber", "Needs attention"],
                                    [summary.inProgress, "In Progress", "stat-icon-navy", "Being resolved"],
                                    [summary.resolved, "Resolved", "stat-icon-green", "This period"],
                                    [`INR ${fmt(totalCost)}`, "Maintenance Spend", "stat-icon-gold", "All-time cost"],
                                ].map(([value, label, iconClass, subtitle]) => (
                                    <div key={label} className="stat-card">
                                        <div className="stat-card-top"><div className={`stat-icon ${iconClass}`} /><span className="stat-trend trend-neutral">{subtitle}</span></div>
                                        <div><div className="stat-value" style={{ fontSize: String(value).startsWith("INR") ? 20 : 28 }}>{value}</div><div className="stat-label">{label}</div></div>
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
                                <div className="filter-chips-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                    {categories.map((category) => (
                                        <button key={category} className={`filter-chip${categoryFilter === category ? " active" : ""}`} onClick={() => setCategoryFilter(categoryFilter === category ? "all" : category)}>
                                            {CAT_ICON[category] || CAT_ICON.General} {category}
                                        </button>
                                    ))}
                                </div>
                                <div style={{ flex: 1 }} />
                                <select className="f-ctrl" style={{ width: "auto", minWidth: 220 }} value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value)}>
                                    <option value="all">All Properties</option>
                                    {properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}
                                </select>
                                <div className="view-toggle">
                                    <button className={`view-btn${view === "kanban" ? " view-btn-on" : ""}`} onClick={() => setView("kanban")}>Kanban</button>
                                    <button className={`view-btn${view === "table" ? " view-btn-on" : ""}`} onClick={() => setView("table")}>Table</button>
                                </div>
                            </div>

                            {view === "kanban" ? (
                                <div className="kanban-cols">
                                    {[
                                        ["pending", "Open", "var(--amber)"],
                                        ["in_progress", "In Progress", "var(--blue)"],
                                        ["resolved", "Resolved", "var(--green)"],
                                    ].map(([status, label, color]) => (
                                        <div key={status} className="kanban-col">
                                            <div className="kanban-col-header">
                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
                                                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-mid)", fontWeight: 600 }}>{label}</span>
                                                </div>
                                                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-lite)" }}>{grouped[status].length}</span>
                                            </div>
                                            <div className="kanban-col-body">
                                                {grouped[status].length === 0
                                                    ? <div style={{ textAlign: "center", padding: "28px 12px", color: "var(--text-lite)", fontSize: 13 }}>No {label.toLowerCase()} tickets</div>
                                                    : grouped[status].map((ticket, index) => renderTicketCard(ticket, index * 40))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="card">
                                    <div style={{ overflowX: "auto" }}>
                                        <table className="data-table">
                                            <thead>
                                                <tr>
                                                    <th>Issue</th>
                                                    <th>Property / Tenant</th>
                                                    <th>Priority</th>
                                                    <th>Status</th>
                                                    <th>Assigned To</th>
                                                    <th>Cost</th>
                                                    <th>Date</th>
                                                    <th style={{ textAlign: "right" }}>Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filtered.map((ticket) => {
                                                    const priorityMeta = PRIORITY_CFG[ticket.priority] || PRIORITY_CFG.medium;
                                                    const statusMeta = STATUS_CFG[ticket.status] || STATUS_CFG.pending;
                                                    return (
                                                        <tr key={ticket.id} className="prop-table-row">
                                                            <td>
                                                                <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                                                    <span style={{ fontSize: 18 }}>{CAT_ICON[normalizeText(ticket.category, "General")] || CAT_ICON.General}</span>
                                                                    <div>
                                                                        <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--navy)" }}>{normalizeText(ticket.title, "Maintenance request")}</div>
                                                                        <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 1, fontFamily: "var(--mono)" }}>{normalizeText(ticket.id)}</div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{normalizeText(ticket.property)}</div>
                                                                <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>{normalizeText(ticket.tenant)}</div>
                                                            </td>
                                                            <td><span className={`badge ${priorityMeta.cls}`}><span className="badge-dot" />{priorityMeta.label}</span></td>
                                                            <td><span className={`badge ${statusMeta.cls}`}><span className="badge-dot" />{statusMeta.label}</span></td>
                                                            <td style={{ fontSize: 12.5, color: ticket.assignedTo ? "var(--text-mid)" : "var(--text-lite)", fontStyle: ticket.assignedTo ? "normal" : "italic" }}>{ticket.assignedTo || "Unassigned"}</td>
                                                            <td style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: Number(ticket.actualCost) > 0 ? "var(--green)" : "var(--text-lite)" }}>
                                                                {Number(ticket.actualCost) > 0 ? `INR ${fmt(ticket.actualCost)}` : "-"}
                                                            </td>
                                                            <td style={{ fontSize: 12, color: "var(--text-lite)", fontFamily: "var(--mono)" }}>{fmtDate(ticket.createdAt)}</td>
                                                            <td style={{ textAlign: "right" }}>
                                                                <button className="btn-secondary" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => setSelectedTicket(ticket)}>Manage</button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                                {filtered.length === 0 && <tr><td colSpan={8} style={{ color: "var(--text-lite)" }}>No maintenance tickets found.</td></tr>}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>

            {showNew && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(12,27,46,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setShowNew(false)}>
                    <div style={{ background: "var(--white)", borderRadius: 10, maxWidth: 520, width: "100%", boxShadow: "var(--shadow-md)" }} onClick={(event) => event.stopPropagation()}>
                        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 600, color: "var(--navy)" }}>Create Maintenance Ticket</div>
                            <button onClick={() => setShowNew(false)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "var(--text-mid)" }}>x</button>
                        </div>
                        <div style={{ padding: 24 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                                <div className="f-grp" style={{ gridColumn: "span 2" }}>
                                    <label className="f-lbl">Issue Title</label>
                                    <input className="f-ctrl" value={newForm.title} onChange={(event) => setNewForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="Brief issue description" />
                                </div>
                                <div className="f-grp">
                                    <label className="f-lbl">Property</label>
                                    <select className="f-ctrl" value={newForm.propertyId} onChange={(event) => setNewForm((prev) => ({ ...prev, propertyId: event.target.value }))}>
                                        <option value="">Select property</option>
                                        {properties.map((property) => <option key={property.id} value={property.id}>{property.title}</option>)}
                                    </select>
                                </div>
                                <div className="f-grp">
                                    <label className="f-lbl">Category</label>
                                    <select className="f-ctrl" value={newForm.category} onChange={(event) => setNewForm((prev) => ({ ...prev, category: event.target.value }))}>
                                        {Object.keys(CAT_ICON).map((category) => <option key={category} value={category}>{category}</option>)}
                                    </select>
                                </div>
                                <div className="f-grp">
                                    <label className="f-lbl">Priority</label>
                                    <select className="f-ctrl" value={newForm.priority} onChange={(event) => setNewForm((prev) => ({ ...prev, priority: event.target.value }))}>
                                        {["high", "medium", "low"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                                    </select>
                                </div>
                                <div className="f-grp" style={{ gridColumn: "span 2" }}>
                                    <label className="f-lbl">Description</label>
                                    <textarea className="f-ctrl" rows={3} value={newForm.description} onChange={(event) => setNewForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Detailed description..." style={{ resize: "none" }} />
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                                <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowNew(false)}>Cancel</button>
                                <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} disabled={newSaving} onClick={handleCreate}>
                                    {newSaving ? "Creating..." : "Create Ticket"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {selectedTicket && (
                <TicketDrawer
                    key={selectedTicket.id}
                    ticket={selectedTicket}
                    saving={drawerSaving}
                    onClose={() => setSelectedTicket(null)}
                    onSave={async (ticketId, updates) => {
                        await handleUpdate(ticketId, updates);
                        setSelectedTicket(null);
                    }}
                />
            )}
        </div>
    );
}
