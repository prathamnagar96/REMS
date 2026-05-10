import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as THREE from "three";
import { getOwnerProperties } from "../services/apiClient";
import "./Dashboard.css";
import "./Properties.css";

const STATUS_CONFIG = {
  occupied: { label: "Occupied", cls: "badge-green", dot: "#2D7D46" },
  vacant: { label: "Vacant", cls: "badge-amber", dot: "#C47B1A" },
  notice: { label: "Notice Given", cls: "badge-red", dot: "#B83232" },
  inactive: { label: "Inactive", cls: "badge-grey", dot: "#9E9B97" },
};

const PRETTY_TYPE = {
  apartment: "Apartment",
  independent: "Independent House",
  pg: "PG / Hostel",
  commercial: "Commercial",
  studio: "Studio",
};

const PRETTY_FURNISHING = {
  fully: "Fully",
  semi: "Semi",
  unfurnished: "Unfurnished",
};

const PRETTY_PARKING = {
  none: "None",
  two_wheeler: "2-Wheeler",
  four_wheeler: "4-Wheeler",
  both: "Both",
  covered: "Covered",
};

const normalizeString = (value, fallback = "") => {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const toDisplayType = (value) => {
  const key = normalizeString(value).toLowerCase();
  if (PRETTY_TYPE[key]) return PRETTY_TYPE[key];
  return normalizeString(value, "Apartment");
};

const toDisplayFurnishing = (value) => {
  const key = normalizeString(value).toLowerCase();
  if (PRETTY_FURNISHING[key]) return PRETTY_FURNISHING[key];
  return normalizeString(value, "Semi");
};

const toDisplayParking = (value) => {
  const key = normalizeString(value).toLowerCase();
  if (PRETTY_PARKING[key]) return PRETTY_PARKING[key];
  return normalizeString(value, "None");
};

const toListProperty = (item) => {
  const status = normalizeString(item?.status, "vacant").toLowerCase();
  const normalizedStatus = STATUS_CONFIG[status] ? status : "vacant";
  const size = Number(item?.sizeCarpet || item?.sizeBuiltup || 0);
  const rent = Number(item?.rent || 0);
  const deposit = Number(item?.deposit || 0);
  const floorNumber = Number(item?.floorNumber || 0);
  const totalFloors = Number(item?.totalFloors || 1);
  const id = item?.id;

  return {
    id: id != null ? String(id) : "",
    name: normalizeString(item?.title, "Untitled Property"),
    address: normalizeString(item?.address, "Address not available"),
    city: normalizeString(item?.city, "Unknown City"),
    state: normalizeString(item?.state),
    pincode: normalizeString(item?.pincode),
    type: toDisplayType(item?.propertyType),
    bhk: normalizeString(item?.bhk, "N/A"),
    rent: Number.isFinite(rent) ? rent : 0,
    deposit: Number.isFinite(deposit) ? deposit : 0,
    size: Number.isFinite(size) && size > 0 ? size : 0,
    floor: Number.isFinite(floorNumber) ? floorNumber : 0,
    totalFloors: Number.isFinite(totalFloors) && totalFloors > 0 ? totalFloors : 1,
    furnished: toDisplayFurnishing(item?.furnishing),
    parking: toDisplayParking(item?.parking),
    status: normalizedStatus,
    tenant: null,
    leaseEnd: null,
    createdAt: item?.createdAt,
    amenities: Array.isArray(item?.amenities) ? item.amenities : [],
    rating: 0,
    views: 0,
    inquiries: 0,
  };
};

// ─── Three.js Portfolio Skyline ───────────────────────────────────────────────
function PortfolioSkyline({ properties }) {
  const mountRef = useRef(null);
  const sceneRef = useRef({});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    if (!properties.length) return;
    const W = mount.clientWidth, H = mount.clientHeight;
    if (W === 0 || H === 0) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
    camera.position.set(0, 12, 28);
    camera.lookAt(0, 3, 0);

    // Grid
    const grid = new THREE.GridHelper(60, 24, 0xB8943F, 0x1e2a3a);
    grid.material.opacity = 0.25;
    grid.material.transparent = true;
    scene.add(grid);

    // Build one tower per property
    const group = new THREE.Group();
    const total = properties.length;
    const spacing = Math.min(4.5, 60 / total);

    properties.forEach((p, i) => {
      const rentNorm = (p.rent - 8000) / (80000 - 8000);
      const h = 3 + rentNorm * 22;
      const w = p.type === "Commercial" ? 3.2 : p.type === "Independent House" ? 3.5 : 2;
      const d = w * 0.85;
      const x = (i - total / 2) * spacing + spacing / 2;

      const geo = new THREE.BoxGeometry(w, h, d);

      // Status-based color
      const statusColor = p.status === "occupied" ? 0x1e3a5f : p.status === "vacant" ? 0x2a3a28 : 0x3a2a1a;
      const solidMat = new THREE.MeshBasicMaterial({ color: statusColor });
      const solid = new THREE.Mesh(geo, solidMat);
      solid.position.set(x, h / 2, 0);
      group.add(solid);

      // Wire overlay
      const wireMat = new THREE.MeshBasicMaterial({ color: 0xB8943F, wireframe: true, transparent: true, opacity: p.status === "occupied" ? 0.45 : 0.2 });
      const wire = new THREE.Mesh(geo, wireMat);
      wire.position.copy(solid.position);
      group.add(wire);

      // Rooftop plane for occupied
      if (p.status === "occupied") {
        const roofGeo = new THREE.PlaneGeometry(w, d);
        const roofMat = new THREE.MeshBasicMaterial({ color: 0xB8943F, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.rotation.x = Math.PI / 2;
        roof.position.set(x, h + 0.01, 0);
        group.add(roof);
      }

      // Window lights
      const rows = Math.floor(h / 1.2), cols = Math.floor(w / 0.8);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > 0.45) continue;
          const wGeo = new THREE.PlaneGeometry(0.25, 0.25);
          const wMat = new THREE.MeshBasicMaterial({ color: p.status === "occupied" ? 0xFFF3C4 : 0x334455, transparent: true, opacity: 0.7 });
          const win = new THREE.Mesh(wGeo, wMat);
          win.position.set(x + (c - cols / 2 + 0.5) * (w / cols), 1 + r * 1.2, d / 2 + 0.02);
          group.add(win);
        }
      }
    });

    scene.add(group);

    let frameId;
    const clock = new THREE.Clock();
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      group.rotation.y = Math.sin(t * 0.08) * 0.18;
      renderer.render(scene, camera);
    };
    animate();
    sceneRef.current = { renderer, frameId };

    const onResize = () => {
      const nW = mount.clientWidth, nH = mount.clientHeight;
      if (nW === 0 || nH === 0) return;
      camera.aspect = nW / nH;
      camera.updateProjectionMatrix();
      renderer.setSize(nW, nH);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [properties]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }} />;
}

