import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { createOwnerProperty } from "../services/apiClient";
import "./Dashboard.css";
import "./Properties.css";

// ─── Live 3D Building Preview ─────────────────────────────────────────────────
function BuildingPreview({ formData }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const meshRef = useRef({});

  // Initial setup
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

    // Grid
    const grid = new THREE.GridHelper(24, 12, 0xB8943F, 0x1a2a3a);
    grid.material.opacity = 0.3;
    grid.material.transparent = true;
    scene.add(grid);

    // Ground plane
    const groundGeo = new THREE.PlaneGeometry(24, 24);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x0c1b2e, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = Math.PI / 2;
    ground.position.y = 0.01;
    scene.add(ground);

    // Ambient particles
    const partGeo = new THREE.BufferGeometry();
    const pts = new Float32Array(120 * 3);
    for (let i = 0; i < 120; i++) {
      pts[i * 3] = (Math.random() - 0.5) * 24;
      pts[i * 3 + 1] = Math.random() * 20;
      pts[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    partGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    const partMat = new THREE.PointsMaterial({ color: 0xB8943F, size: 0.06, transparent: true, opacity: 0.35 });
    const particles = new THREE.Points(partGeo, partMat);
    scene.add(particles);

    // Building group
    const buildingGroup = new THREE.Group();
    scene.add(buildingGroup);

    // Surrounding context buildings (grey, static)
    [[-8, -6, 2.5, 8, 2.5], [8, -5, 2, 12, 2], [-6, 4, 2, 6, 2], [7, 5, 3, 10, 2.5], [-10, 0, 2, 14, 2]].forEach(([x, z, w, h, d]) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshBasicMaterial({ color: 0x0d1d30, transparent: true, opacity: 0.7 });
      const wireM = new THREE.MeshBasicMaterial({ color: 0x1e3a5f, wireframe: true, transparent: true, opacity: 0.15 });
      const m = new THREE.Mesh(geo, mat);
      const mw = new THREE.Mesh(geo, wireM);
      m.position.set(x, h / 2, z);
      mw.position.set(x, h / 2, z);
      scene.add(m, mw);
    });

    sceneRef.current = { renderer, scene, camera, buildingGroup, particles };
    meshRef.current = {};

    let frameId;
    const clock = new THREE.Clock();
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      buildingGroup.rotation.y = t * 0.25;
      // Drift particles
      const pos = particles.geometry.attributes.position.array;
      for (let i = 0; i < 120; i++) {
        pos[i * 3 + 1] -= 0.015;
        if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = 20;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    };
    animate();

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
  }, []);

  // Rebuild building whenever relevant fields change
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { buildingGroup } = s;

    // Clear group
    while (buildingGroup.children.length) {
      const child = buildingGroup.children[0];
      child.geometry?.dispose();
      buildingGroup.remove(child);
    }

    const floors = parseInt(formData.totalFloors) || 4;
    const bhk = formData.bhk || "2 BHK";
    const ptype = formData.propertyType || "apartment";
    const furnished = formData.furnishing;
    const hasParking = formData.parking !== "none" && formData.parking !== "";
    const hasGym = formData.amenities.includes("Gym");
    const hasPool = formData.amenities.includes("Swimming Pool");
    const hasLift = formData.amenities.includes("Lift");

    // Dimensions based on BHK
    const wMap = { "Studio": 3.5, "1 RK": 4, "1 BHK": 4.5, "2 BHK": 5.5, "3 BHK": 7, "4 BHK": 8, "4+ BHK": 9 };
    const w = ptype === "commercial" ? 8 : ptype === "independent" ? 7 : (wMap[bhk] || 5.5);
    const d = w * 0.75;
    const h = Math.max(4, floors * 2.8);

    // Main building body
    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x0f2140 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h / 2;
    buildingGroup.add(body);

    // Wire overlay
    const wireClr = furnished === "fully" ? 0xB8943F : furnished === "semi" ? 0x4a7cbf : 0x3a5a3a;
    const wireMat = new THREE.MeshBasicMaterial({ color: wireClr, wireframe: true, transparent: true, opacity: 0.6 });
    const wire = new THREE.Mesh(bodyGeo, wireMat);
    wire.position.y = h / 2;
    buildingGroup.add(wire);

    // Floor slabs (horizontal lines)
    for (let f = 1; f < floors; f++) {
      const slabGeo = new THREE.BoxGeometry(w + 0.1, 0.06, d + 0.1);
      const slabMat = new THREE.MeshBasicMaterial({ color: 0xB8943F, transparent: true, opacity: 0.35 });
      const slab = new THREE.Mesh(slabGeo, slabMat);
      slab.position.y = f * 2.8;
      buildingGroup.add(slab);
    }

    // Windows grid
    const floorH = 2.8;
    const wCols = Math.floor(w / 1.0);
    const lightOn = furnished === "fully" ? 0.7 : furnished === "semi" ? 0.45 : 0.2;
    for (let fl = 0; fl < floors; fl++) {
      for (let c = 0; c < wCols; c++) {
        const lit = Math.random() < lightOn;
        const winGeo = new THREE.PlaneGeometry(0.4, 0.6);
        const winMat = new THREE.MeshBasicMaterial({ color: lit ? 0xFFF0C0 : 0x102030, transparent: true, opacity: lit ? 0.9 : 0.5 });
        const win = new THREE.Mesh(winGeo, winMat);
        win.position.set((c - wCols / 2 + 0.5) * (w / wCols), fl * floorH + floorH / 2 + 0.5, d / 2 + 0.02);
        buildingGroup.add(win);
        // Back face too
        const winB = win.clone();
        winB.rotation.y = Math.PI;
        winB.position.z = -d / 2 - 0.02;
        buildingGroup.add(winB);
      }
    }

    // Rooftop — lift room
    if (hasLift || floors > 6) {
      const liftGeo = new THREE.BoxGeometry(1.2, 2.5, 1.2);
      const liftMat = new THREE.MeshBasicMaterial({ color: 0x0c1b2e });
      const liftW = new THREE.MeshBasicMaterial({ color: 0xB8943F, wireframe: true, transparent: true, opacity: 0.5 });
      const lift = new THREE.Mesh(liftGeo, liftMat);
      const liftWm = new THREE.Mesh(liftGeo, liftW);
      lift.position.set(w / 2 - 1, h + 1.25, 0);
      liftWm.position.copy(lift.position);
      buildingGroup.add(lift, liftWm);
    }

    // Rooftop gym box
    if (hasGym) {
      const gymGeo = new THREE.BoxGeometry(w * 0.45, 1.2, d * 0.45);
      const gymMat = new THREE.MeshBasicMaterial({ color: 0x1a3055 });
      const gymW = new THREE.MeshBasicMaterial({ color: 0x4a9fff, wireframe: true, transparent: true, opacity: 0.5 });
      const gym = new THREE.Mesh(gymGeo, gymMat);
      const gymWm = new THREE.Mesh(gymGeo, gymW);
      gym.position.set(-w / 4, h + 0.6, 0);
      gymWm.position.copy(gym.position);
      buildingGroup.add(gym, gymWm);
    }

    // Ground level parking
    if (hasParking) {
      const pGeo = new THREE.BoxGeometry(w + 3, 0.1, d * 1.5);
      const pMat = new THREE.MeshBasicMaterial({ color: 0x0a1520, transparent: true, opacity: 0.9 });
      const park = new THREE.Mesh(pGeo, pMat);
      park.position.set(0.5, 0.05, d * 0.8);
      buildingGroup.add(park);
      // Parking lines
      for (let i = 0; i < 4; i++) {
        const lineGeo = new THREE.PlaneGeometry(0.06, d * 1.3);
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xB8943F, transparent: true, opacity: 0.35 });
        const line = new THREE.Mesh(lineGeo, lineMat);
        line.rotation.x = -Math.PI / 2;
        line.position.set(-w / 2 + 1 + i * (w + 1) / 4, 0.07, d * 0.8);
        buildingGroup.add(line);
      }
    }

    // Pool — blue area beside building
    if (hasPool) {
      const poolGeo = new THREE.BoxGeometry(3.5, 0.3, 2.2);
      const poolMat = new THREE.MeshBasicMaterial({ color: 0x0a3d6b, transparent: true, opacity: 0.85 });
      const poolW = new THREE.MeshBasicMaterial({ color: 0x00aaff, wireframe: true, transparent: true, opacity: 0.4 });
      const pool = new THREE.Mesh(poolGeo, poolMat);
      const poolWm = new THREE.Mesh(poolGeo, poolW);
      pool.position.set(w / 2 + 2.5, 0.15, -1);
      poolWm.position.copy(pool.position);
      buildingGroup.add(pool, poolWm);
    }

    // Independent house — add pitched roof
    if (ptype === "independent") {
      const roofGeo = new THREE.BoxGeometry(w + 0.5, 0.15, d + 0.5);
      const roofCapMat = new THREE.MeshBasicMaterial({ color: 0x8B6914, transparent: true, opacity: 0.7 });
      const roofCap = new THREE.Mesh(roofGeo, roofCapMat);
      roofCap.position.y = h + 0.07;
      buildingGroup.add(roofCap);
    }

    // Entrance canopy
    const canopyGeo = new THREE.BoxGeometry(2.5, 0.12, 1.5);
    const canopyMat = new THREE.MeshBasicMaterial({ color: 0xB8943F, transparent: true, opacity: 0.55 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 2.2, d / 2 + 0.75);
    buildingGroup.add(canopy);

    // Entrance door
    const doorGeo = new THREE.PlaneGeometry(0.7, 1.6);
    const doorMat = new THREE.MeshBasicMaterial({ color: 0xB8943F, transparent: true, opacity: 0.6 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.8, d / 2 + 0.03);
    buildingGroup.add(door);

    // Address number plate glow
    const plateGeo = new THREE.PlaneGeometry(1.5, 0.6);
    const plateMat = new THREE.MeshBasicMaterial({ color: 0xFFE88A, transparent: true, opacity: 0.25 });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, 3.5, d / 2 + 0.03);
    buildingGroup.add(plate);

  }, [formData.totalFloors, formData.bhk, formData.propertyType, formData.furnishing, formData.parking, formData.amenities]);

  return (
    <div ref={mountRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }} />
  );
}

