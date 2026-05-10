import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as THREE from "three";
import { getOwnerPropertyById, updateOwnerProperty } from "../services/apiClient";
import "./Dashboard.css";
import "./Properties.css";

const EMPTY_FORM = {
  id: "",
  status: "vacant",
  publishState: "draft",
  title: "",
  propertyType: "apartment",
  bhk: "",
  totalUnits: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  landmark: "",
  sizeCarpet: "",
  sizeBuiltup: "",
  floorNumber: "",
  totalFloors: "",
  facing: "",
  propertyAge: "",
  furnishing: "semi",
  parking: "none",
  petPolicy: "",
  amenities: [],
  rent: "",
  deposit: "",
  maintenanceCharges: "",
  maintenanceFreq: "monthly",
  negotiable: "no",
  minLease: "",
  maxLease: "",
  noticePeriod: "",
  preferredTenants: "",
  rentIncludes: [],
  houseRules: "",
  availableFrom: "",
  description: "",
  videoTour: "",
  photos: null,
  documents: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = n => n ? new Intl.NumberFormat("en-IN").format(n) : "";
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const normalizePropertyType = (value, fallback = "apartment") => {
  const key = String(value || "").trim().toLowerCase();
  if (["apartment", "independent", "pg", "commercial", "studio"].includes(key)) return key;
  if (key.includes("independent")) return "independent";
  if (key.includes("commercial")) return "commercial";
  if (key.includes("studio")) return "studio";
  if (key.includes("pg")) return "pg";
  return fallback;
};

const normalizeFurnishing = (value, fallback = "semi") => {
  const key = String(value || "").trim().toLowerCase();
  if (["fully", "semi", "unfurnished"].includes(key)) return key;
  if (key.includes("full")) return "fully";
  if (key.includes("semi")) return "semi";
  if (key.includes("unfurn")) return "unfurnished";
  return fallback;
};

const normalizeParking = (value, fallback = "none") => {
  const key = String(value || "").trim().toLowerCase();
  if (["none", "two_wheeler", "four_wheeler", "both", "covered"].includes(key)) return key;
  if (key.includes("both")) return "both";
  if (key.includes("cover")) return "covered";
  if (key.includes("2")) return "two_wheeler";
  if (key.includes("4")) return "four_wheeler";
  if (key.includes("none")) return "none";
  return fallback;
};

const toText = (value, fallback = "") => {
  if (value == null) return fallback;
  return String(value);
};

const mapApiPropertyToEditForm = (property, fallback) => {
  const source = property || {};
  const base = fallback || {};
  return {
    ...base,
    id: source.id ?? base.id,
    status: source.status ?? base.status ?? "vacant",
    publishState: source.publishState ?? base.publishState ?? "draft",
    title: toText(source.title, base.title || ""),
    propertyType: normalizePropertyType(source.propertyType ?? base.propertyType, base.propertyType || ""),
    bhk: toText(source.bhk, base.bhk || ""),
    totalUnits: toText(source.totalUnits, base.totalUnits || ""),
    address: toText(source.address, base.address || ""),
    city: toText(source.city, base.city || ""),
    state: toText(source.state, base.state || ""),
    pincode: toText(source.pincode, base.pincode || ""),
    landmark: toText(source.landmark, base.landmark || ""),
    sizeCarpet: toText(source.sizeCarpet, base.sizeCarpet || ""),
    sizeBuiltup: toText(source.sizeBuiltup, base.sizeBuiltup || ""),
    floorNumber: toText(source.floorNumber, base.floorNumber || ""),
    totalFloors: toText(source.totalFloors, base.totalFloors || ""),
    facing: toText(source.facing, base.facing || ""),
    propertyAge: toText(source.propertyAge, base.propertyAge || ""),
    furnishing: normalizeFurnishing(source.furnishing ?? base.furnishing, base.furnishing || ""),
    parking: normalizeParking(source.parking ?? base.parking, base.parking || ""),
    petPolicy: toText(source.petPolicy, base.petPolicy || ""),
    amenities: Array.isArray(source.amenities) ? source.amenities : (Array.isArray(base.amenities) ? base.amenities : []),
    rent: toText(source.rent, base.rent || ""),
    deposit: toText(source.deposit, base.deposit || ""),
    maintenanceCharges: toText(source.maintenanceCharges, base.maintenanceCharges || ""),
    maintenanceFreq: toText(source.maintenanceFreq, base.maintenanceFreq || ""),
    negotiable: toText(source.negotiable, base.negotiable || ""),
    minLease: toText(source.minLease, base.minLease || ""),
    maxLease: toText(source.maxLease, base.maxLease || ""),
    noticePeriod: toText(source.noticePeriod, base.noticePeriod || ""),
    preferredTenants: toText(source.preferredTenants, base.preferredTenants || ""),
    rentIncludes: Array.isArray(source.rentIncludes) ? source.rentIncludes : (Array.isArray(base.rentIncludes) ? base.rentIncludes : []),
    houseRules: toText(source.houseRules, base.houseRules || ""),
    availableFrom: toText(source.availableFrom, base.availableFrom || ""),
    description: toText(source.description, base.description || ""),
    videoTour: toText(source.videoTour, base.videoTour || ""),
    photos: null,
    documents: null,
  };
};

const buildOwnerPropertyPayload = (data) => ({
  title: data.title.trim(),
  propertyType: data.propertyType,
  bhk: data.bhk || null,
  totalUnits: data.totalUnits || null,
  address: data.address.trim(),
  city: data.city.trim(),
  state: data.state,
  pincode: data.pincode,
  propertyCountry: "IN",
  sizeCarpet: data.sizeCarpet || null,
  sizeBuiltup: data.sizeBuiltup || null,
  floorNumber: data.floorNumber || null,
  totalFloors: data.totalFloors || null,
  furnishing: data.furnishing || null,
  parking: data.parking || null,
  petPolicy: data.petPolicy || null,
  facing: data.facing || null,
  availableFrom: data.availableFrom || null,
  description: data.description || null,
  amenities: Array.isArray(data.amenities) ? data.amenities : [],
  rent: data.rent || null,
  deposit: data.deposit || null,
  maintenanceCharges: data.maintenanceCharges || null,
  minLease: data.minLease || null,
  houseRules: data.houseRules || null,
});

// ─── Live 3D Preview (same as AddProperty but lighter) ────────────────────────
function BuildingPreview({ formData }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const buildingRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 500);
    camera.position.set(12, 16, 20);
    camera.lookAt(0, 5, 0);

    const grid = new THREE.GridHelper(24, 12, 0xB8943F, 0x1a2a3a);
    grid.material.opacity = 0.3; grid.material.transparent = true;
    scene.add(grid);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: 0x0c1b2e, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    ground.rotation.x = Math.PI / 2; ground.position.y = 0.01;
    scene.add(ground);

    [[-8, -6, 2.5, 8], [8, -5, 2, 12], [-6, 4, 2, 6], [7, 5, 3, 10]].forEach(([x, z, w, h]) => {
      const g = new THREE.BoxGeometry(w, h, w * 0.8);
      [new THREE.MeshBasicMaterial({ color: 0x0d1d30, transparent: true, opacity: 0.7 }),
      new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.12 })].forEach((m) => {
        const mesh = new THREE.Mesh(g, m); mesh.position.set(x, h / 2, z); scene.add(mesh);
      });
    });

    const group = new THREE.Group();
    scene.add(group);
    buildingRef.current = group;
    sceneRef.current = { renderer, scene, camera };

    let frameId;
    const clock = new THREE.Clock();
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      group.rotation.y = clock.getElapsedTime() * 0.25;
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const nW = mount.clientWidth, nH = mount.clientHeight;
      if (!nW || !nH) return;
      camera.aspect = nW / nH; camera.updateProjectionMatrix(); renderer.setSize(nW, nH);
    };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(frameId); window.removeEventListener("resize", onResize); if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement); renderer.dispose(); };
  }, []);

  useEffect(() => {
    const group = buildingRef.current;
    if (!group) return;
    while (group.children.length) { const c = group.children[0]; c.geometry?.dispose(); group.remove(c); }

    const floors = parseInt(formData.totalFloors) || 4;
    const wMap = { "Studio": 3.5, "1 RK": 4, "1 BHK": 4.5, "2 BHK": 5.5, "3 BHK": 7, "4 BHK": 8, "4+ BHK": 9 };
    const w = formData.propertyType === "commercial" ? 8 : formData.propertyType === "independent" ? 7 : (wMap[formData.bhk] || 5.5);
    const d = w * 0.75, h = Math.max(4, floors * 2.8);

    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    group.add(new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ color: 0x0f2140 })));
    const wClr = formData.furnishing === "fully" ? 0xB8943F : formData.furnishing === "semi" ? 0x4a7cbf : 0x3a5a3a;
    const wireM = new THREE.Mesh(bodyGeo, new THREE.MeshBasicMaterial({ color: wClr, wireframe: true, transparent: true, opacity: 0.6 }));
    group.add(wireM); wireM.position.y = h / 2;
    const body = group.children[0]; body.position.y = h / 2;

    for (let f = 1; f < floors; f++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.06, d + 0.1), new THREE.MeshBasicMaterial({ color: 0xB8943F, transparent: true, opacity: 0.3 }));
      slab.position.y = f * 2.8; group.add(slab);
    }

    const cols = Math.floor(w / 1.0), lightOn = formData.furnishing === "fully" ? 0.7 : formData.furnishing === "semi" ? 0.45 : 0.2;
    for (let fl = 0; fl < floors; fl++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() > lightOn) continue;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), new THREE.MeshBasicMaterial({ color: 0xFFF0C0, transparent: true, opacity: 0.85 }));
        win.position.set((c - cols / 2 + 0.5) * (w / cols), fl * 2.8 + 1.9, d / 2 + 0.02);
        group.add(win);
      }
    }

    if (formData.amenities.includes("Lift") || floors > 6) {
      const lift = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.5, 1.2), new THREE.MeshBasicMaterial({ color: 0x0c1b2e }));
      lift.position.set(w / 2 - 1, h + 1.25, 0); group.add(lift);
      const lW = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.5, 1.2), new THREE.MeshBasicMaterial({ color: 0xB8943F, wireframe: true, transparent: true, opacity: 0.5 }));
      lW.position.copy(lift.position); group.add(lW);
    }
    if (formData.amenities.includes("Swimming Pool")) {
      const pool = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.3, 2.2), new THREE.MeshBasicMaterial({ color: 0x0a3d6b, transparent: true, opacity: 0.85 }));
      pool.position.set(w / 2 + 2.5, 0.15, -1); group.add(pool);
      const pW = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.3, 2.2), new THREE.MeshBasicMaterial({ color: 0x00aaff, wireframe: true, transparent: true, opacity: 0.4 }));
      pW.position.copy(pool.position); group.add(pW);
    }
    if (formData.parking !== "none" && formData.parking !== "") {
      const park = new THREE.Mesh(new THREE.BoxGeometry(w + 3, 0.1, d * 1.5), new THREE.MeshBasicMaterial({ color: 0x0a1520, transparent: true, opacity: 0.9 }));
      park.position.set(0.5, 0.05, d * 0.8); group.add(park);
    }

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 1.5), new THREE.MeshBasicMaterial({ color: 0xB8943F, transparent: true, opacity: 0.5 }));
    canopy.position.set(0, 2.2, d / 2 + 0.75); group.add(canopy);

  }, [formData.totalFloors, formData.bhk, formData.propertyType, formData.furnishing, formData.parking, formData.amenities]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }} />;
}