// ─── Property Thumbnail (SVG-based floor plan abstraction) ────────────────────
function PropertyThumb({ property, size = "md" }) {
  const h = size === "sm" ? 80 : 120;
  const cols = property.bhk === "Studio" ? 4 : property.bhk === "1 BHK" ? 5 : property.bhk === "2 BHK" ? 6 : property.bhk === "3 BHK" ? 7 : 8;
  const rows = Math.floor(cols * 0.65);

  const statusGradient = {
    occupied: ["#0C1B2E", "#1e3a5f"],
    vacant: ["#1a2a0e", "#2a4a1a"],
    notice: ["#2e1414", "#4a1e1e"],
  }[property.status] || ["#1a1a1a", "#2a2a2a"];

  return (
    <div style={{ height: h, background: `linear-gradient(135deg, ${statusGradient[0]} 0%, ${statusGradient[1]} 100%)`, position: "relative", overflow: "hidden", flexShrink: 0 }}>
      {/* Grid pattern */}
      <svg style={{ position: "absolute", inset: 0, opacity: 0.12 }} width="100%" height="100%">
        <defs>
          <pattern id={`grid-${property.id}`} width="16" height="16" patternUnits="userSpaceOnUse">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="#B8943F" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#grid-${property.id})`} />
      </svg>
      {/* Floor plan dots */}
      <svg style={{ position: "absolute", inset: 0, opacity: 0.25 }} viewBox={`0 0 ${cols * 10} ${rows * 10}`} width="100%" height="100%">
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => (
            <rect key={`${r}-${c}`} x={c * 10 + 2} y={r * 10 + 2} width="6" height="6" fill="none" stroke="#B8943F" strokeWidth="0.8" />
          ))
        )}
      </svg>
      {/* Building icon */}
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 48 48" fill="none" width={size === "sm" ? 28 : 36} height={size === "sm" ? 28 : 36} style={{ opacity: 0.18 }}>
          {property.type === "Independent House"
            ? <><path d="M6 20L24 6l18 14v22H6z" stroke="#B8943F" strokeWidth="1.5" fill="none" /><rect x="18" y="32" width="12" height="10" stroke="#B8943F" strokeWidth="1.5" fill="none" /></>
            : property.type === "Commercial"
              ? <><rect x="6" y="8" width="36" height="32" stroke="#B8943F" strokeWidth="1.5" fill="none" /><line x1="6" y1="18" x2="42" y2="18" stroke="#B8943F" strokeWidth="1" /><line x1="6" y1="28" x2="42" y2="28" stroke="#B8943F" strokeWidth="1" /><line x1="18" y1="8" x2="18" y2="40" stroke="#B8943F" strokeWidth="1" /><line x1="30" y1="8" x2="30" y2="40" stroke="#B8943F" strokeWidth="1" /></>
              : <><rect x="10" y="10" width="28" height="30" stroke="#B8943F" strokeWidth="1.5" fill="none" /><line x1="10" y1="20" x2="38" y2="20" stroke="#B8943F" strokeWidth="1" /><line x1="10" y1="30" x2="38" y2="30" stroke="#B8943F" strokeWidth="1" /><line x1="22" y1="10" x2="22" y2="40" stroke="#B8943F" strokeWidth="1" /></>
          }
        </svg>
      </div>
      {/* Status indicator stripe */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: STATUS_CONFIG[property.status]?.dot || "#9E9B97" }} />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat("en-IN").format(n);
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const daysUntil = d => Math.ceil((new Date(d) - new Date()) / 86400000);