// ─── Field Components ─────────────────────────────────────────────────────────
const Label = ({ children, required }) => (
  <label className="f-lbl">{children}{required && <span style={{ color: "var(--red)", marginLeft: 3 }}>*</span>}</label>
);

const Input = ({ label, name, type = "text", value, onChange, placeholder, required, hint }) => (
  <div className="f-grp">
    <Label required={required}>{label}</Label>
    <input className="f-ctrl" type={type} name={name} value={value} onChange={onChange} placeholder={placeholder} required={required} autoComplete="off" />
    {hint && <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>{hint}</div>}
  </div>
);

const Select = ({ label, name, value, onChange, options, required, hint }) => (
  <div className="f-grp">
    <Label required={required}>{label}</Label>
    <select className="f-ctrl" name={name} value={value} onChange={onChange}>
      <option value="">Select</option>
      {options.map(o => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
    </select>
    {hint && <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>{hint}</div>}
  </div>
);

const TextArea = ({ label, name, value, onChange, placeholder, rows = 3, required }) => (
  <div className="f-grp">
    <Label required={required}>{label}</Label>
    <textarea className="f-ctrl" name={name} value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={{ resize: "vertical" }} />
  </div>
);

const AmenityToggle = ({ value, onChange }) => {
  const AMENITIES = [
    { key: "Lift", icon: "🛗" },
    { key: "Security Guard", icon: "👮" },
    { key: "CCTV", icon: "📹" },
    { key: "Generator Backup", icon: "⚡" },
    { key: "Gym", icon: "🏋️" },
    { key: "Swimming Pool", icon: "🏊" },
    { key: "Club House", icon: "🏛️" },
    { key: "Intercom", icon: "📞" },
    { key: "Gas Pipeline", icon: "🔥" },
    { key: "24/7 Water", icon: "💧" },
    { key: "WiFi Ready", icon: "📶" },
    { key: "Laundry", icon: "👕" },
    { key: "Children Play Area", icon: "🎠" },
    { key: "Rooftop Access", icon: "🏙️" },
    { key: "Visitor Parking", icon: "🅿️" },
  ];
  const toggle = key => {
    const next = value.includes(key) ? value.filter(k => k !== key) : [...value, key];
    onChange(next);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {AMENITIES.map(({ key, icon }) => (
        <button key={key} type="button"
          onClick={() => toggle(key)}
          className={value.includes(key) ? "amenity-chip amenity-on" : "amenity-chip"}>
          <span>{icon}</span><span>{key}</span>
        </button>
      ))}
    </div>
  );
};

const FileUploadZone = ({ label, name, value, onChange, accept, hint, multiple = true }) => (
  <div className="f-grp">
    <Label>{label}</Label>
    <label className="file-upload-zone">
      <input type="file" hidden name={name} onChange={onChange} accept={accept} multiple={multiple} />
      <div className="file-zone-icon">↑</div>
      <div className="file-zone-text">Click or drag to upload</div>
      <div className="file-zone-hint">{hint}</div>
      {value && value.length > 0 && <div className="file-zone-count">{value.length} file(s) selected</div>}
    </label>
  </div>
);

// ─── Step config ──────────────────────────────────────────────────────────────
const STEPS = [
  { id: "basics", label: "Basics", icon: "🏠", desc: "Title, type, location" },
  { id: "details", label: "Details", icon: "📐", desc: "Size, floor, furnishing" },
  { id: "amenities", label: "Amenities", icon: "✨", desc: "Features & facilities" },
  { id: "lease", label: "Lease Terms", icon: "📋", desc: "Rent, deposit, duration" },
  { id: "media", label: "Media", icon: "📷", desc: "Photos & documents" },
  { id: "review", label: "Review", icon: "✅", desc: "Preview & publish" },
];

const INITIAL = {
  title: "", propertyType: "apartment", bhk: "2 BHK", totalUnits: "1",
  address: "", city: "", state: "", pincode: "", landmark: "",
  sizeCarpet: "", sizeBuiltup: "", floorNumber: "", totalFloors: "", facing: "", propertyAge: "",
  furnishing: "", parking: "", petPolicy: "",
  amenities: [],
  rent: "", deposit: "", maintenanceCharges: "", maintenanceFreq: "monthly", negotiable: "no",
  minLease: "11", maxLease: "12", noticePeriod: "2", preferredTenants: "any",
  rentIncludes: [], houseRules: "", availableFrom: "",
  photos: null, documents: null, description: "", videoTour: "",
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

// ─── REVIEW STEP ──────────────────────────────────────────────────────────────
function ReviewStep({ data }) {
  const fmt = n => n ? new Intl.NumberFormat("en-IN").format(n) : "—";
  const sections = [
    { title: "Property", items: [["Title", data.title], ["Type", data.propertyType], ["Configuration", data.bhk], ["Units", data.totalUnits]] },
    { title: "Location", items: [["Address", data.address], ["City", data.city], ["State", data.state], ["PIN", data.pincode], ["Landmark", data.landmark || "—"]] },
    { title: "Details", items: [["Carpet Area", data.sizeCarpet ? `${data.sizeCarpet} sq.ft` : "—"], ["Built-up", data.sizeBuiltup ? `${data.sizeBuiltup} sq.ft` : "—"], ["Floor", data.floorNumber ? `${data.floorNumber} / ${data.totalFloors}` : "—"], ["Facing", data.facing || "—"], ["Furnishing", data.furnishing || "—"], ["Parking", data.parking || "—"]] },
    { title: "Lease", items: [["Monthly Rent", data.rent ? `₹${fmt(data.rent)}` : "—"], ["Deposit", data.deposit ? `₹${fmt(data.deposit)}` : "—"], ["Maintenance", data.maintenanceCharges ? `₹${fmt(data.maintenanceCharges)}/mo` : "—"], ["Lease Duration", `${data.minLease}–${data.maxLease} months`], ["Notice Period", `${data.noticePeriod} months`], ["Preferred Tenants", data.preferredTenants], ["Negotiable", data.negotiable]] },
  ];
  return (
    <div>
      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>{sec.title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
            {sec.items.map(([k, v]) => (
              <div key={k}><div style={{ fontSize: 10.5, color: "var(--text-lite)", marginBottom: 2 }}>{k}</div><div style={{ fontSize: 13.5, color: "var(--navy)", fontWeight: 500 }}>{v || "—"}</div></div>
            ))}
          </div>
        </div>
      ))}
      {data.amenities.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>Amenities ({data.amenities.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {data.amenities.map(a => <span key={a} className="chip-small">{a}</span>)}
          </div>
        </div>
      )}
      {data.description && (
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>Description</div>
          <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.6 }}>{data.description}</div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AddProperty({ onNavigate }) {
  const routerNavigate = useNavigate();
  const navigate = onNavigate || ((action, id) => {
    if (action === "list") {
      routerNavigate("/owner/properties");
      return;
    }
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
    }
  });
  const [step, setStep] = useState(0);
  const [data, setData] = useState(INITIAL);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState("publish");
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [createdPropertyId, setCreatedPropertyId] = useState(null);

  const ch = useCallback(e => {
    const { name, value } = e.target;
    setData(d => ({ ...d, [name]: value }));
    if (saveError) setSaveError("");
    if (errors[name]) setErrors(er => { const c = { ...er }; delete c[name]; return c; });
  }, [errors, saveError]);

  const chFile = useCallback(e => {
    if (saveError) setSaveError("");
    setData(d => ({ ...d, [e.target.name]: e.target.files }));
  }, [saveError]);

  const setAmenities = useCallback(val => {
    if (saveError) setSaveError("");
    setData(d => ({ ...d, amenities: val }));
  }, [saveError]);

  const toggleRentIncludes = useCallback(item => {
    setData(d => ({ ...d, rentIncludes: d.rentIncludes.includes(item) ? d.rentIncludes.filter(i => i !== item) : [...d.rentIncludes, item] }));
  }, []);

  // Validation per step
  const validate = stepIdx => {
    const errs = {};
    if (stepIdx === 0) {
      if (!data.title.trim()) errs.title = "Listing title is required";
      if (!data.propertyType) errs.propertyType = "Select property type";
      if (!data.bhk) errs.bhk = "Select configuration";
      if (!data.address.trim()) errs.address = "Address is required";
      if (!data.city.trim()) errs.city = "City is required";
      if (!data.state) errs.state = "State is required";
      if (!data.pincode || !/^\d{6}$/.test(data.pincode)) errs.pincode = "Valid 6-digit PIN required";
    }
    if (stepIdx === 1) {
      if (!data.sizeCarpet || isNaN(data.sizeCarpet)) errs.sizeCarpet = "Carpet area required";
      if (!data.totalFloors || isNaN(data.totalFloors)) errs.totalFloors = "Total floors required";
      if (!data.furnishing) errs.furnishing = "Furnishing status required";
    }
    if (stepIdx === 3) {
      if (!data.rent || isNaN(data.rent) || data.rent <= 0) errs.rent = "Valid monthly rent required";
      if (!data.deposit || isNaN(data.deposit) || data.deposit <= 0) errs.deposit = "Security deposit required";
    }
    return errs;
  };

  const goNext = () => {
    const errs = validate(step);
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => { setStep(s => Math.max(s - 1, 0)); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const handleSave = async (mode = "publish") => {
    setSaveMode(mode);
    setSaveError("");
    const basicsErrors = validate(0);
    if (Object.keys(basicsErrors).length > 0) {
      setErrors(prev => ({ ...prev, ...basicsErrors }));
      setStep(0);
      setSaveError("Complete the required basics before saving this property.");
      return;
    }

    if (mode === "publish") {
      const detailErrors = validate(1);
      const leaseErrors = validate(3);
      const publishErrors = { ...detailErrors, ...leaseErrors };
      if (Object.keys(publishErrors).length > 0) {
        setErrors(prev => ({ ...prev, ...publishErrors }));
        setStep(Object.keys(detailErrors).length > 0 ? 1 : 3);
        setSaveError("Fill all required details before publishing.");
        return;
      }
    }

    setSaving(true);
    try {
      const response = await createOwnerProperty(buildOwnerPropertyPayload(data));
      setCreatedPropertyId(response?.property?.id || null);
      setSaved(true);
    } catch (error) {
      setSaveError(error?.message || "Unable to save property right now.");
    } finally {
      setSaving(false);
    }
  };

  const progressPct = ((step) / (STEPS.length - 1)) * 100;

  const STATES_IN = ["Maharashtra", "Delhi", "Karnataka", "Tamil Nadu", "Telangana", "Gujarat", "Rajasthan", "West Bengal", "Uttar Pradesh", "Haryana", "Andhra Pradesh", "Kerala", "Punjab", "Other"];
  const fmt = n => n ? new Intl.NumberFormat("en-IN").format(n) : "";

  if (saved) {
    return (
      <div className="dash-root" style={{ alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>
        <div style={{ textAlign: "center", padding: 48, maxWidth: 500 }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--green-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 24px" }}>✓</div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 28, fontWeight: 600, color: "var(--navy)", marginBottom: 12 }}>
            {saveMode === "draft" ? "Draft Saved" : "Property Listed!"}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-mid)", lineHeight: 1.6, marginBottom: 28 }}>
            {saveMode === "draft"
              ? <><strong>{data.title}</strong> has been saved as a draft. You can publish it anytime from your properties.</>
              : <><strong>{data.title}</strong> has been successfully added to your portfolio and is now visible to prospective tenants.</>}
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="btn-primary" onClick={() => navigate("list")}>View All Properties</button>
            {createdPropertyId && <button className="btn-secondary" onClick={() => navigate("detail", createdPropertyId)}>Open Property</button>}
            <button className="btn-secondary" onClick={() => { setData(INITIAL); setSaved(false); setStep(0); setCreatedPropertyId(null); setSaveError(""); }}>Add Another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="add-property-root">
      {/* ── Left — 3D Preview Panel ── */}
      <div className="ap-preview-panel">
        <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
          <BuildingPreview formData={data} />
          <div className="ap-preview-overlay" />
          <div className="ap-preview-info">
            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.2em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 8 }}>Live Preview</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, color: "#fff", lineHeight: 1.3, marginBottom: 4 }}>
              {data.title || "Your Property"}
            </div>
            {data.city && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>{data.city}{data.state ? `, ${data.state}` : ""}</div>}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[data.bhk, data.propertyType, data.furnishing && `${data.furnishing} furnished`, data.sizeCarpet && `${data.sizeCarpet} sq.ft`].filter(Boolean).map(tag => (
                <span key={tag} style={{ background: "rgba(184,148,63,0.2)", border: "1px solid rgba(184,148,63,0.3)", color: "rgba(255,255,255,0.75)", fontSize: 11, padding: "3px 9px", borderRadius: 3 }}>{tag}</span>
              ))}
            </div>

            {data.rent && (
              <div style={{ marginTop: 16, padding: "12px 14px", background: "rgba(255,255,255,0.06)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.15em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", marginBottom: 4 }}>Monthly Rent</div>
                <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 700, color: "var(--gold)" }}>₹{fmt(data.rent)}</div>
              </div>
            )}

            {data.amenities.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.15em", color: "rgba(255,255,255,0.3)", marginBottom: 8 }}>AMENITIES ({data.amenities.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {data.amenities.slice(0, 6).map(a => (
                    <span key={a} style={{ fontSize: 10.5, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", padding: "2px 7px", borderRadius: 3 }}>{a}</span>
                  ))}
                  {data.amenities.length > 6 && <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)" }}>+{data.amenities.length - 6} more</span>}
                </div>
              </div>
            )}
          </div>

          {/* Progress bar along bottom of preview */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.1)" }}>
            <div style={{ height: "100%", background: "var(--gold)", width: `${progressPct}%`, transition: "width 0.4s ease" }} />
          </div>
        </div>
      </div>

      {/* ── Right — Form Panel ── */}
      <div className="ap-form-panel">
        {/* Form header */}
        <div className="ap-form-header">
          <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => navigate("list")}>← Back</button>
          <div style={{ flex: 1, marginLeft: 16 }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: 17, fontWeight: 600, color: "var(--navy)" }}>Add New Property</div>
            <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>Step {step + 1} of {STEPS.length} — {STEPS[step].label}</div>
          </div>
          <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => handleSave("draft")}>Save Draft</button>
        </div>

        {saveError && (
          <div style={{ margin: "12px 18px 0", padding: "10px 12px", border: "1px solid rgba(184,50,50,0.25)", background: "rgba(184,50,50,0.08)", color: "var(--red)", borderRadius: 6, fontSize: 12.5 }}>
            {saveError}
          </div>
        )}

        {/* Step nav */}
        <div className="ap-step-nav">
          {STEPS.map((s, i) => (
            <button key={s.id} className={`ap-step-btn ${i === step ? "ap-step-active" : i < step ? "ap-step-done" : ""}`}
              onClick={() => i < step && setStep(i)}>
              <span className="ap-step-dot">{i < step ? "✓" : i + 1}</span>
              <span className="ap-step-label">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Form body */}
        <div className="ap-form-body">
          {/* ── Step 0: Basics ── */}
          {step === 0 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>{STEPS[0].icon}</span> Property Basics</div>

              <div className="form-row-single">
                <div className="f-grp">
                  <Label required>Listing Title</Label>
                  <input className={`f-ctrl ${errors.title ? "f-ctrl-error" : ""}`} name="title" value={data.title} onChange={ch} placeholder='e.g. "Spacious 2BHK with Sea View in Bandra West"' />
                  {errors.title && <div className="f-error">{errors.title}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>Make it descriptive — good titles get 3× more inquiries</div>
                </div>
              </div>

              <div className="form-row">
                <div className="f-grp">
                  <Label required>Property Type</Label>
                  <div className="type-selector">
                    {[["apartment", "🏢", "Apartment / Flat"], ["independent", "🏡", "Independent House"], ["pg", "🛏️", "PG / Hostel"], ["commercial", "🏗️", "Commercial"], ["studio", "🏠", "Studio"]].map(([v, ic, l]) => (
                      <button key={v} type="button" className={`type-btn ${data.propertyType === v ? "type-btn-on" : ""}`} onClick={() => setData(d => ({ ...d, propertyType: v }))}>
                        <span style={{ fontSize: 18 }}>{ic}</span>
                        <span>{l}</span>
                      </button>
                    ))}
                  </div>
                  {errors.propertyType && <div className="f-error">{errors.propertyType}</div>}
                </div>
              </div>

              <div className="form-row">
                <div className="f-grp">
                  <Label required>Configuration</Label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {["Studio", "1 RK", "1 BHK", "2 BHK", "3 BHK", "4 BHK", "4+ BHK"].map(b => (
                      <button key={b} type="button"
                        style={{ padding: "7px 16px", fontFamily: "var(--sans)", fontSize: 13, fontWeight: data.bhk === b ? 600 : 400, color: data.bhk === b ? "#fff" : "var(--text-mid)", background: data.bhk === b ? "var(--navy)" : "var(--surface)", border: `1.5px solid ${data.bhk === b ? "var(--navy)" : "var(--border)"}`, borderRadius: "var(--radius)", cursor: "pointer", transition: "all 0.15s" }}
                        onClick={() => setData(d => ({ ...d, bhk: b }))}>
                        {b}
                      </button>
                    ))}
                  </div>
                  {errors.bhk && <div className="f-error">{errors.bhk}</div>}
                </div>
                <Input label="Total Units Available" name="totalUnits" type="number" value={data.totalUnits} onChange={ch} placeholder="1" hint="How many identical units are available?" />
              </div>

              <div className="ap-section-divider">
                <span>Location</span>
              </div>

              <div className="form-row-single">
                <TextArea label="Full Address" name="address" value={data.address} onChange={ch} placeholder="Flat/Plot number, Building name, Street, Locality..." required rows={2} />
                {errors.address && <div className="f-error">{errors.address}</div>}
              </div>

              <div className="form-row">
                <div className="f-grp">
                  <Label required>City</Label>
                  <input className={`f-ctrl ${errors.city ? "f-ctrl-error" : ""}`} name="city" value={data.city} onChange={ch} placeholder="e.g. Mumbai" />
                  {errors.city && <div className="f-error">{errors.city}</div>}
                </div>
                <div className="f-grp">
                  <Label required>State</Label>
                  <select className={`f-ctrl ${errors.state ? "f-ctrl-error" : ""}`} name="state" value={data.state} onChange={ch}>
                    <option value="">Select State</option>
                    {STATES_IN.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {errors.state && <div className="f-error">{errors.state}</div>}
                </div>
              </div>

              <div className="form-row">
                <div className="f-grp">
                  <Label required>PIN Code</Label>
                  <input className={`f-ctrl ${errors.pincode ? "f-ctrl-error" : ""}`} name="pincode" value={data.pincode} onChange={ch} placeholder="400001" maxLength={6} />
                  {errors.pincode && <div className="f-error">{errors.pincode}</div>}
                </div>
                <Input label="Nearby Landmark" name="landmark" value={data.landmark} onChange={ch} placeholder="e.g. Near Hiranandani Hospital" hint="Helps tenants locate the property easily" />
              </div>
            </div>
          )}

          {/* ── Step 1: Details ── */}
          {step === 1 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>{STEPS[1].icon}</span> Property Specifications</div>

              <div className="form-row">
                <div className="f-grp">
                  <Label required>Carpet Area (sq. ft.)</Label>
                  <input className={`f-ctrl ${errors.sizeCarpet ? "f-ctrl-error" : ""}`} type="number" name="sizeCarpet" value={data.sizeCarpet} onChange={ch} placeholder="850" />
                  {errors.sizeCarpet && <div className="f-error">{errors.sizeCarpet}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>Usable floor area excluding walls</div>
                </div>
                <Input label="Built-up Area (sq. ft.)" name="sizeBuiltup" type="number" value={data.sizeBuiltup} onChange={ch} placeholder="1000" hint="Including wall thickness and common areas" />
              </div>

              <div className="form-row">
                <Input label="Floor Number" name="floorNumber" value={data.floorNumber} onChange={ch} placeholder="e.g. 4" />
                <div className="f-grp">
                  <Label required>Total Floors in Building</Label>
                  <input className={`f-ctrl ${errors.totalFloors ? "f-ctrl-error" : ""}`} type="number" name="totalFloors" value={data.totalFloors} onChange={ch} placeholder="12" />
                  {errors.totalFloors && <div className="f-error">{errors.totalFloors}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>Used for the live 3D model on the left</div>
                </div>
              </div>

              <div className="form-row">
                <Select label="Facing Direction" name="facing" value={data.facing} onChange={ch}
                  options={["North", "South", "East", "West", "North-East", "North-West", "South-East", "South-West"].map(f => ({ value: f, label: f }))} />
                <Input label="Property Age (years)" name="propertyAge" type="number" value={data.propertyAge} onChange={ch} placeholder="5" hint="Approx. years since construction" />
              </div>

              <div className="ap-section-divider"><span>Furnishing & Parking</span></div>

              <div className="form-row">
                <div className="f-grp">
                  <Label required>Furnishing Status</Label>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[["fully", "Fully Furnished", "All furniture, appliances, fixtures included"], ["semi", "Semi Furnished", "Basic fixtures like fans, lights, wardrobes"], ["unfurnished", "Unfurnished", "Bare shell — tenant brings their own"]].map(([v, l, desc]) => (
                      <label key={v} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 14px", border: `1.5px solid ${data.furnishing === v ? "var(--navy)" : "var(--border)"}`, borderRadius: 4, cursor: "pointer", background: data.furnishing === v ? "rgba(12,27,46,0.04)" : "var(--white)", transition: "all 0.15s" }}>
                        <input type="radio" name="furnishing" value={v} checked={data.furnishing === v} onChange={ch} style={{ marginTop: 2, accentColor: "var(--navy)" }} />
                        <div><div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--navy)" }}>{l}</div><div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 2 }}>{desc}</div></div>
                      </label>
                    ))}
                  </div>
                  {errors.furnishing && <div className="f-error">{errors.furnishing}</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <Select label="Parking Availability" name="parking" value={data.parking} onChange={ch}
                    options={[{ value: "none", label: "No Parking" }, { value: "two_wheeler", label: "2-Wheeler Only" }, { value: "four_wheeler", label: "4-Wheeler Only" }, { value: "both", label: "Both 2W & 4W" }, { value: "covered", label: "Covered / Reserved" }]} />
                  <Select label="Pet Policy" name="petPolicy" value={data.petPolicy} onChange={ch}
                    options={[{ value: "no_pets", label: "No Pets Allowed" }, { value: "small", label: "Small Pets Only" }, { value: "any", label: "All Pets Welcome" }, { value: "negotiable", label: "Negotiable" }]} />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: Amenities ── */}
          {step === 2 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>{STEPS[2].icon}</span> Amenities & Features</div>
              <div style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 18, lineHeight: 1.55 }}>
                Select all amenities available at this property. These are highlighted on your listing and reflected in the 3D model.
              </div>
              <AmenityToggle value={data.amenities} onChange={setAmenities} />

              <div className="ap-section-divider" style={{ marginTop: 24 }}><span>What's Included in Rent?</span></div>
              <div style={{ fontSize: 12.5, color: "var(--text-mid)", marginBottom: 14 }}>Select utilities/services included in the monthly rent</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {["Maintenance Charges", "Water Bill", "Electricity (Upto ₹500)", "Internet / WiFi", "DTH / Cable TV", "Housekeeping", "Society Charges"].map(item => (
                  <button key={item} type="button"
                    className={data.rentIncludes.includes(item) ? "amenity-chip amenity-on" : "amenity-chip"}
                    onClick={() => toggleRentIncludes(item)}>
                    {item}
                  </button>
                ))}
              </div>

              <div className="ap-section-divider" style={{ marginTop: 24 }}><span>Property Description</span></div>
              <TextArea label="Describe your property" name="description" value={data.description} onChange={ch} rows={5}
                placeholder="Highlight what makes this property special — natural light, views, proximity to metro/schools/markets, recent renovations, quiet neighbourhood, etc.&#10;&#10;Good descriptions attract serious tenants and reduce back-and-forth inquiries." />
            </div>
          )}

          {/* ── Step 3: Lease Terms ── */}
          {step === 3 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>{STEPS[3].icon}</span> Lease & Financial Terms</div>

              <div className="form-row">
                <div className="f-grp">
                  <Label required>Monthly Rent (₹)</Label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-mid)", fontWeight: 500 }}>₹</span>
                    <input className={`f-ctrl ${errors.rent ? "f-ctrl-error" : ""}`} type="number" name="rent" value={data.rent} onChange={ch} placeholder="28000" style={{ paddingLeft: 28 }} />
                  </div>
                  {errors.rent && <div className="f-error">{errors.rent}</div>}
                  {data.rent && <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>Annual: ₹{fmt(data.rent * 12)}</div>}
                </div>
                <div className="f-grp">
                  <Label required>Security Deposit (₹)</Label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-mid)", fontWeight: 500 }}>₹</span>
                    <input className={`f-ctrl ${errors.deposit ? "f-ctrl-error" : ""}`} type="number" name="deposit" value={data.deposit} onChange={ch} placeholder="84000" style={{ paddingLeft: 28 }} />
                  </div>
                  {errors.deposit && <div className="f-error">{errors.deposit}</div>}
                  {data.rent && data.deposit && <div style={{ fontSize: 11, color: "var(--text-lite)", marginTop: 3 }}>{(data.deposit / data.rent).toFixed(1)}× monthly rent</div>}
                </div>
              </div>

              <div className="form-row">
                <div className="f-grp">
                  <Label>Maintenance Charges (₹)</Label>
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-mid)", fontWeight: 500 }}>₹</span>
                    <input className="f-ctrl" type="number" name="maintenanceCharges" value={data.maintenanceCharges} onChange={ch} placeholder="1500" style={{ paddingLeft: 28 }} />
                  </div>
                </div>
                <Select label="Maintenance Frequency" name="maintenanceFreq" value={data.maintenanceFreq} onChange={ch}
                  options={[{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "included", label: "Included in Rent" }]} />
              </div>

              <div className="form-row">
                <Select label="Is Rent Negotiable?" name="negotiable" value={data.negotiable} onChange={ch}
                  options={[{ value: "no", label: "No — Fixed" }, { value: "slightly", label: "Slightly Negotiable" }, { value: "yes", label: "Yes" }]} />
                <Input label="Available From" name="availableFrom" type="date" value={data.availableFrom} onChange={ch} />
              </div>

              <div className="ap-section-divider"><span>Agreement Duration</span></div>

              <div className="form-row">
                <Select label="Minimum Lease Duration" name="minLease" value={data.minLease} onChange={ch}
                  options={[3, 6, 11, 12, 18, 24].map(n => ({ value: String(n), label: `${n} Months` }))} />
                <Select label="Maximum Lease Duration" name="maxLease" value={data.maxLease} onChange={ch}
                  options={[6, 11, 12, 18, 24, 36, 60].map(n => ({ value: String(n), label: `${n} Months` }))} />
              </div>

              <div className="form-row">
                <Select label="Notice Period Required" name="noticePeriod" value={data.noticePeriod} onChange={ch}
                  options={[{ value: "1", label: "1 Month" }, { value: "2", label: "2 Months" }, { value: "3", label: "3 Months" }]} />
                <Select label="Preferred Tenant Type" name="preferredTenants" value={data.preferredTenants} onChange={ch}
                  options={[{ value: "any", label: "No Preference" }, { value: "family", label: "Families Only" }, { value: "bachelor", label: "Bachelors Welcome" }, { value: "female", label: "Female Only" }, { value: "working", label: "Working Professionals" }]} />
              </div>

              <div className="ap-section-divider"><span>House Rules</span></div>
              <TextArea label="Additional Terms & House Rules" name="houseRules" value={data.houseRules} onChange={ch} rows={4}
                placeholder="e.g. No smoking inside the property&#10;No loud music after 10 PM&#10;No structural modifications without written approval&#10;Visitors must register at security" />
            </div>
          )}

          {/* ── Step 4: Media ── */}
          {step === 4 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>{STEPS[4].icon}</span> Photos & Documents</div>
              <div style={{ padding: "12px 16px", background: "rgba(12,27,46,0.04)", borderLeft: "3px solid var(--navy-lite)", borderRadius: "0 4px 4px 0", marginBottom: 20, fontSize: 13, color: "var(--text-mid)", lineHeight: 1.55 }}>
                💡 Properties with 6+ photos get <strong>4× more inquiries</strong>. Cover all rooms, balcony, parking, and building entrance.
              </div>

              <FileUploadZone label="Property Photos (up to 20)" name="photos" value={data.photos} onChange={chFile} accept="image/jpeg,image/png,image/webp" hint="JPG, PNG, WEBP — max 5 MB per image — min 1280×720px recommended" />

              <div className="form-row-single" style={{ marginTop: 16 }}>
                <Input label="Virtual / Video Tour Link" name="videoTour" value={data.videoTour} onChange={ch} placeholder="https://youtube.com/... or Google Maps 3D link" hint="Optional — embeds a walkthrough video on your listing" />
              </div>

              <div className="ap-section-divider" style={{ marginTop: 8 }}><span>Legal Documents</span></div>
              <div style={{ fontSize: 12.5, color: "var(--text-mid)", marginBottom: 16, lineHeight: 1.5 }}>Upload ownership proof and NOC to get a Verified Owner badge. Documents are kept strictly confidential.</div>
              <FileUploadZone label="Ownership & Legal Documents" name="documents" value={data.documents} onChange={chFile} accept=".pdf,.jpg,.png" hint="Property card, sale deed, POA, NOC — PDF or JPG — max 10 MB" />
            </div>
          )}

          {/* ── Step 5: Review ── */}
          {step === 5 && (
            <div className="ap-form-section">
              <div className="ap-section-title"><span>{STEPS[5].icon}</span> Review & Publish</div>
              <div style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 20, lineHeight: 1.55 }}>
                Review all details before publishing. You can always edit after listing goes live.
              </div>
              <ReviewStep data={data} />

              <div style={{ marginTop: 24, padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                  <input type="checkbox" style={{ marginTop: 2, accentColor: "var(--navy)" }} />
                  <span style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.55 }}>
                    I confirm I am the legal owner or authorised representative of this property. All information provided is accurate and I agree to the <u style={{ color: "var(--gold)" }}>Owner Terms of Service</u> and <u style={{ color: "var(--gold)" }}>Listing Policy</u>.
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* ── Nav Buttons ── */}
          <div className="ap-nav-row">
            {step > 0
              ? <button className="btn-secondary" style={{ padding: "12px 20px" }} onClick={goBack}>← Back</button>
              : <div />}
            <div style={{ display: "flex", gap: 10 }}>
              {step < STEPS.length - 1 ? (
                <button className="btn-primary" style={{ padding: "12px 28px", fontSize: 14, fontWeight: 600 }} onClick={goNext}>
                  Continue to {STEPS[step + 1].label} →
                </button>
              ) : (
                <button className="btn-primary btn-gold" style={{ padding: "12px 32px", fontSize: 14, fontWeight: 700 }} onClick={() => handleSave("publish")} disabled={saving}>
                  {saving ? "Publishing…" : "Publish Property ✓"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
