import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { browseProperties } from "../services/apiClient";
import "./Dashboard.css";
import "./TenantPages.css";

const fmt = (value) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return "0";
    return new Intl.NumberFormat("en-IN").format(amount);
};

const normalizeText = (value, fallback = "-") => {
    if (value == null) return fallback;
    const text = String(value).trim();
    return text || fallback;
};

const FURNISHED_COLORS = {
    Fully: "var(--green)",
    Semi: "var(--amber)",
    Unfurnished: "var(--text-lite)",
};

function PropertyCard({ item, index, onView }) {
    const [saved, setSaved] = useState(false);
    const rent = Number(item.rent || 0);
    const deposit = Number(item.deposit || 0);

    return (
        <div className="tp-card" style={{ animationDelay: `${index * 50}ms` }}>
            <div style={{ height: 140, background: "linear-gradient(135deg,var(--navy) 0%,var(--navy-lite) 100%)", position: "relative", overflow: "hidden", flexShrink: 0 }}>
                <svg style={{ position: "absolute", inset: 0, opacity: 0.07, width: "100%", height: "100%" }}>
                    <defs>
                        <pattern id={`g-${item.id}`} width="18" height="18" patternUnits="userSpaceOnUse">
                            <path d="M 18 0 L 0 0 0 18" fill="none" stroke="#B8943F" strokeWidth="0.5" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#g-${item.id})`} />
                </svg>
                <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            setSaved((prev) => !prev);
                        }}
                        style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}
                    >
                        {saved ? "❤" : "♡"}
                    </button>
                </div>
                <div style={{ position: "absolute", bottom: 10, left: 14 }}>
                    <span className="badge badge-green" style={{ fontSize: 10.5 }}><span className="badge-dot" />Available</span>
                </div>
                <div style={{ position: "absolute", top: 10, left: 14 }}>
                    <span style={{ fontSize: 10, fontFamily: "var(--mono)", background: "rgba(184,148,63,0.25)", border: "1px solid rgba(184,148,63,0.4)", color: "rgba(255,255,255,0.85)", padding: "2px 8px", borderRadius: 3 }}>
                        {normalizeText(item.bhk, "-")}
                    </span>
                </div>
            </div>
            <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                    <div style={{ fontFamily: "var(--serif)", fontSize: 15, fontWeight: 600, color: "var(--navy)", marginBottom: 3 }}>{normalizeText(item.title, "Property")}</div>
                    <div style={{ fontSize: 12, color: "var(--text-lite)" }}>{normalizeText(item.address)}{item.city ? `, ${item.city}` : ""}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", padding: "8px 10px", background: "var(--surface)", borderRadius: 4 }}>
                    {[
                        ["Size", item.sizeCarpet ? `${item.sizeCarpet} sq.ft` : item.sizeBuiltup ? `${item.sizeBuiltup} sq.ft` : "-"],
                        ["Floor", item.floorNumber != null && item.totalFloors != null ? `${item.floorNumber} / ${item.totalFloors}` : "-"],
                        ["Furnishing", normalizeText(item.furnishing, "Unfurnished")],
                        ["Parking", normalizeText(item.parking, "-")],
                    ].map(([key, value]) => (
                        <div key={key}>
                            <div style={{ fontSize: 9, fontFamily: "var(--mono)", color: "var(--text-lite)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{key}</div>
                            <div style={{ fontSize: 12.5, fontWeight: 500, color: key === "Furnishing" ? (FURNISHED_COLORS[value] || "var(--text-mid)") : "var(--text)", marginTop: 1 }}>{value}</div>
                        </div>
                    ))}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {(Array.isArray(item.amenities) ? item.amenities : []).slice(0, 4).map((amenity) => (
                        <span key={amenity} className="chip-small" style={{ fontSize: 11 }}>{amenity}</span>
                    ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <div>
                        <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 700, color: "var(--navy)" }}>
                            INR {fmt(rent)}<span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--text-lite)", fontWeight: 400 }}>/mo</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-lite)" }}>Dep: INR {fmt(deposit)}</div>
                    </div>
                    <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600 }} onClick={() => onView(item.id)}>View</button>
                </div>
            </div>
        </div>
    );
}

