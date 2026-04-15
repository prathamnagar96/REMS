import { useCallback, useEffect, useMemo, useState } from "react";
import { getOwnerDocuments, updateOwnerDocument } from "../services/apiClient";
import "./Dashboard.css";
import "./OwnerExtras.css";

const CATEGORY_META = {
    Lease: { icon: "📋", color: "var(--navy)" },
    Ownership: { icon: "🏠", color: "var(--gold)" },
    "NOC / Legal": { icon: "⚖", color: "var(--blue)" },
    Receipts: { icon: "🧾", color: "var(--green)" },
    KYC: { icon: "🪪", color: "var(--amber)" },
    "Utility Bills": { icon: "⚡", color: "var(--amber)" },
    Maintenance: { icon: "🔧", color: "var(--text-mid)" },
    Media: { icon: "📷", color: "var(--text-mid)" },
    Other: { icon: "📄", color: "var(--text-mid)" },
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

const parseSizeMb = (value) => {
    if (!value) return 0;
    const text = String(value).trim();
    const match = text.match(/([\d.]+)\s*(MB|KB|B)/i);
    if (!match) return 0;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return 0;
    const unit = match[2].toUpperCase();
    if (unit === "MB") return amount;
    if (unit === "KB") return amount / 1024;
    return amount / (1024 * 1024);
};

export default function OwnerDocuments() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [docs, setDocs] = useState([]);

    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [propertyFilter, setPropertyFilter] = useState("all");
    const [viewMode, setViewMode] = useState("list");
    const [selected, setSelected] = useState(null);
    const [busyId, setBusyId] = useState("");

    const loadDocuments = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const response = await getOwnerDocuments();
            const items = Array.isArray(response?.items) ? response.items : [];
            setDocs(items);
        } catch (err) {
            setDocs([]);
            setError(err?.message || "Unable to load owner documents.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDocuments();
    }, [loadDocuments]);

    const categories = useMemo(() => {
        const set = new Set(docs.map((item) => normalizeText(item.category, "Other")));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [docs]);

    const properties = useMemo(() => {
        const set = new Set(docs.map((item) => normalizeText(item.property)).filter((value) => value !== "-"));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [docs]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return docs.filter((doc) => {
            const matchesCategory = categoryFilter === "all" || normalizeText(doc.category) === categoryFilter;
            const matchesProperty = propertyFilter === "all" || normalizeText(doc.property) === propertyFilter;

            if (!matchesCategory || !matchesProperty) return false;
            if (!q) return true;

            const haystack = [
                doc.name,
                doc.category,
                doc.property,
                doc.tenant,
                ...(Array.isArray(doc.tags) ? doc.tags : []),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return haystack.includes(q);
        });
    }, [docs, search, categoryFilter, propertyFilter]);

    const categoryCounts = useMemo(() => {
        const map = {};
        for (const doc of docs) {
            const category = normalizeText(doc.category, "Other");
            map[category] = (map[category] || 0) + 1;
        }
        return map;
    }, [docs]);

    const totalSizeMb = useMemo(() => {
        return docs.reduce((sum, doc) => sum + parseSizeMb(doc.size), 0);
    }, [docs]);

    const toggleShare = async (document) => {
        if (!document?.id) return;
        const nextShared = !document.sharedWithTenant;
        setBusyId(String(document.id));
        setError("");

        try {
            const response = await updateOwnerDocument(document.id, { sharedWithTenant: nextShared });
            const updated = response?.document;
            setDocs((prev) => prev.map((item) => {
                if (String(item.id) !== String(document.id)) return item;
                return updated ? { ...item, ...updated } : { ...item, sharedWithTenant: nextShared };
            }));
            setSelected((prev) => {
                if (!prev || String(prev.id) !== String(document.id)) return prev;
                return updated ? { ...prev, ...updated } : { ...prev, sharedWithTenant: nextShared };
            });
        } catch (err) {
            setError(err?.message || "Unable to update document.");
        } finally {
            setBusyId("");
        }
    };

    const renderDocRow = (doc) => {
        const category = normalizeText(doc.category, "Other");
        const meta = CATEGORY_META[category] || CATEGORY_META.Other;
        return (
            <div key={doc.id} className="doc-row" onClick={() => setSelected(doc)} style={{ cursor: "pointer" }}>
                <div
                    style={{
                        width: 38,
                        height: 38,
                        borderRadius: 6,
                        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 18,
                        flexShrink: 0,
                    }}
                >
                    {meta.icon}
                </div>
                <div className="doc-info" style={{ flex: 1 }}>
                    <div className="doc-name">{normalizeText(doc.name, "Document")}</div>
                    <div className="doc-meta">
                        {category} · {normalizeText(doc.property)}
                        {doc.tenant ? ` · ${doc.tenant}` : ""} · {normalizeText(doc.size)} · {fmtDate(doc.date)}
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    {doc.sharedWithTenant && <span className="badge badge-green" style={{ fontSize: 10.5 }}>Shared</span>}
                    {doc.verified && <span style={{ fontSize: 12, color: "var(--green)" }}>OK</span>}
                    <button className="btn-secondary" style={{ padding: "5px 10px", fontSize: 11.5 }} onClick={(event) => event.stopPropagation()}>
                        Download
                    </button>
                </div>
            </div>
        );
    };

    const renderDocGrid = (doc) => {
        const category = normalizeText(doc.category, "Other");
        const meta = CATEGORY_META[category] || CATEGORY_META.Other;
        return (
            <div
                key={doc.id}
                onClick={() => setSelected(doc)}
                style={{
                    background: "var(--white)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "16px",
                    cursor: "pointer",
                    boxShadow: "var(--shadow-sm)",
                    transition: "all 0.15s",
                }}
                onMouseEnter={(event) => {
                    event.currentTarget.style.boxShadow = "var(--shadow)";
                }}
                onMouseLeave={(event) => {
                    event.currentTarget.style.boxShadow = "var(--shadow-sm)";
                }}
            >
                <div
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 22,
                        marginBottom: 12,
                    }}
                >
                    {meta.icon}
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)", marginBottom: 4, lineHeight: 1.4 }}>
                    {normalizeText(doc.name, "Document")}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginBottom: 8 }}>
                    {normalizeText(doc.size)} · {fmtDate(doc.date)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span
                        style={{
                            fontSize: 11,
                            color: meta.color,
                            background: `color-mix(in srgb, ${meta.color} 10%, transparent)`,
                            padding: "2px 7px",
                            borderRadius: 20,
                        }}
                    >
                        {category}
                    </span>
                    {doc.sharedWithTenant && <span className="badge badge-green" style={{ fontSize: 10 }}>Shared</span>}
                </div>
            </div>
        );
    };

    return (
        <div className="dash-root">
            <main className="dash-main">
                <header className="dash-header">
                    <div className="header-title-group">
                        <div className="header-title">Documents</div>
                        <div className="header-subtitle">{docs.length} files · {totalSizeMb.toFixed(1)} MB used</div>
                    </div>
                    <div className="header-search">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            placeholder="Search by name, tag, property, tenant..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </div>
                    <div className="header-actions">
                        <button className="btn-secondary" onClick={loadDocuments}>Refresh</button>
                        <button className="btn-primary btn-gold" disabled>
                            Upload Coming Soon
                        </button>
                    </div>
                </header>

                <div className="dash-content">
                    {loading && <div className="card"><div className="card-body">Loading documents...</div></div>}
                    {error && <div className="card"><div className="card-body" style={{ color: "var(--amber)" }}>{error}</div></div>}

                    {!loading && (
                        <>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12, marginBottom: 24 }}>
                                {categories.map((category) => {
                                    const meta = CATEGORY_META[category] || CATEGORY_META.Other;
                                    const count = categoryCounts[category] || 0;
                                    const active = categoryFilter === category;
                                    return (
                                        <button
                                            key={category}
                                            onClick={() => setCategoryFilter(active ? "all" : category)}
                                            style={{
                                                padding: "14px 16px",
                                                background: active ? `color-mix(in srgb, ${meta.color} 10%, transparent)` : "var(--white)",
                                                border: `1.5px solid ${active ? meta.color : "var(--border)"}`,
                                                borderRadius: 8,
                                                cursor: "pointer",
                                                textAlign: "left",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                                boxShadow: "var(--shadow-sm)",
                                            }}
                                        >
                                            <span style={{ fontSize: 20 }}>{meta.icon}</span>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)" }}>{category}</div>
                                                <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 2 }}>
                                                    {count} file{count !== 1 ? "s" : ""}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center", flexWrap: "wrap" }}>
                                <select className="f-ctrl" style={{ width: "auto", minWidth: 180 }} value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value)}>
                                    <option value="all">All Properties</option>
                                    {properties.map((propertyName) => (
                                        <option key={propertyName} value={propertyName}>{propertyName}</option>
                                    ))}
                                </select>
                                {categoryFilter !== "all" && (
                                    <span className="badge badge-navy" style={{ cursor: "pointer" }} onClick={() => setCategoryFilter("all")}>
                                        x {categoryFilter}
                                    </span>
                                )}
                                <div style={{ flex: 1 }} />
                                <span style={{ fontSize: 12.5, color: "var(--text-lite)" }}>{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
                                <div className="view-toggle">
                                    <button className={`view-btn${viewMode === "list" ? " view-btn-on" : ""}`} onClick={() => setViewMode("list")}>List</button>
                                    <button className={`view-btn${viewMode === "grid" ? " view-btn-on" : ""}`} onClick={() => setViewMode("grid")}>Grid</button>
                                </div>
                            </div>

                            {filtered.length === 0 ? (
                                <div className="empty-state" style={{ marginTop: 40 }}>
                                    <div style={{ fontFamily: "var(--serif)", fontSize: 17, color: "var(--navy)", marginTop: 8 }}>No documents found</div>
                                    <p>Try a different search or category filter.</p>
                                </div>
                            ) : viewMode === "list" ? (
                                <div className="doc-list">{filtered.map((doc) => renderDocRow(doc))}</div>
                            ) : (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14 }}>
                                    {filtered.map((doc) => renderDocGrid(doc))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>

            {selected && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(12,27,46,0.5)",
                        zIndex: 200,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 24,
                    }}
                    onClick={() => setSelected(null)}
                >
                    <div
                        style={{ background: "var(--white)", borderRadius: 10, maxWidth: 520, width: "100%", boxShadow: "var(--shadow-md)" }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, color: "var(--navy)" }}>Document Details</div>
                            <button onClick={() => setSelected(null)} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "var(--text-mid)" }}>
                                x
                            </button>
                        </div>
                        <div style={{ padding: 24 }}>
                            <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 20, padding: "14px 16px", background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
                                <span style={{ fontSize: 32 }}>{CATEGORY_META[normalizeText(selected.category, "Other")]?.icon || "📄"}</span>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14.5, color: "var(--navy)", lineHeight: 1.3 }}>{normalizeText(selected.name, "Document")}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 3 }}>{normalizeText(selected.size)} · Added {fmtDate(selected.date)}</div>
                                </div>
                            </div>
                            <div className="info-grid" style={{ marginBottom: 16 }}>
                                {[
                                    ["Category", normalizeText(selected.category, "Other")],
                                    ["Property", normalizeText(selected.property)],
                                    ["Tenant", normalizeText(selected.tenant, "All")],
                                    ["Verified", selected.verified ? "Verified" : "Pending"],
                                    ["Shared with Tenant", selected.sharedWithTenant ? "Yes" : "No"],
                                ].map(([label, value]) => (
                                    <div key={label} className="info-item">
                                        <span className="info-key">{label}</span>
                                        <span className="info-val-strong">{value}</span>
                                    </div>
                                ))}
                            </div>
                            {Array.isArray(selected.tags) && selected.tags.length > 0 && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                                    {selected.tags.map((tag) => <span key={tag} className="chip-small">{tag}</span>)}
                                </div>
                            )}
                            <div style={{ display: "flex", gap: 8 }}>
                                <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }}>Download</button>
                                <button
                                    className="btn-secondary"
                                    style={{ flex: 1 }}
                                    disabled={busyId === String(selected.id)}
                                    onClick={() => toggleShare(selected)}
                                >
                                    {busyId === String(selected.id)
                                        ? "Saving..."
                                        : selected.sharedWithTenant ? "Unshare" : "Share"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