// ─── Field Components (same system) ──────────────────────────────────────────
const Lbl = ({ children, required }) => <label className="f-lbl">{children}{required && <span style={{ color: "var(--red)", marginLeft: 3 }}>*</span>}</label>;

const Inp = ({ label, name, type = "text", value, onChange, required, error }) => (
  <div className="f-grp">
    <Lbl required={required}>{label}</Lbl>
    <input className={`f-ctrl${error ? " f-ctrl-error" : ""}`} type={type} name={name} value={value} onChange={onChange} required={required} autoComplete="off" />
    {error && <div className="f-error">{error}</div>}
  </div>
);

const Sel = ({ label, name, value, onChange, options, required, error }) => (
  <div className="f-grp">
    <Lbl required={required}>{label}</Lbl>
    <select className={`f-ctrl${error ? " f-ctrl-error" : ""}`} name={name} value={value} onChange={onChange}>
      <option value="">Select</option>
      {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
    {error && <div className="f-error">{error}</div>}
  </div>
);

const Txt = ({ label, name, value, onChange, rows = 3, required }) => (
  <div className="f-grp">
    <Lbl required={required}>{label}</Lbl>
    <textarea className="f-ctrl" name={name} value={value} onChange={onChange} rows={rows} style={{ resize: "vertical" }} />
  </div>
);

const AmenityGrid = ({ value, onChange }) => {
  const list = [
    ["Lift", "🛗"], ["Security Guard", "👮"], ["CCTV", "📹"], ["Generator Backup", "⚡"],
    ["Gym", "🏋️"], ["Swimming Pool", "🏊"], ["Club House", "🏛️"], ["Intercom", "📞"],
    ["Gas Pipeline", "🔥"], ["24/7 Water", "💧"], ["WiFi Ready", "📶"], ["Laundry", "👕"],
    ["Children Play Area", "🎠"], ["Rooftop Access", "🏙️"], ["Visitor Parking", "🅿️"],
  ];
  const toggle = key => onChange(value.includes(key) ? value.filter(k => k !== key) : [...value, key]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {list.map(([key, icon]) => (
        <button key={key} type="button" className={`amenity-chip${value.includes(key) ? " amenity-on" : ""}`} onClick={() => toggle(key)}>
          <span>{icon}</span><span>{key}</span>
        </button>
      ))}
    </div>
  );
};

// ─── Change Tracker ───────────────────────────────────────────────────────────
function ChangeBadge({ original, current, field }) {
  const orig = original[field], curr = current[field];
  const changed = Array.isArray(orig)
    ? JSON.stringify(orig.sort()) !== JSON.stringify([...(curr || [])].sort())
    : String(orig || "") !== String(curr || "");
  if (!changed) return null;
  return <span style={{ fontSize: 10, background: "var(--amber-bg)", color: "var(--amber)", fontFamily: "var(--mono)", padding: "1px 6px", borderRadius: 3, marginLeft: 6, letterSpacing: "0.05em" }}>CHANGED</span>;
}

// ─── SECTIONS ─────────────────────────────────────────────────────────────────
const STEPS = [
  { id: "basics", label: "Basics", icon: "🏠" },
  { id: "details", label: "Details", icon: "📐" },
  { id: "amenities", label: "Amenities", icon: "✨" },
  { id: "lease", label: "Lease Terms", icon: "📋" },
  { id: "media", label: "Media", icon: "📷" },
];

const STATES_IN = ["Maharashtra", "Delhi", "Karnataka", "Tamil Nadu", "Telangana", "Gujarat", "Rajasthan", "West Bengal", "Uttar Pradesh", "Haryana", "Andhra Pradesh", "Kerala", "Punjab", "Other"];

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function EditProperty({ propertyId = 1, onNavigate }) {
  const routerNavigate = useNavigate();
  const { propertyId: propertyIdParam } = useParams();
  const resolvedPropertyId = propertyIdParam || propertyId || "";
  const nav = onNavigate || ((action, id) => {
    if (action === "list") {
      routerNavigate("/owner/properties");
      return;
    }
    if (action === "detail") {
      routerNavigate(`/owner/properties/${id || resolvedPropertyId}`);
      return;
    }
    if (action === "edit") {
      routerNavigate(`/owner/properties/${id || resolvedPropertyId}/edit`);
    }
  });
  const fallbackOriginal = useMemo(() => ({ ...EMPTY_FORM }), []);

  const [original, setOriginal] = useState({ ...fallbackOriginal });
  const [data, setData] = useState({ ...fallbackOriginal });
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState(null); // "draft" | "publish"
  const [saved, setSaved] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [loadingProperty, setLoadingProperty] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [savedChangesCount, setSavedChangesCount] = useState(0);

  useEffect(() => {
    let active = true;

    const loadProperty = async () => {
      setLoadingProperty(true);
      setLoadError("");
      setSaveError("");
      setSaved(false);
      setSavedChangesCount(0);
      try {
        if (!resolvedPropertyId) {
          throw new Error("Missing property id.");
        }
        const response = await getOwnerPropertyById(resolvedPropertyId);
        const mapped = mapApiPropertyToEditForm(response?.property, fallbackOriginal);
        if (!active) return;
        setOriginal({ ...mapped });
        setData({ ...mapped });
      } catch (error) {
        if (!active) return;
        setOriginal({ ...fallbackOriginal });
        setData({ ...fallbackOriginal });
        setLoadError(error?.message || "Unable to load live property details.");
      } finally {
        if (active) setLoadingProperty(false);
      }
    };

    loadProperty();
    return () => {
      active = false;
    };
  }, [resolvedPropertyId, fallbackOriginal]);

  const isDirty = useMemo(() => !deepEqual(data, original), [data, original]);
  const changedFields = useMemo(() => {
    const changed = [];
    Object.keys(original).forEach(k => {
      const a = original[k], b = data[k];
      const diff = Array.isArray(a) ? JSON.stringify([...(a || [])].sort()) !== JSON.stringify([...(b || [])].sort()) : String(a || "") !== String(b || "");
      if (diff) changed.push(k);
    });
    return changed;
  }, [data, original]);

  const ch = useCallback(e => {
    const { name, value } = e.target;
    setData(d => ({ ...d, [name]: value }));
    if (saveError) setSaveError("");
    if (errors[name]) setErrors(er => { const c = { ...er }; delete c[name]; return c; });
  }, [errors, saveError]);

  const setAmenities = useCallback(val => {
    if (saveError) setSaveError("");
    setData(d => ({ ...d, amenities: val }));
  }, [saveError]);
  const toggleRentIncludes = useCallback(item => {
    if (saveError) setSaveError("");
    setData(d => {
      const current = Array.isArray(d.rentIncludes) ? d.rentIncludes : [];
      return {
        ...d,
        rentIncludes: current.includes(item) ? current.filter(i => i !== item) : [...current, item],
      };
    });
  }, [saveError]);

  const validate = stepIdx => {
    const e = {};
    if (stepIdx === 0) {
      if (!data.title.trim()) e.title = "Listing title is required";
      if (!data.address.trim()) e.address = "Address is required";
      if (!data.city.trim()) e.city = "City is required";
      if (!data.state) e.state = "State is required";
      if (!/^\d{6}$/.test(data.pincode)) e.pincode = "Valid 6-digit PIN required";
    }
    if (stepIdx === 1) {
      if (!data.sizeCarpet || isNaN(data.sizeCarpet)) e.sizeCarpet = "Carpet area required";
      if (!data.totalFloors || isNaN(data.totalFloors)) e.totalFloors = "Total floors required";
      if (!data.furnishing) e.furnishing = "Furnishing status required";
    }
    if (stepIdx === 3) {
      if (!data.rent || isNaN(data.rent) || Number(data.rent) <= 0) e.rent = "Valid rent required";
      if (!data.deposit || isNaN(data.deposit) || Number(data.deposit) <= 0) e.deposit = "Deposit required";
    }
    return e;
  };

  const goNext = () => {
    const e = validate(step);
    if (Object.keys(e).length) { setErrors(e); return; }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };

  const handleSave = async mode => {
    const e = validate(step);
    if (Object.keys(e).length && mode === "publish") { setErrors(e); return; }
    setSaving(true);
    setSaveMode(mode);
    setSaveError("");
    setSavedChangesCount(changedFields.length);
    try {
      const response = await updateOwnerProperty(resolvedPropertyId, buildOwnerPropertyPayload(data));
      const mapped = mapApiPropertyToEditForm(response?.property, data);
      setOriginal({ ...mapped });
      setData({ ...mapped });
      setSaved(true);
    } catch (error) {
      setSaveError(error?.message || "Unable to save property updates right now.");
    } finally {
      setSaving(false);
    }
  };

  const resetChanges = () => { setData({ ...original }); setErrors({}); setShowDiscard(false); };

  if (loadingProperty) return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>
      <div style={{ textAlign: "center", padding: 36, maxWidth: 460 }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 24, fontWeight: 600, color: "var(--navy)", marginBottom: 8 }}>Loading Property</div>
        <div style={{ fontSize: 13.5, color: "var(--text-mid)" }}>Fetching the latest details so edits are applied on fresh data.</div>
      </div>
    </div>
  );

  if (saved) return (
    <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>
      <div style={{ textAlign: "center", padding: 48, maxWidth: 480 }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--green-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 24px" }}>✓</div>
        <div style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 600, color: "var(--navy)", marginBottom: 10 }}>
          {saveMode === "draft" ? "Draft Saved" : "Changes Published"}
        </div>
        <div style={{ fontSize: 14, color: "var(--text-mid)", lineHeight: 1.6, marginBottom: 8 }}>
          <strong>{data.title}</strong> has been {saveMode === "draft" ? "saved as a draft" : "updated and is live"}.
        </div>
        <div style={{ fontSize: 13, color: "var(--text-lite)", marginBottom: 28 }}>
          {savedChangesCount} field{savedChangesCount !== 1 ? "s" : ""} were updated
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button className="btn-primary" onClick={() => nav("detail", resolvedPropertyId)}>View Property</button>
          <button className="btn-secondary" onClick={() => nav("list")}>All Properties</button>
        </div>
      </div>
    </div>
  );

  const progressPct = (step / (STEPS.length - 1)) * 100;

  return (
    <div className="add-property-root">
      {/* ── Left 3D Preview ── */}
      <div className="ap-preview-panel">
        <BuildingPreview formData={data} />
        <div className="ap-preview-overlay" />
        <div className="ap-preview-info">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.2em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>Editing</span>
            {isDirty && <span style={{ background: "rgba(196,123,26,0.3)", border: "1px solid rgba(196,123,26,0.4)", color: "#FFB84D", fontSize: 9, fontFamily: "var(--mono)", padding: "2px 8px", borderRadius: 3, letterSpacing: "0.1em" }}>UNSAVED CHANGES · {changedFields.length}</span>}
          </div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 4 }}>{data.title || "Untitled Property"}</div>
          {data.city && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", marginBottom: 14 }}>{data.city}{data.state ? `, ${data.state}` : ""}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
            {[data.bhk, data.furnishing && `${data.furnishing} furnished`, data.sizeCarpet && `${data.sizeCarpet} sq.ft`].filter(Boolean).map(t => (
              <span key={t} style={{ background: "rgba(184,148,63,0.18)", border: "1px solid rgba(184,148,63,0.28)", color: "rgba(255,255,255,0.75)", fontSize: 11, padding: "3px 9px", borderRadius: 3 }}>{t}</span>
            ))}
          </div>
          {data.rent && (
            <div style={{ padding: "11px 14px", background: "rgba(255,255,255,0.06)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", display: "inline-block" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.15em", color: "rgba(255,255,255,0.3)", marginBottom: 3 }}>MONTHLY RENT</div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 700, color: "var(--gold)" }}>₹{fmt(data.rent)}</div>
            </div>
          )}

          {/* Changed fields list */}
          {isDirty && changedFields.length > 0 && (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(196,123,26,0.1)", border: "1px solid rgba(196,123,26,0.2)", borderRadius: 5 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.15em", color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>MODIFIED FIELDS</div>
              {changedFields.slice(0, 5).map(f => (
                <div key={f} style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 2 }}>· {f}</div>
              ))}
              {changedFields.length > 5 && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>+{changedFields.length - 5} more</div>}
            </div>
          )}

          {/* Original vs current rent diff */}
          {original.rent !== data.rent && original.rent && data.rent && (
            <div style={{ marginTop: 10, fontSize: 11.5, color: "rgba(255,255,255,0.5)" }}>
              Was <span style={{ textDecoration: "line-through", color: "rgba(255,255,255,0.3)" }}>₹{fmt(original.rent)}</span>
              {" → "}<span style={{ color: "var(--gold)" }}>₹{fmt(data.rent)}</span>
            </div>
          )}
        </div>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.08)" }}>
          <div style={{ height: "100%", background: "var(--gold)", width: `${progressPct}%`, transition: "width 0.4s ease" }} />
        </div>
      </div>

      {/* ── Right Form ── */}
      <div className="ap-form-panel">
        {/* Header */}
        <div className="ap-form-header">
          <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => isDirty ? setShowDiscard(true) : nav("detail", resolvedPropertyId)}>← Back</button>
          <div style={{ flex: 1, marginLeft: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 600, color: "var(--navy)" }}>Edit Property</div>
              {isDirty && <span className="badge badge-amber"><span className="badge-dot" />{changedFields.length} unsaved change{changedFields.length !== 1 ? "s" : ""}</span>}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>{original.title} · Step {step + 1} of {STEPS.length}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {isDirty && <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 14px", color: "var(--text-lite)" }} onClick={() => setShowDiscard(true)}>Discard</button>}
            <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => handleSave("draft")} disabled={saving}>Save Draft</button>
            <button className="btn-primary btn-gold" style={{ fontSize: 12, padding: "6px 16px", fontWeight: 600 }} onClick={() => handleSave("publish")} disabled={saving || !isDirty}>
              {saving && saveMode === "publish" ? "Publishing…" : "Publish Changes"}
            </button>
          </div>
        </div>

        {loadError && (
          <div style={{ margin: "12px 18px 0", padding: "10px 12px", border: "1px solid rgba(196,123,26,0.25)", background: "rgba(196,123,26,0.08)", color: "var(--amber)", borderRadius: 6, fontSize: 12.5 }}>
            {loadError}
          </div>
        )}
        {saveError && (
          <div style={{ margin: "12px 18px 0", padding: "10px 12px", border: "1px solid rgba(184,50,50,0.25)", background: "rgba(184,50,50,0.08)", color: "var(--red)", borderRadius: 6, fontSize: 12.5 }}>
            {saveError}
          </div>
        )}

        {/* Step nav */}
        <div className="ap-step-nav">
          {STEPS.map((s, i) => {
            const sectionFields = {
              0: ["title", "propertyType", "bhk", "address", "city", "state", "pincode"],
              1: ["sizeCarpet", "sizeBuiltup", "floorNumber", "totalFloors", "facing", "furnishing", "parking"],
              2: ["amenities", "rentIncludes", "description"],
              3: ["rent", "deposit", "maintenanceCharges", "minLease", "maxLease", "noticePeriod", "preferredTenants", "houseRules"],
              4: ["photos", "documents", "videoTour"],
            }[i] || [];
            const hasChanges = sectionFields.some(f => changedFields.includes(f));
            return (
              <button key={s.id} className={`ap-step-btn ${i === step ? "ap-step-active" : "ap-step-done"}`} onClick={() => setStep(i)}>
                <span className="ap-step-dot">{hasChanges ? "●" : i + 1}</span>
                <span className="ap-step-label">{s.label}</span>
                {hasChanges && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber)", display: "inline-block", marginLeft: 4, flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>

        {/* Form content */}
        <div className="ap-form-body">

          {/* ── STEP 0: Basics ── */}
          {step === 0 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>🏠</span> Property Basics <ChangeBadge original={original} current={data} field="title" /></div>

              <div className="form-row-single">
                <Inp label="Listing Title" name="title" value={data.title} onChange={ch} placeholder="Descriptive listing title" required error={errors.title} hint="Shown in search results — make it compelling" />
              </div>
              <div className="form-row">
                <div className="f-grp">
                  <Lbl required>Property Type</Lbl>
                  <div className="type-selector">
                    {[["apartment", "🏢", "Apartment"], ["independent", "🏡", "Independent"], ["pg", "🛏️", "PG / Hostel"], ["commercial", "🏗️", "Commercial"], ["studio", "🏠", "Studio"]].map(([v, ic, l]) => (
                      <button key={v} type="button" className={`type-btn${data.propertyType === v ? " type-btn-on" : ""}`} onClick={() => setData(d => ({ ...d, propertyType: v }))}>
                        <span style={{ fontSize: 18 }}>{ic}</span><span>{l}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="form-row">
                <div className="f-grp">
                  <Lbl required>Configuration <ChangeBadge original={original} current={data} field="bhk" /></Lbl>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["Studio", "1 RK", "1 BHK", "2 BHK", "3 BHK", "4 BHK", "4+ BHK"].map(b => (
                      <button key={b} type="button"
                        style={{ padding: "7px 16px", fontFamily: "var(--sans)", fontSize: 13, fontWeight: data.bhk === b ? 600 : 400, color: data.bhk === b ? "#fff" : "var(--text-mid)", background: data.bhk === b ? "var(--navy)" : "var(--surface)", border: `1.5px solid ${data.bhk === b ? "var(--navy)" : "var(--border)"}`, borderRadius: "var(--radius)", cursor: "pointer", transition: "all 0.15s" }}
                        onClick={() => setData(d => ({ ...d, bhk: b }))}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
                <Inp label="Units Available" name="totalUnits" type="number" value={data.totalUnits} onChange={ch} placeholder="1" />
              </div>

              <div className="ap-section-divider"><span>Location</span></div>
              <div className="form-row-single">
                <Txt label="Full Address" name="address" value={data.address} onChange={ch} required placeholder="Building name, street, locality..." rows={2} />
                {errors.address && <div className="f-error">{errors.address}</div>}
              </div>
              <div className="form-row">
                <Inp label="City" name="city" value={data.city} onChange={ch} required error={errors.city} />
                <Sel label="State" name="state" value={data.state} onChange={ch} required error={errors.state} options={STATES_IN.map(s => ({ value: s, label: s }))} />
              </div>
              <div className="form-row">
                <Inp label="PIN Code" name="pincode" value={data.pincode} onChange={ch} required error={errors.pincode} placeholder="400001" />
                <Inp label="Landmark" name="landmark" value={data.landmark} onChange={ch} placeholder="Nearest landmark" />
              </div>
            </div>
          )}

          {/* ── STEP 1: Details ── */}
          {step === 1 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>📐</span> Specifications</div>
              <div className="form-row">
                <Inp label="Carpet Area (sq. ft.)" name="sizeCarpet" type="number" value={data.sizeCarpet} onChange={ch} required error={errors.sizeCarpet} placeholder="850" />
                <Inp label="Built-up Area (sq. ft.)" name="sizeBuiltup" type="number" value={data.sizeBuiltup} onChange={ch} placeholder="1020" hint="Including walls & common proportional share" />
              </div>
              <div className="form-row">
                <Inp label="Floor Number" name="floorNumber" value={data.floorNumber} onChange={ch} placeholder="4" />
                <Inp label="Total Floors in Building" name="totalFloors" type="number" value={data.totalFloors} onChange={ch} required error={errors.totalFloors} placeholder="12" hint="Updates the 3D model in real-time" />
              </div>
              <div className="form-row">
                <Sel label="Facing" name="facing" value={data.facing} onChange={ch} options={["North", "South", "East", "West", "North-East", "North-West", "South-East", "South-West"].map(f => ({ value: f, label: f }))} />
                <Inp label="Property Age (years)" name="propertyAge" type="number" value={data.propertyAge} onChange={ch} placeholder="8" />
              </div>
              <div className="ap-section-divider"><span>Furnishing & Access</span></div>
              <div className="form-row">
                <div className="f-grp">
                  <Lbl required>Furnishing Status <ChangeBadge original={original} current={data} field="furnishing" /></Lbl>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[["fully", "Fully Furnished", "All furniture, appliances & fixtures included"], ["semi", "Semi Furnished", "Basic fixtures — fans, lights, wardrobes"], ["unfurnished", "Unfurnished", "Bare shell — tenant furnishes"]].map(([v, l, desc]) => (
                      <label key={v} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", border: `1.5px solid ${data.furnishing === v ? "var(--navy)" : "var(--border)"}`, borderRadius: 4, cursor: "pointer", background: data.furnishing === v ? "rgba(12,27,46,0.04)" : "var(--white)", transition: "all 0.14s" }}>
                        <input type="radio" name="furnishing" value={v} checked={data.furnishing === v} onChange={ch} style={{ marginTop: 2, accentColor: "var(--navy)" }} />
                        <div><div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--navy)" }}>{l}</div><div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 1 }}>{desc}</div></div>
                      </label>
                    ))}
                  </div>
                  {errors.furnishing && <div className="f-error">{errors.furnishing}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Sel label="Parking" name="parking" value={data.parking} onChange={ch} options={[{ value: "none", label: "No Parking" }, { value: "two_wheeler", label: "2-Wheeler" }, { value: "four_wheeler", label: "4-Wheeler" }, { value: "both", label: "Both 2W & 4W" }, { value: "covered", label: "Covered/Reserved" }]} />
                  <Sel label="Pet Policy" name="petPolicy" value={data.petPolicy} onChange={ch} options={[{ value: "no_pets", label: "No Pets" }, { value: "small", label: "Small Pets" }, { value: "any", label: "All Pets Welcome" }, { value: "negotiable", label: "Negotiable" }]} />
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Amenities ── */}
          {step === 2 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>✨</span> Amenities <ChangeBadge original={original} current={data} field="amenities" /></div>
              <div style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 18, lineHeight: 1.55 }}>Toggle amenities available at this property. Changes reflect in the live 3D preview.</div>
              <AmenityGrid value={data.amenities} onChange={setAmenities} />
              <div className="ap-section-divider" style={{ marginTop: 22 }}><span>Included in Rent</span></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {["Maintenance Charges", "Water Bill", "Electricity (up to ₹500)", "Internet / WiFi", "DTH / Cable TV", "Housekeeping", "Society Charges"].map(item => (
                  <button key={item} type="button" className={`amenity-chip${data.rentIncludes.includes(item) ? " amenity-on" : ""}`} onClick={() => toggleRentIncludes(item)}>{item}</button>
                ))}
              </div>
              <div className="ap-section-divider" style={{ marginTop: 22 }}><span>Description <ChangeBadge original={original} current={data} field="description" /></span></div>
              <Txt label="Property Description" name="description" value={data.description} onChange={ch} rows={5} placeholder="Highlight key features, location advantages, recent upgrades..." />
            </div>
          )}

          {/* ── STEP 3: Lease ── */}
          {step === 3 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>📋</span> Lease & Pricing</div>
              <div className="form-row">
                <div className="f-grp">
                  <Lbl required>Monthly Rent (₹) <ChangeBadge original={original} current={data} field="rent" /></Lbl>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-mid)", fontWeight: 500 }}>₹</span>
                    <input className={`f-ctrl${errors.rent ? " f-ctrl-error" : ""}`} type="number" name="rent" value={data.rent} onChange={ch} style={{ paddingLeft: 28 }} placeholder="28000" />
                  </div>
                  {errors.rent && <div className="f-error">{errors.rent}</div>}
                  {data.rent && original.rent && data.rent !== original.rent && (
                    <div style={{ fontSize: 11, marginTop: 3, color: Number(data.rent) > Number(original.rent) ? "var(--green)" : "var(--red)" }}>
                      {Number(data.rent) > Number(original.rent) ? "▲" : "▼"} {Math.abs(Math.round((data.rent - original.rent) / original.rent * 100))}% from original ₹{fmt(original.rent)}
                    </div>
                  )}
                </div>
                <div className="f-grp">
                  <Lbl required>Security Deposit (₹) <ChangeBadge original={original} current={data} field="deposit" /></Lbl>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-mid)", fontWeight: 500 }}>₹</span>
                    <input className={`f-ctrl${errors.deposit ? " f-ctrl-error" : ""}`} type="number" name="deposit" value={data.deposit} onChange={ch} style={{ paddingLeft: 28 }} placeholder="84000" />
                  </div>
                  {errors.deposit && <div className="f-error">{errors.deposit}</div>}
                  {data.rent && data.deposit && <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>{(data.deposit / data.rent).toFixed(1)}× monthly rent</div>}
                </div>
              </div>
              <div className="form-row">
                <Inp label="Maintenance (₹/mo)" name="maintenanceCharges" type="number" value={data.maintenanceCharges} onChange={ch} placeholder="1200" />
                <Sel label="Maintenance Freq." name="maintenanceFreq" value={data.maintenanceFreq} onChange={ch} options={[{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "included", label: "Included in Rent" }]} />
              </div>
              <div className="form-row">
                <Sel label="Negotiable?" name="negotiable" value={data.negotiable} onChange={ch} options={[{ value: "no", label: "No — Fixed" }, { value: "slightly", label: "Slightly" }, { value: "yes", label: "Yes" }]} />
                <Inp label="Available From" name="availableFrom" type="date" value={data.availableFrom} onChange={ch} />
              </div>
              <div className="ap-section-divider"><span>Agreement Terms</span></div>
              <div className="form-row">
                <Sel label="Min Lease Duration" name="minLease" value={data.minLease} onChange={ch} options={[3, 6, 11, 12, 18, 24].map(n => ({ value: String(n), label: `${n} Months` }))} />
                <Sel label="Max Lease Duration" name="maxLease" value={data.maxLease} onChange={ch} options={[6, 11, 12, 18, 24, 36, 60].map(n => ({ value: String(n), label: `${n} Months` }))} />
              </div>
              <div className="form-row">
                <Sel label="Notice Period" name="noticePeriod" value={data.noticePeriod} onChange={ch} options={[{ value: "1", label: "1 Month" }, { value: "2", label: "2 Months" }, { value: "3", label: "3 Months" }]} />
                <Sel label="Preferred Tenants" name="preferredTenants" value={data.preferredTenants} onChange={ch} options={[{ value: "any", label: "No Preference" }, { value: "family", label: "Families" }, { value: "bachelor", label: "Bachelors" }, { value: "female", label: "Female Only" }, { value: "working", label: "Working Professionals" }]} />
              </div>
              <Txt label="House Rules" name="houseRules" value={data.houseRules} onChange={ch} rows={4} placeholder="Rules and restrictions for this property..." />
            </div>
          )}

          {/* ── STEP 4: Media ── */}
          {step === 4 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>📷</span> Photos & Documents</div>
              <div style={{ padding: "12px 16px", background: "rgba(12,27,46,0.04)", borderLeft: "3px solid var(--navy-lite)", borderRadius: "0 4px 4px 0", marginBottom: 20, fontSize: 13, color: "var(--text-mid)", lineHeight: 1.55 }}>
                Existing photos are kept unless you upload replacements. New uploads will replace the current set.
              </div>
              <div className="f-grp">
                <Lbl>Property Photos</Lbl>
                <label className="file-upload-zone">
                  <input type="file" hidden name="photos" onChange={e => setData(d => ({ ...d, photos: e.target.files }))} accept="image/*" multiple />
                  <div className="file-zone-icon">↑</div>
                  <div className="file-zone-text">{data.photos ? `${data.photos.length} new file(s) selected` : "Click to upload new photos"}</div>
                  <div className="file-zone-hint">JPG, PNG, WEBP · max 5 MB each · 1280×720px min</div>
                </label>
              </div>
              <div style={{ marginTop: 16 }}>
                <Inp label="Video Tour URL" name="videoTour" value={data.videoTour} onChange={ch} placeholder="https://youtube.com/..." hint="Optional — YouTube, Google Maps 3D, or Matterport link" />
              </div>
              <div className="ap-section-divider"><span>Legal Documents</span></div>
              <div className="f-grp">
                <Lbl>Ownership & Legal Documents</Lbl>
                <label className="file-upload-zone">
                  <input type="file" hidden name="documents" onChange={e => setData(d => ({ ...d, documents: e.target.files }))} accept=".pdf,.jpg,.png" multiple />
                  <div className="file-zone-icon">↑</div>
                  <div className="file-zone-text">{data.documents ? `${data.documents.length} new file(s) selected` : "Replace ownership documents"}</div>
                  <div className="file-zone-hint">PDF, JPG · max 10 MB · Property card, NOC, POA</div>
                </label>
              </div>
            </div>
          )}

          {/* ── Nav ── */}
          <div className="ap-nav-row">
            {step > 0
              ? <button className="btn-secondary" style={{ padding: "12px 20px" }} onClick={() => setStep(s => s - 1)}>← Back</button>
              : <div />}
            <div style={{ display: "flex", gap: 10 }}>
              {isDirty && (
                <button className="btn-secondary" style={{ padding: "12px 18px", color: "var(--red)", borderColor: "rgba(184,50,50,0.3)" }} onClick={() => setShowDiscard(true)}>
                  Discard Changes
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button className="btn-primary" style={{ padding: "12px 28px", fontSize: 14, fontWeight: 600 }} onClick={goNext}>
                  Continue →
                </button>
              ) : (
                <button className="btn-primary btn-gold" style={{ padding: "12px 32px", fontSize: 14, fontWeight: 700 }} onClick={() => handleSave("publish")} disabled={saving || !isDirty}>
                  {saving ? "Saving…" : isDirty ? "Publish Changes ✓" : "No Changes to Save"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Discard confirm modal ── */}
      {showDiscard && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(12,27,46,0.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "var(--white)", borderRadius: 10, padding: 32, maxWidth: 400, width: "100%", boxShadow: "var(--shadow-md)" }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 600, color: "var(--navy)", marginBottom: 10 }}>Discard all changes?</div>
            <div style={{ fontSize: 13.5, color: "var(--text-mid)", lineHeight: 1.55, marginBottom: 22 }}>
              You have <strong>{changedFields.length} unsaved change{changedFields.length !== 1 ? "s" : ""}</strong>. This will revert all fields back to their original published values.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowDiscard(false)}>Keep Editing</button>
              <button style={{ flex: 1, padding: "10px", background: "var(--red)", color: "#fff", border: "none", borderRadius: "var(--radius)", fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }} onClick={resetChanges}>Yes, Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