// ─── Action Menu ──────────────────────────────────────────────────────────────
function ActionMenu({ property, onNavigate }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn-secondary" style={{ padding: "6px 10px", fontSize: 13 }} onClick={() => setOpen(o => !o)}>⋯</button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "var(--white)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "var(--shadow-md)", zIndex: 50, minWidth: 180, overflow: "hidden" }}>
          {[
            ["👁 View Details", () => onNavigate("detail", property.id)],
            ["✏️ Edit Property", () => onNavigate("edit", property.id)],
            ["📋 View Tenant", () => { }],
            ["🔧 Maintenance Log", () => { }],
            ["📊 Analytics", () => { }],
            ["📄 Generate Report", () => { }],
            ["🚫 Mark Inactive", () => { }],
          ].map(([label, action]) => (
            <button key={label} onClick={() => { action(); setOpen(false); }}
              style={{ display: "block", width: "100%", padding: "10px 16px", textAlign: "left", background: "none", border: "none", fontFamily: "var(--sans)", fontSize: 13, color: "var(--text)", cursor: "pointer", borderBottom: "1px solid var(--border)", transition: "background 0.13s" }}
              onMouseEnter={e => e.target.style.background = "var(--surface)"}
              onMouseLeave={e => e.target.style.background = "none"}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Grid Card ────────────────────────────────────────────────────────────────
function GridCard({ property, onNavigate, animDelay }) {
  const { label, cls } = STATUS_CONFIG[property.status] || {};
  const leaseProgress = property.leaseEnd
    ? Math.min(100, Math.max(0, Math.round((new Date() - new Date(property.leaseEnd.replace(/\d{4}/, y => y - 1))) / (new Date(property.leaseEnd) - new Date(property.leaseEnd.replace(/\d{4}/, y => y - 1))) * 100)))
    : 0;

  return (
    <div className="prop-grid-card" style={{ animationDelay: `${animDelay}ms` }}>
      <PropertyThumb property={property} size="md" />
      <div style={{ padding: "14px 16px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: 14.5, fontWeight: 600, color: "var(--navy)", lineHeight: 1.3, marginBottom: 3 }}>{property.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-lite)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{property.address}, {property.city}</div>
          </div>
          <span className={`badge ${cls}`} style={{ flexShrink: 0 }}><span className="badge-dot" />{label}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px", margin: "12px 0", padding: "10px 12px", background: "var(--surface)", borderRadius: 4 }}>
          {[["Type", property.bhk], ["Size", `${property.size} sq.ft`], ["Floor", `${property.floor}/${property.totalFloors}`], ["Furnished", property.furnished]].map(([k, v]) => (
            <div key={k}><div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)", marginTop: 2 }}>{v}</div></div>
          ))}
        </div>

        {property.status === "occupied" && property.leaseEnd && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-lite)", marginBottom: 4 }}>
              <span>{property.tenant}</span><span>{daysUntil(property.leaseEnd)}d left</span>
            </div>
            <div className="progress-bar"><div className="progress-fill progress-fill-gold" style={{ width: `${leaseProgress}%` }} /></div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 700, color: "var(--navy)" }}>₹{fmt(property.rent)}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-lite)" }}>per month</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => onNavigate("edit", property.id)}>Edit</button>
            <ActionMenu property={property} onNavigate={onNavigate} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          {[["👁", property.views, "views"], ["💬", property.inquiries, "inquiries"], ["⭐", property.rating, "rating"]].map(([ic, val, lbl]) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-lite)" }}>
              <span>{ic}</span><span style={{ fontWeight: 600, color: "var(--text-mid)" }}>{val}</span><span>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────
function TableRow({ property, onNavigate, index }) {
  const { label, cls } = STATUS_CONFIG[property.status] || {};
  return (
    <tr className="prop-table-row" style={{ animationDelay: `${index * 40}ms` }}>
      <td style={{ width: 56, padding: "10px 8px 10px 16px" }}>
        <div style={{ width: 40, height: 40, borderRadius: 4, overflow: "hidden", flexShrink: 0 }}>
          <PropertyThumb property={property} size="sm" />
        </div>
      </td>
      <td style={{ maxWidth: 220 }}>
        <div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{property.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 2 }}>{property.address}, {property.city}</div>
      </td>
      <td><span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--text-mid)", background: "var(--surface)", padding: "3px 8px", borderRadius: 3 }}>{property.bhk}</span></td>
      <td><div style={{ fontSize: 13 }}>{property.type}</div></td>
      <td><span className={`badge ${cls}`}><span className="badge-dot" />{label}</span></td>
      <td>
        <div style={{ fontFamily: "var(--serif)", fontSize: 15, fontWeight: 600, color: "var(--navy)" }}>₹{fmt(property.rent)}</div>
        <div style={{ fontSize: 11, color: "var(--text-lite)" }}>{property.size} sq.ft</div>
      </td>
      <td>
        {property.tenant
          ? <><div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{property.tenant}</div><div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 2 }}>{property.leaseEnd ? `until ${fmtDate(property.leaseEnd)}` : ""}</div></>
          : <span style={{ fontSize: 12, color: "var(--text-lite)", fontStyle: "italic" }}>No tenant</span>}
      </td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--text-mid)" }}>
          <span>👁 {property.views}</span>
          <span style={{ color: "var(--border)" }}>·</span>
          <span>💬 {property.inquiries}</span>
        </div>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", paddingRight: 8 }}>
          <button className="btn-secondary" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => onNavigate("edit", property.id)}>Edit</button>
          <ActionMenu property={property} onNavigate={onNavigate} />
        </div>
      </td>
    </tr>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PropertiesList({ onNavigate }) {
  const routerNavigate = useNavigate();
  const location = useLocation();
  const navigateAction = onNavigate || ((action, id) => {
    if (action === "new") {
      routerNavigate("/owner/properties/new");
      return;
    }
    if (action === "detail" && id) {
      routerNavigate(`/owner/properties/${id}`);
      return;
    }
    if (action === "edit" && id) {
      routerNavigate(`/owner/properties/${id}/edit`);
      return;
    }
    if (action === "list") {
      routerNavigate("/owner/properties");
    }
  });

  // Filter state
  const [properties, setProperties] = useState([]);
  const [loadingProperties, setLoadingProperties] = useState(true);
  const [propertiesError, setPropertiesError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatus] = useState("all");
  const [typeFilter, setType] = useState("all");
  const [bhkFilter, setBhk] = useState("all");
  const [cityFilter, setCity] = useState("all");
  const [furnishFilter, setFurnish] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [viewMode, setViewMode] = useState("grid"); // "grid" | "table"
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const PER_PAGE = viewMode === "grid" ? 8 : 10;

  const updateSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const updateStatusFilter = (value) => {
    setStatus(value);
    setPage(1);
  };

  const updateTypeFilter = (value) => {
    setType(value);
    setPage(1);
  };

  const updateBhkFilter = (value) => {
    setBhk(value);
    setPage(1);
  };

  const updateCityFilter = (value) => {
    setCity(value);
    setPage(1);
  };

  const updateFurnishFilter = (value) => {
    setFurnish(value);
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearch("");
    setStatus("all");
    setType("all");
    setBhk("all");
    setCity("all");
    setFurnish("all");
    setPage(1);
  };

  useEffect(() => {
    let active = true;

    const loadProperties = async () => {
      setLoadingProperties(true);
      setPropertiesError("");
      try {
        const response = await getOwnerProperties();
        const items = Array.isArray(response?.items) ? response.items : [];
        const mapped = items.map(toListProperty);
        if (!active) return;
        setProperties(mapped);
      } catch (error) {
        if (!active) return;
        setProperties([]);
        setPropertiesError(error?.message || "Unable to load live properties.");
      } finally {
        if (active) setLoadingProperties(false);
      }
    };

    loadProperties();
    return () => {
      active = false;
    };
  }, []);

  // Derived filter options
  const cities = useMemo(() => [...new Set(properties.map(p => p.city))].sort(), [properties]);
  const types = useMemo(() => [...new Set(properties.map(p => p.type))].sort(), [properties]);
  const bhks = useMemo(() => ["Studio", "1 BHK", "2 BHK", "3 BHK", "4 BHK", "4+ BHK"], []);

  // Filtered + sorted list
  const filtered = useMemo(() => {
    let list = properties.filter(p => {
      const q = search.toLowerCase();
      const matchQ = !q || p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q) || p.city.toLowerCase().includes(q) || (p.tenant || "").toLowerCase().includes(q);
      const matchS = statusFilter === "all" || p.status === statusFilter;
      const matchT = typeFilter === "all" || p.type === typeFilter;
      const matchB = bhkFilter === "all" || p.bhk === bhkFilter;
      const matchC = cityFilter === "all" || p.city === cityFilter;
      const matchF = furnishFilter === "all" || p.furnished === furnishFilter;
      return matchQ && matchS && matchT && matchB && matchC && matchF;
    });

    list = list.sort((a, b) => {
      let va, vb;
      if (sortBy === "rent") { va = a.rent; vb = b.rent; }
      else if (sortBy === "size") { va = a.size; vb = b.size; }
      else if (sortBy === "views") { va = a.views; vb = b.views; }
      else { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [search, statusFilter, typeFilter, bhkFilter, cityFilter, furnishFilter, sortBy, sortDir, properties]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Sort toggle
  const toggleSort = useCallback(field => {
    if (sortBy === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("asc"); }
  }, [sortBy]);

  // Portfolio stats
  const stats = useMemo(() => ({
    total: properties.length,
    occupied: properties.filter(p => p.status === "occupied").length,
    vacant: properties.filter(p => p.status === "vacant").length,
    notice: properties.filter(p => p.status === "notice").length,
    revenue: properties.filter(p => p.status === "occupied").reduce((s, p) => s + p.rent, 0),
    occupancy: properties.length ? Math.round((properties.filter(p => p.status === "occupied").length / properties.length) * 100) : 0,
  }), [properties]);

  const activeFilters = [statusFilter, typeFilter, bhkFilter, cityFilter, furnishFilter].filter(f => f !== "all").length;

  const renderSortHeader = (field, label) => (
    <th onClick={() => toggleSort(field)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        <span style={{ opacity: sortBy === field ? 1 : 0.3, fontSize: 10 }}>{sortBy === field && sortDir === "desc" ? "▼" : "▲"}</span>
      </span>
    </th>
  );

  return (
    <div className="dash-root">
      {/* ── Sidebar (collapsed for this page, just logo + back) ── */}
      <aside className="dash-sidebar" style={{ width: 60 }}>
        <div style={{ padding: "18px 0", display: "flex", justifyContent: "center" }}>
          <svg viewBox="0 0 32 32" fill="none" width="26" height="26"><rect x="2" y="14" width="10" height="16" stroke="#B8943F" strokeWidth="1.5" /><rect x="14" y="8" width="10" height="22" stroke="#B8943F" strokeWidth="1.5" /><rect x="26" y="18" width="4" height="12" stroke="#B8943F" strokeWidth="1.5" /><line x1="2" y1="14" x2="30" y2="14" stroke="#B8943F" strokeWidth="1" /></svg>
        </div>
        {[
          ["M3 9l9-7 9 7v11H5z", "/owner/dashboard"],
          ["M3 9l9-7 9 7v11H5z M9 22V12h6v10", "/owner/properties"],
          ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8", "/owner/leases"],
          ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6", "/owner/maintenance"],
        ].map(([d, path]) => (
          <div
            key={path}
            className={`nav-item ${location.pathname.startsWith(path) ? "active" : ""}`}
            style={{ justifyContent: "center", padding: "12px", cursor: "pointer" }}
            onClick={() => routerNavigate(path)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><path d={d} /></svg>
          </div>
        ))}
      </aside>

      <main className="dash-main">
        {/* ── Header ── */}
        <header className="dash-header">
          <div className="header-title-group">
            <div className="header-title">Properties</div>
            <div className="header-subtitle">{filtered.length} of {properties.length} properties · {stats.occupancy}% occupancy</div>
            {loadingProperties && <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 2 }}>Loading your live properties...</div>}
            {propertiesError && <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 2 }}>{propertiesError}</div>}
          </div>
          <div className="header-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input placeholder="Search by name, address, city, tenant..." value={search} onChange={e => updateSearch(e.target.value)} />
          </div>
          <div className="header-actions">
            <button className="btn-secondary" style={{ gap: 6 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Export
            </button>
            <button className="btn-primary btn-gold" onClick={() => navigateAction("new")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Property
            </button>
          </div>
        </header>

        <div className="dash-content" style={{ padding: "0", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* ── Portfolio Hero Banner with Three.js ── */}
          <div className="portfolio-banner">
            <PortfolioSkyline properties={properties} />
            <div className="portfolio-banner-overlay" />
            <div className="portfolio-banner-content">
              <div className="portfolio-stats-row">
                {[
                  ["Total Portfolio", stats.total, "properties"],
                  ["Occupied", stats.occupied, `${stats.occupancy}% rate`],
                  ["Vacant", stats.vacant, "available now"],
                  ["Notice Period", stats.notice, "expiring soon"],
                  ["Monthly Revenue", `₹${fmt(stats.revenue)}`, "from occupied"],
                ].map(([label, val, sub]) => (
                  <div key={label} className="portfolio-stat">
                    <div className="portfolio-stat-val">{val}</div>
                    <div className="portfolio-stat-label">{label}</div>
                    <div className="portfolio-stat-sub">{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Filters + Controls ── */}
          <div className="filter-bar">
            {/* Status quick filters */}
            <div className="filter-chips-row">
              {[["all", "All"], ["occupied", "Occupied"], ["vacant", "Vacant"], ["notice", "Notice"]].map(([v, l]) => (
                <button key={v} className={`filter-chip ${statusFilter === v ? "active" : ""}`} onClick={() => updateStatusFilter(v)}>{l}</button>
              ))}
            </div>

            <div style={{ flex: 1 }} />

            {/* Advanced filters toggle */}
            <button className={`btn-secondary ${showFilters ? "btn-secondary-active" : ""}`} style={{ gap: 6, position: "relative" }} onClick={() => setShowFilters(f => !f)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
              Filters
              {activeFilters > 0 && <span style={{ background: "var(--navy)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 10, marginLeft: 2 }}>{activeFilters}</span>}
            </button>

            {/* Sort */}
            <select className="f-ctrl" style={{ width: "auto", minWidth: 140 }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="name">Sort: Name</option>
              <option value="rent">Sort: Rent</option>
              <option value="size">Sort: Size</option>
              <option value="views">Sort: Views</option>
            </select>
            <button className="btn-secondary" style={{ padding: "8px 10px" }} onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")} title={sortDir === "asc" ? "Ascending" : "Descending"}>
              {sortDir === "asc" ? "↑" : "↓"}
            </button>

            {/* View toggle */}
            <div className="view-toggle">
              <button className={`view-btn ${viewMode === "grid" ? "view-btn-on" : ""}`} onClick={() => setViewMode("grid")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
              </button>
              <button className={`view-btn ${viewMode === "table" ? "view-btn-on" : ""}`} onClick={() => setViewMode("table")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
              </button>
            </div>
          </div>

          {/* ── Advanced filter panel ── */}
          {showFilters && (
            <div className="advanced-filters">
              {[
                ["Property Type", typeFilter, updateTypeFilter, ["all", ...types]],
                ["Configuration", bhkFilter, updateBhkFilter, ["all", ...bhks]],
                ["City", cityFilter, updateCityFilter, ["all", ...cities]],
                ["Furnishing", furnishFilter, updateFurnishFilter, ["all", "Fully", "Semi", "Unfurnished"]],
              ].map(([label, val, setter, opts]) => (
                <div key={label} className="adv-filter-group">
                  <div className="adv-filter-label">{label}</div>
                  <div className="adv-filter-chips">
                    {opts.map(opt => (
                      <button key={opt} className={`filter-chip ${val === opt ? "active" : ""}`} style={{ fontSize: 11.5 }} onClick={() => setter(opt)}>
                        {opt === "all" ? `All ${label}s` : opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {activeFilters > 0 && (
                <button onClick={clearAllFilters}
                  style={{ alignSelf: "flex-end", background: "none", border: "1px solid var(--border)", color: "var(--text-mid)", fontFamily: "var(--sans)", fontSize: 12, padding: "6px 14px", borderRadius: 4, cursor: "pointer" }}>
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {/* ── Content area ── */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px 32px", scrollbarWidth: "thin", scrollbarColor: "var(--border) transparent" }}>
            {filtered.length === 0 ? (
              <div className="empty-state" style={{ marginTop: 60 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="52" height="52"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                <div style={{ fontFamily: "var(--serif)", fontSize: 18, color: "var(--navy)", marginTop: 8 }}>No properties found</div>
                <p>Try adjusting your search or filter criteria.</p>
                <button className="btn-secondary" onClick={clearAllFilters}>Reset filters</button>
              </div>
            ) : viewMode === "grid" ? (
              <div className="prop-grid">
                {paginated.map((p, i) => <GridCard key={p.id} property={p} onNavigate={navigateAction} animDelay={i * 50} />)}
              </div>
            ) : (
              <div className="card" style={{ overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: 56 }} />
                      <col style={{ width: "22%" }} />
                      <col style={{ width: "8%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "12%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "10%" }} />
                      <col style={{ width: "9%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ padding: "10px 8px 10px 16px" }}></th>
                        {renderSortHeader("name", "Property")}
                        <th>BHK</th>
                        <th>Type</th>
                        <th>Status</th>
                        {renderSortHeader("rent", "Rent / Size")}
                        <th>Tenant</th>
                        {renderSortHeader("views", "Engagement")}
                        <th style={{ textAlign: "right", paddingRight: 16 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((p, i) => <TableRow key={p.id} property={p} onNavigate={navigateAction} index={i} />)}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Pagination ── */}
            {totalPages > 1 && (
              <div className="pagination">
                <div style={{ fontSize: 12.5, color: "var(--text-lite)" }}>
                  Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, filtered.length)} of <strong>{filtered.length}</strong>
                </div>
                <div className="page-btns">
                  <button className="page-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
                  <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                    .reduce((acc, p, i, arr) => {
                      if (i > 0 && arr[i - 1] !== p - 1) acc.push("...");
                      acc.push(p);
                      return acc;
                    }, [])
                    .map((p, i) => typeof p === "string"
                      ? <span key={`e${i}`} style={{ padding: "0 4px", color: "var(--text-lite)" }}>…</span>
                      : <button key={p} className={`page-btn ${page === p ? "page-btn-on" : ""}`} onClick={() => setPage(p)}>{p}</button>
                    )}
                  <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
                  <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