export default function TenantSearch() {
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [items, setItems] = useState([]);

    const [search, setSearch] = useState("");
    const [city, setCity] = useState("all");
    const [bhk, setBhk] = useState("all");
    const [type, setType] = useState("all");
    const [furnishing, setFurnishing] = useState("all");
    const [maxRent, setMaxRent] = useState("");
    const [sortBy, setSortBy] = useState("relevance");
    const [viewMode, setViewMode] = useState("grid");
    const [showFilters, setShowFilters] = useState(false);

    const loadProperties = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            const response = await browseProperties({
                availableOnly: true,
                city: city === "all" ? undefined : city,
                bhk: bhk === "all" ? undefined : bhk,
                propertyType: type === "all" ? undefined : type,
                maxRent: maxRent ? Number(maxRent) : undefined,
                limit: 120,
            });
            const data = Array.isArray(response?.items) ? response.items : [];
            setItems(data);
        } catch (err) {
            setItems([]);
            setError(err?.message || "Unable to load properties.");
        } finally {
            setLoading(false);
        }
    }, [city, bhk, type, maxRent]);

    useEffect(() => {
        loadProperties();
    }, [loadProperties]);

    const cities = useMemo(() => {
        const set = new Set(items.map((item) => normalizeText(item.city)).filter((value) => value !== "-"));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [items]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = items.filter((item) => {
            const matchesFurnishing = furnishing === "all" || normalizeText(item.furnishing, "Unfurnished") === furnishing;
            if (!matchesFurnishing) return false;
            if (!q) return true;
            const blob = [item.title, item.address, item.city, item.state, item.propertyType, item.bhk]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return blob.includes(q);
        });

        list = [...list].sort((a, b) => {
            const rentA = Number(a.rent || 0);
            const rentB = Number(b.rent || 0);
            const sizeA = Number(a.sizeCarpet || a.sizeBuiltup || 0);
            const sizeB = Number(b.sizeCarpet || b.sizeBuiltup || 0);
            if (sortBy === "rent_asc") return rentA - rentB;
            if (sortBy === "rent_desc") return rentB - rentA;
            if (sortBy === "size") return sizeB - sizeA;
            return (Number(b.updatedAt ? new Date(b.updatedAt).getTime() : 0) - Number(a.updatedAt ? new Date(a.updatedAt).getTime() : 0));
        });

        return list;
    }, [items, search, furnishing, sortBy]);

    return (
        <div style={{ minHeight: "100vh", background: "var(--cream)", fontFamily: "var(--sans)" }}>
            <div style={{ background: "var(--navy)", color: "#fff" }}>
                <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 28px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600 }}>REMS</span>
                        </div>
                        <div style={{ flex: 1 }} />
                        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => navigate("/tenant/dashboard")}>Back to Dashboard</button>
                    </div>
                    <div style={{ padding: "28px 0 0" }}>
                        <h1 style={{ fontFamily: "var(--serif)", fontSize: "clamp(24px,3vw,36px)", fontWeight: 600, marginBottom: 8 }}>Find Your Next Home</h1>
                        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.58)", marginBottom: 24 }}>Browse live published properties from the backend workflow</p>
                        <div style={{ display: "flex", gap: 8, background: "rgba(255,255,255,0.08)", borderRadius: "var(--radius-md)", padding: 8, marginBottom: 0 }}>
                            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--white)", borderRadius: "var(--radius)", padding: "10px 14px" }}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-lite)" strokeWidth="1.6" width="16" height="16">
                                    <circle cx="11" cy="11" r="8" />
                                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                <input style={{ border: "none", outline: "none", fontFamily: "var(--sans)", fontSize: 14, color: "var(--text)", width: "100%", background: "transparent" }} placeholder="Search by area, locality, building name..." value={search} onChange={(event) => setSearch(event.target.value)} />
                            </div>
                            <select style={{ padding: "10px 14px", background: "var(--white)", border: "none", borderRadius: "var(--radius)", fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)", cursor: "pointer" }} value={city} onChange={(event) => setCity(event.target.value)}>
                                <option value="all">All Cities</option>
                                {cities.map((cityOption) => <option key={cityOption} value={cityOption}>{cityOption}</option>)}
                            </select>
                            <button style={{ padding: "10px 24px", background: "var(--gold)", border: "none", borderRadius: "var(--radius)", fontFamily: "var(--sans)", fontSize: 14, fontWeight: 600, color: "var(--navy)", cursor: "pointer" }} onClick={loadProperties}>Search</button>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, paddingTop: 16, overflowX: "auto", paddingBottom: 1 }}>
                        {["Studio", "1 BHK", "2 BHK", "3 BHK", "4 BHK"].map((label) => (
                            <button
                                key={label}
                                onClick={() => setBhk((prev) => (prev === label ? "all" : label))}
                                style={{
                                    padding: "7px 16px",
                                    background: bhk === label ? "var(--gold)" : "rgba(255,255,255,0.1)",
                                    border: "none",
                                    borderRadius: 20,
                                    fontFamily: "var(--sans)",
                                    fontSize: 13,
                                    color: bhk === label ? "var(--navy)" : "rgba(255,255,255,0.7)",
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                    fontWeight: bhk === label ? 600 : 400,
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 28px" }}>
                {error && <div className="card" style={{ marginBottom: 16 }}><div className="card-body" style={{ color: "var(--amber)" }}>{error}</div></div>}

                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13.5, color: "var(--text-mid)", fontWeight: 500 }}>{filtered.length} properties found</span>
                    <button className="btn-secondary" style={{ fontSize: 12, gap: 6 }} onClick={() => setShowFilters((prev) => !prev)}>
                        Filters
                    </button>
                    <div style={{ flex: 1 }} />
                    <select className="f-ctrl" style={{ width: "auto", minWidth: 180 }} value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                        <option value="relevance">Sort: Relevance</option>
                        <option value="rent_asc">Rent: Low to High</option>
                        <option value="rent_desc">Rent: High to Low</option>
                        <option value="size">Largest First</option>
                    </select>
                    <div className="view-toggle">
                        <button className={`view-btn${viewMode === "grid" ? " view-btn-on" : ""}`} onClick={() => setViewMode("grid")}>Grid</button>
                        <button className={`view-btn${viewMode === "list" ? " view-btn-on" : ""}`} onClick={() => setViewMode("list")}>List</button>
                    </div>
                </div>

                {showFilters && (
                    <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "20px 24px", marginBottom: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14 }}>
                        <div className="f-grp">
                            <label className="f-lbl">Property Type</label>
                            <select className="f-ctrl" value={type} onChange={(event) => setType(event.target.value)}>
                                <option value="all">Any Type</option>
                                <option value="Apartment">Apartment</option>
                                <option value="Studio">Studio</option>
                                <option value="Independent">Independent</option>
                                <option value="Commercial">Commercial</option>
                            </select>
                        </div>
                        <div className="f-grp">
                            <label className="f-lbl">Furnishing</label>
                            <select className="f-ctrl" value={furnishing} onChange={(event) => setFurnishing(event.target.value)}>
                                <option value="all">Any</option>
                                <option value="Fully">Fully Furnished</option>
                                <option value="Semi">Semi Furnished</option>
                                <option value="Unfurnished">Unfurnished</option>
                            </select>
                        </div>
                        <div className="f-grp">
                            <label className="f-lbl">Max Rent (INR)</label>
                            <input className="f-ctrl" type="number" value={maxRent} onChange={(event) => setMaxRent(event.target.value)} placeholder="e.g. 30000" />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => { setType("all"); setFurnishing("all"); setMaxRent(""); setCity("all"); setBhk("all"); }}>Clear</button>
                            <button className="btn-primary" style={{ fontSize: 12 }} onClick={loadProperties}>Apply</button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="card"><div className="card-body">Loading available properties...</div></div>
                ) : viewMode === "grid" ? (
                    <div className="tp-grid">
                        {filtered.map((item, index) => (
                            <PropertyCard key={item.id} item={item} index={index} onView={(propertyId) => navigate(`/tenant/search/${propertyId}`)} />
                        ))}
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {filtered.map((item, index) => (
                            <div key={item.id} className="card" style={{ display: "flex", gap: 0, overflow: "hidden", cursor: "pointer", animation: `fadeSlideUp 0.35s ease ${index * 40}ms both` }} onClick={() => navigate(`/tenant/search/${item.id}`)}>
                                <div style={{ width: 160, background: "linear-gradient(135deg,var(--navy) 0%,var(--navy-lite) 100%)", flexShrink: 0 }} />
                                <div style={{ flex: 1, padding: "14px 18px" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                        <div>
                                            <div style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 600, color: "var(--navy)", marginBottom: 3 }}>{normalizeText(item.title, "Property")}</div>
                                            <div style={{ fontSize: 12.5, color: "var(--text-lite)" }}>
                                                {normalizeText(item.address)}{item.city ? `, ${item.city}` : ""} · {normalizeText(item.bhk)}
                                            </div>
                                        </div>
                                        <div style={{ textAlign: "right" }}>
                                            <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 700, color: "var(--navy)" }}>
                                                INR {fmt(item.rent)}<span style={{ fontSize: 11, fontFamily: "var(--sans)", color: "var(--text-lite)", fontWeight: 400 }}>/mo</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && filtered.length === 0 && (
                    <div className="empty-state" style={{ marginTop: 60 }}>
                        <div style={{ fontFamily: "var(--serif)", fontSize: 18, color: "var(--navy)", marginTop: 8 }}>No properties match your search</div>
                        <p>Try broadening your search area or adjusting filters.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
