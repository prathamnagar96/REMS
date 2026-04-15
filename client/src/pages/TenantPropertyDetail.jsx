import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getTenantPropertyById } from "../services/apiClient";
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

export default function TenantPropertyDetail() {
    const navigate = useNavigate();
    const { propertyId } = useParams();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [data, setData] = useState(null);
    const [tab, setTab] = useState("Overview");

    useEffect(() => {
        let active = true;
        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const response = await getTenantPropertyById(propertyId);
                if (!active) return;
                setData(response || null);
            } catch (err) {
                if (!active) return;
                setData(null);
                setError(err?.message || "Unable to load property details.");
            } finally {
                if (active) setLoading(false);
            }
        };

        load();
        return () => {
            active = false;
        };
    }, [propertyId]);

    const property = data?.property || {};
    const owner = data?.owner || {};

    const summaryItems = [
        ["Size", property.sizeCarpet ? `${property.sizeCarpet} sq.ft` : property.sizeBuiltup ? `${property.sizeBuiltup} sq.ft` : "-"],
        ["BHK", normalizeText(property.bhk)],
        ["Floor", property.floorNumber != null && property.totalFloors != null ? `${property.floorNumber} / ${property.totalFloors}` : "-"],
        ["Furnished", normalizeText(property.furnishing, "Unfurnished")],
        ["Deposit", `INR ${fmt(property.deposit)}`],
    ];

    return (
        <div style={{ minHeight: "100vh", background: "var(--cream)", fontFamily: "var(--sans)" }}>
            <div style={{ background: "var(--white)", borderBottom: "1px solid var(--border)", padding: "14px 28px", display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 10 }}>
                <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => navigate("/tenant/search")}>Back to Search</button>
                <div style={{ flex: 1 }} />
                <button className="btn-primary btn-gold" style={{ fontWeight: 700 }} onClick={() => navigate(`/tenant/search/${propertyId}/apply`)}>Apply Now</button>
            </div>

            {loading ? (
                <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px" }}>
                    <div className="card"><div className="card-body">Loading property details...</div></div>
                </div>
            ) : error ? (
                <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px" }}>
                    <div className="card"><div className="card-body" style={{ color: "var(--amber)" }}>{error}</div></div>
                </div>
            ) : (
                <>
                    <div style={{ height: 260, background: "linear-gradient(135deg,var(--navy) 0%,var(--navy-lite) 60%,#2a4a7f 100%)", position: "relative", overflow: "hidden" }}>
                        <svg style={{ position: "absolute", inset: 0, opacity: 0.06, width: "100%", height: "100%" }}>
                            <defs>
                                <pattern id="detail-grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M 22 0 L 0 0 0 22" fill="none" stroke="#B8943F" strokeWidth="0.6" /></pattern>
                            </defs>
                            <rect width="100%" height="100%" fill="url(#detail-grid)" />
                        </svg>
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", padding: "24px 32px", background: "linear-gradient(to top, rgba(12,27,46,0.8) 0%, transparent 60%)" }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                                    <span className="badge badge-green"><span className="badge-dot" />Available</span>
                                </div>
                                <h1 style={{ fontFamily: "var(--serif)", fontSize: "clamp(22px,3vw,32px)", fontWeight: 600, color: "#fff", marginBottom: 6 }}>{normalizeText(property.title, "Property")}</h1>
                                <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.65)" }}>{normalizeText(property.address)}{property.city ? `, ${property.city}` : ""}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                                <div style={{ fontFamily: "var(--serif)", fontSize: 30, fontWeight: 700, color: "#fff" }}>INR {fmt(property.rent)}</div>
                                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>per month</div>
                            </div>
                        </div>
                    </div>

                    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 28px 40px" }}>
                        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 8, padding: "16px 20px", margin: "20px 0", display: "flex", gap: 20, alignItems: "center", boxShadow: "var(--shadow)" }}>
                            {summaryItems.map(([key, value]) => (
                                <div key={key} style={{ textAlign: "center", borderRight: "1px solid var(--border)", paddingRight: 20 }}>
                                    <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase" }}>{key}</div>
                                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--navy)", marginTop: 2 }}>{value}</div>
                                </div>
                            ))}
                            <div style={{ flex: 1 }} />
                            <button className="btn-primary btn-gold" style={{ fontWeight: 700, padding: "12px 28px", fontSize: 15 }} onClick={() => navigate(`/tenant/search/${propertyId}/apply`)}>Apply for this Property</button>
                        </div>

                        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
                            {["Overview", "Amenities", "Terms", "Owner"].map((item) => (
                                <button
                                    key={item}
                                    onClick={() => setTab(item)}
                                    style={{
                                        padding: "11px 18px",
                                        background: "none",
                                        border: "none",
                                        borderBottom: `2px solid ${tab === item ? "var(--gold)" : "transparent"}`,
                                        fontFamily: "var(--sans)",
                                        fontSize: 13.5,
                                        fontWeight: tab === item ? 600 : 400,
                                        color: tab === item ? "var(--navy)" : "var(--text-lite)",
                                        cursor: "pointer",
                                    }}
                                >
                                    {item}
                                </button>
                            ))}
                        </div>

                        {tab === "Overview" && (
                            <div className="two-col">
                                <div className="card">
                                    <div className="card-header"><div className="card-title">Property Details</div></div>
                                    <div className="card-body">
                                        <div className="info-grid-3">
                                            {[
                                                ["Type", normalizeText(property.propertyType)],
                                                ["Configuration", normalizeText(property.bhk)],
                                                ["Carpet Area", property.sizeCarpet ? `${property.sizeCarpet} sq.ft` : "-"],
                                                ["Built-up", property.sizeBuiltup ? `${property.sizeBuiltup} sq.ft` : "-"],
                                                ["Floor", property.floorNumber != null && property.totalFloors != null ? `${property.floorNumber}/${property.totalFloors}` : "-"],
                                                ["Facing", normalizeText(property.facing)],
                                                ["Furnishing", normalizeText(property.furnishing, "Unfurnished")],
                                                ["Parking", normalizeText(property.parking)],
                                                ["Available", normalizeText(property.availableFrom, "Immediate")],
                                            ].map(([key, value]) => (
                                                <div key={key} className="info-item"><span className="info-key">{key}</span><span className="info-val-strong">{value}</span></div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="card">
                                    <div className="card-header"><div className="card-title">Pricing</div></div>
                                    <div className="card-body">
                                        {[
                                            ["Monthly Rent", `INR ${fmt(property.rent)}`],
                                            ["Security Deposit", `INR ${fmt(property.deposit)}`],
                                            ["Maintenance", `INR ${fmt(property.maintenanceCharges)} /mo`],
                                            ["Minimum Lease", normalizeText(property.minLease, "11 months")],
                                        ].map(([key, value]) => (
                                            <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                                                <span style={{ fontSize: 13, color: "var(--text-mid)" }}>{key}</span>
                                                <span style={{ fontWeight: 600, color: "var(--navy)", fontSize: 13 }}>{value}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {tab === "Amenities" && (
                            <div className="card">
                                <div className="card-body">
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                                        {(Array.isArray(property.amenities) ? property.amenities : []).map((amenity) => (
                                            <div key={amenity} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "var(--green-bg)", border: "1px solid rgba(45,125,70,0.2)", borderRadius: "var(--radius)", fontSize: 13.5, color: "var(--navy)", fontWeight: 500 }}>
                                                <span style={{ color: "var(--green)" }}>OK</span>{amenity}
                                            </div>
                                        ))}
                                        {(Array.isArray(property.amenities) ? property.amenities : []).length === 0 && (
                                            <div style={{ color: "var(--text-lite)", fontSize: 13 }}>No amenities listed.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {tab === "Terms" && (
                            <div className="card">
                                <div className="card-header"><div className="card-title">Rental Terms</div></div>
                                <div className="card-body">
                                    {[
                                        ["Minimum Lease", normalizeText(property.minLease, "11 months")],
                                        ["House Rules", normalizeText(property.houseRules, "As per owner policy")],
                                    ].map(([key, value]) => (
                                        <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                                            <span style={{ fontSize: 13, color: "var(--text-mid)" }}>{key}</span>
                                            <span style={{ fontWeight: 600, color: "var(--navy)", fontSize: 13 }}>{value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {tab === "Owner" && (
                            <div className="card">
                                <div className="card-header"><div className="card-title">Owner</div></div>
                                <div className="card-body">
                                    <div className="info-grid">
                                        <div className="info-item"><span className="info-key">Name</span><span className="info-val-strong">{normalizeText(owner.name, "Owner")}</span></div>
                                        <div className="info-item"><span className="info-key">Email</span><span className="info-val-strong">{normalizeText(owner.email)}</span></div>
                                        <div className="info-item"><span className="info-key">Phone</span><span className="info-val-strong">{normalizeText(owner.phone)}</span></div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
