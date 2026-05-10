import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getOwnerPropertyById } from "../services/apiClient";
import "./Dashboard.css";
import "./Properties.css";
import "./PropertyDetail.css";

const EMPTY_PROPERTY = {
  id: "",
  status: "vacant",
  publishState: "draft",
  title: "Property",
  type: "—",
  bhk: "—",
  address: "Address not available",
  city: "",
  state: "",
  pincode: "",
  landmark: "",
  sizeCarpet: 0,
  sizeBuiltup: 0,
  floorNumber: 0,
  totalFloors: 1,
  facing: "—",
  propertyAge: 0,
  furnishing: "—",
  parking: "—",
  petPolicy: "—",
  amenities: [],
  rent: 0,
  deposit: 0,
  maintenanceCharges: 0,
  minLease: 0,
  maxLease: 0,
  noticePeriod: 0,
  preferredTenants: "—",
  houseRules: [],
  description: "",
  rentIncludes: [],
  createdAt: null,
  listedAt: null,
  views: 0,
  inquiries: 0,
  rating: 0,
  registrationNo: "—",
};

const EMPTY_TENANT = {
  id: null,
  name: "No active tenant",
  initials: "—",
  email: "—",
  phone: "—",
  altPhone: "—",
  occupation: "—",
  monthlyIncome: 0,
  idType: "—",
  idNumber: "—",
  emergencyName: "—",
  emergencyRelation: "—",
  emergencyPhone: "—",
  leaseStart: null,
  leaseEnd: null,
  status: "vacant",
  paymentStatus: "—",
  moveInDate: null,
  policeVerified: false,
  agreementSigned: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = n => n != null ? new Intl.NumberFormat("en-IN").format(n) : "—";
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const daysUntil = d => {
  if (!d) return null;
  const value = Math.ceil((new Date(d) - new Date()) / 86400000);
  return Number.isFinite(value) ? value : null;
};
const leaseProgress = (tenant = {}) => {
  if (!tenant?.leaseStart || !tenant?.leaseEnd) return 0;
  const total = new Date(tenant.leaseEnd) - new Date(tenant.leaseStart);
  if (!Number.isFinite(total) || total <= 0) return 0;
  const elapsed = new Date() - new Date(tenant.leaseStart);
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
};

const PRETTY_TYPE = {
  apartment: "Apartment",
  independent: "Independent House",
  pg: "PG / Hostel",
  commercial: "Commercial",
  studio: "Studio",
};

const PRETTY_FURNISHING = {
  fully: "Fully Furnished",
  semi: "Semi Furnished",
  unfurnished: "Unfurnished",
};

const PRETTY_PARKING = {
  none: "None",
  two_wheeler: "2-Wheeler",
  four_wheeler: "4-Wheeler",
  both: "Both",
  covered: "Covered",
};

const normalizeText = (value, fallback = "") => {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

const toPrettyType = (value, fallback = "Apartment") => {
  const key = normalizeText(value).toLowerCase();
  return PRETTY_TYPE[key] || normalizeText(value, fallback);
};

const toPrettyFurnishing = (value, fallback = "Semi Furnished") => {
  const key = normalizeText(value).toLowerCase();
  return PRETTY_FURNISHING[key] || normalizeText(value, fallback);
};

const toPrettyParking = (value, fallback = "None") => {
  const key = normalizeText(value).toLowerCase();
  return PRETTY_PARKING[key] || normalizeText(value, fallback);
};

const toRulesArray = (value, fallback) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const lines = value.split("\n").map(v => v.trim()).filter(Boolean);
    if (lines.length > 0) return lines;
  }
  return fallback;
};

const mapPropertyForDetail = (property, fallback = EMPTY_PROPERTY) => {
  if (!property) return fallback;

  return {
    ...fallback,
    id: property.id ?? fallback.id,
    status: normalizeText(property.status, fallback.status).toLowerCase(),
    publishState: normalizeText(property.publishState, fallback.publishState),
    title: normalizeText(property.title, fallback.title),
    type: toPrettyType(property.propertyType, fallback.type),
    bhk: normalizeText(property.bhk, fallback.bhk),
    address: normalizeText(property.address, fallback.address),
    city: normalizeText(property.city, fallback.city),
    state: normalizeText(property.state, fallback.state),
    pincode: normalizeText(property.pincode, fallback.pincode),
    landmark: normalizeText(property.landmark, fallback.landmark),
    sizeCarpet: Number(property.sizeCarpet || fallback.sizeCarpet || 0),
    sizeBuiltup: Number(property.sizeBuiltup || fallback.sizeBuiltup || 0),
    floorNumber: Number(property.floorNumber || fallback.floorNumber || 0),
    totalFloors: Number(property.totalFloors || fallback.totalFloors || 1),
    facing: normalizeText(property.facing, fallback.facing),
    propertyAge: Number(property.propertyAge || fallback.propertyAge || 0),
    furnishing: toPrettyFurnishing(property.furnishing, fallback.furnishing),
    parking: toPrettyParking(property.parking, fallback.parking),
    petPolicy: normalizeText(property.petPolicy, fallback.petPolicy),
    amenities: Array.isArray(property.amenities) ? property.amenities : fallback.amenities,
    rent: Number(property.rent || fallback.rent || 0),
    deposit: Number(property.deposit || fallback.deposit || 0),
    maintenanceCharges: Number(property.maintenanceCharges || fallback.maintenanceCharges || 0),
    minLease: Number(property.minLease || fallback.minLease || 0),
    maxLease: Number(property.maxLease || fallback.maxLease || 0),
    noticePeriod: Number(property.noticePeriod || fallback.noticePeriod || 0),
    preferredTenants: normalizeText(property.preferredTenants, fallback.preferredTenants),
    houseRules: toRulesArray(property.houseRules, fallback.houseRules),
    description: normalizeText(property.description, fallback.description),
    rentIncludes: Array.isArray(property.rentIncludes) ? property.rentIncludes : fallback.rentIncludes,
    createdAt: property.createdAt || fallback.createdAt,
    listedAt: property.createdAt || property.listedAt || fallback.listedAt,
    views: Number(property.views || fallback.views || 0),
    inquiries: Number(property.inquiries || fallback.inquiries || 0),
    rating: Number(property.rating || fallback.rating || 0),
    registrationNo: normalizeText(property.registrationNo, fallback.registrationNo),
  };
};

const mapMaintenanceForDetail = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row, index) => ({
    id: row.id || index + 1,
    title: normalizeText(row.title || row.subject || row.issue, "Maintenance request"),
    category: normalizeText(row.category, "General"),
    priority: normalizeText(row.priority, "medium").toLowerCase(),
    status: normalizeText(row.status, "pending").toLowerCase(),
    date: row.created_at || row.date || row.requested_at || null,
    assignedTo: normalizeText(row.assigned_to || row.assignedTo, ""),
    cost: row.cost ?? row.amount ?? null,
    desc: normalizeText(row.description || row.note, "No additional details."),
  }));
};

const mapPaymentsForDetail = (rows, fallbackRent = 0, fallbackMaintenance = 0) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row, index) => {
    const amount = Number(row.amount || row.rent_amount || row.rent || fallbackRent || 0);
    const maintenance = Number(row.maintenance || row.maintenance_amount || fallbackMaintenance || 0);
    return {
      id: row.id || index + 1,
      month: normalizeText(row.month || row.billing_month || row.period_label, `Payment #${index + 1}`),
      amount,
      maintenance,
      total: Number(row.total || row.total_amount || amount + maintenance),
      dueDate: row.due_date || row.dueDate || null,
      paidDate: row.paid_at || row.paidDate || null,
      status: normalizeText(row.status, "upcoming").toLowerCase(),
      receipt: row.receipt_no || row.receipt || null,
      txnId: row.transaction_id || row.txnId || null,
    };
  });
};

const mapDocumentsForDetail = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return rows.map((row, index) => ({
    id: row.id || index + 1,
    name: normalizeText(row.name || row.file_name, `Document ${index + 1}`),
    category: normalizeText(row.category, "Other"),
    type: normalizeText(row.file_type, "pdf").toLowerCase(),
    size: normalizeText(row.file_size_label || row.size_label, "—"),
    date: row.created_at ? fmtDate(row.created_at) : normalizeText(row.date, "—"),
    sharedWithTenant: Boolean(row.shared_with_tenant || row.sharedWithTenant),
  }));
};

const mapTenantForDetail = (activeTenancy) => {
  if (!activeTenancy) return EMPTY_TENANT;
  return {
    ...EMPTY_TENANT,
    leaseStart: activeTenancy.lease_start || EMPTY_TENANT.leaseStart,
    leaseEnd: activeTenancy.lease_end || EMPTY_TENANT.leaseEnd,
    paymentStatus: normalizeText(activeTenancy.payment_status, EMPTY_TENANT.paymentStatus),
    status: normalizeText(activeTenancy.status, EMPTY_TENANT.status),
    moveInDate: activeTenancy.move_in_date || EMPTY_TENANT.moveInDate,
  };
};

// ─── Mini Sparkline ───────────────────────────────────────────────────────────
function Sparkline({ data, color = "var(--navy)", height = 36 }) {
  const safeData = Array.isArray(data) && data.length ? data : [0];
  const max = Math.max(...safeData, 1);
  const W = 140, H = height;
  const pts = safeData.map((v, i) => `${(i / (safeData.length - 1 || 1)) * W},${H - (v / max) * H}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {safeData.map((v, i) => <circle key={i} cx={(i / (safeData.length - 1 || 1)) * W} cy={H - (v / max) * H} r="3" fill={color} />)}
    </svg>
  );
}

// ─── Revenue MiniChart ────────────────────────────────────────────────────────
function RevenueChart({ data }) {
  const safeData = Array.isArray(data) && data.length ? data : [{ m: "-", collected: 0, expected: 0 }];
  const max = Math.max(...safeData.map(d => d.expected), 1) * 1.1;
  const W = 360, H = 120, padL = 48, padB = 24, padT = 8, padR = 8;
  const plotW = W - padL - padR, plotH = H - padB - padT;
  const bw = (plotW / safeData.length) * 0.32;
  const gap = plotW / safeData.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      {[0, 0.5, 1].map(t => (
        <g key={t}>
          <line x1={padL} y1={padT + plotH * (1 - t)} x2={W - padR} y2={padT + plotH * (1 - t)} stroke="var(--border)" strokeWidth="1" />
          <text x={padL - 5} y={padT + plotH * (1 - t) + 4} textAnchor="end" fontSize="9" fill="var(--text-lite)" fontFamily="var(--mono)">
            {t === 0 ? "0" : `${((max * t) / 1000).toFixed(0)}k`}
          </text>
        </g>
      ))}
      {safeData.map((d, i) => {
        const cx = padL + i * gap + gap / 2;
        const expH = (d.expected / max) * plotH;
        const colH = (d.collected / max) * plotH;
        return (
          <g key={d.m}>
            <rect x={cx - bw} y={padT + plotH - expH} width={bw * 2} height={expH} fill="var(--navy)" opacity="0.1" rx="2" />
            {d.collected > 0 && <rect x={cx - bw * 0.75} y={padT + plotH - colH} width={bw * 1.5} height={colH} fill={d.collected < d.expected ? "var(--amber)" : "var(--navy)"} rx="2" />}
            <text x={cx} y={H - 5} textAnchor="middle" fontSize="8" fill="var(--text-lite)" fontFamily="var(--mono)">{d.m}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Property Thumb (SVG blueprint) ──────────────────────────────────────────
function PropertyHero({ property }) {
  return (
    <div style={{ height: 200, background: "linear-gradient(135deg, #0C1B2E 0%, #1e3a5f 100%)", position: "relative", overflow: "hidden" }}>
      <svg style={{ position: "absolute", inset: 0, opacity: 0.09 }} width="100%" height="100%">
        <defs><pattern id="pg-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#B8943F" strokeWidth="0.6" /></pattern></defs>
        <rect width="100%" height="100%" fill="url(#pg-grid)" />
      </svg>
      {/* Floor plan silhouette */}
      <svg style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", opacity: 0.12 }} viewBox="0 0 200 120" width="320" height="192">
        <rect x="10" y="10" width="180" height="100" stroke="#B8943F" strokeWidth="2" fill="none" />
        <rect x="10" y="10" width="80" height="50" stroke="#B8943F" strokeWidth="1.2" fill="none" />
        <rect x="90" y="10" width="100" height="50" stroke="#B8943F" strokeWidth="1.2" fill="none" />
        <rect x="10" y="60" width="60" height="50" stroke="#B8943F" strokeWidth="1.2" fill="none" />
        <rect x="70" y="60" width="120" height="50" stroke="#B8943F" strokeWidth="1.2" fill="none" />
        <line x1="40" y1="10" x2="40" y2="0" stroke="#B8943F" strokeWidth="1.5" />
        <line x1="120" y1="10" x2="120" y2="0" stroke="#B8943F" strokeWidth="1.5" />
      </svg>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(12,27,46,0.7) 0%, transparent 60%)" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "#2D7D46" }} />
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <span className="badge badge-green" style={{ fontSize: 12, padding: "4px 12px" }}><span className="badge-dot" />{property.status === "occupied" ? "Occupied" : "Available"}</span>
      </div>
      <div style={{ position: "absolute", bottom: 20, left: 24 }}>
        <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600, color: "#fff", lineHeight: 1.2 }}>{property.title}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>{property.address}</div>
      </div>
    </div>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = ["Overview", "Tenant", "Payments", "Maintenance", "Documents", "Activity"];

// ─── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewTab({ onNavigate, property, tenant, payments, maintenance, revenueMonths }) {
  const hasTenant = Boolean(tenant?.id);
  const lp = leaseProgress(tenant);
  const daysLeft = daysUntil(tenant.leaseEnd);
  const totalRevenue = payments.filter(p => p.status === "paid").reduce((s, p) => s + p.total, 0);
  const maintenanceCost = maintenance.filter(m => m.cost != null).reduce((s, m) => s + m.cost, 0);

  return (
    <>
      {/* KPI row */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-icon stat-icon-gold"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="20" height="20"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg></div><span className="stat-trend trend-up">Collected</span></div>
          <div><div className="stat-value">₹{fmt(totalRevenue)}</div><div className="stat-label">Total Revenue (this lease)</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-icon stat-icon-navy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="20" height="20"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg></div><span className="stat-trend trend-up">On Time</span></div>
          <div><div className="stat-value">{payments.filter(p => p.status === "paid").length}/{payments.filter(p => p.status !== "upcoming").length}</div><div className="stat-label">Payments On Time</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className={`stat-icon ${daysLeft != null && daysLeft < 90 ? "stat-icon-amber" : "stat-icon-green"}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="20" height="20"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div><span className={`stat-trend ${daysLeft != null && daysLeft < 90 ? "trend-down" : "trend-neutral"}`}>{daysLeft == null ? "No lease" : daysLeft < 90 ? "Expiring soon" : `${daysLeft}d`}</span></div>
          <div><div className="stat-value">{daysLeft == null ? "—" : `${daysLeft}d`}</div><div className="stat-label">Until Lease Expires</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top"><div className="stat-icon stat-icon-amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="20" height="20"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg></div></div>
          <div><div className="stat-value">₹{fmt(maintenanceCost)}</div><div className="stat-label">Maintenance Spent</div></div>
        </div>
      </div>

      <div className="two-col-wide">
        {/* Lease card */}
        <div>
          <div className="lease-progress-card" style={{ marginBottom: 18 }}>
            <div className="lp-label">Active Lease</div>
            <div className="lp-title">{hasTenant ? tenant.name : "No active tenant"}</div>
            <div className="lp-address">{hasTenant ? `${fmtDate(tenant.leaseStart)} → ${fmtDate(tenant.leaseEnd)}` : "No active lease"}</div>
            <div className="lp-progress-row">
              <span>Lease progress</span>
              <span>{lp}% elapsed · {daysLeft == null ? "—" : `${daysLeft} days left`}</span>
            </div>
            <div className="lp-progress-bar"><div className="lp-progress-fill" style={{ width: `${lp}%` }} /></div>
            <div className="lp-meta">
              <div className="lp-meta-item"><span className="lp-meta-label">Monthly Rent</span><span className="lp-meta-value">₹{fmt(property.rent)}</span></div>
              <div className="lp-meta-item"><span className="lp-meta-label">Deposit Held</span><span className="lp-meta-value">₹{fmt(property.deposit)}</span></div>
              <div className="lp-meta-item"><span className="lp-meta-label">Notice Period</span><span className="lp-meta-value">{property.noticePeriod} Months</span></div>
            </div>
          </div>

          {/* Revenue chart */}
          <div className="card">
            <div className="card-header"><div className="card-title">Revenue — Last 6 Months</div><div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--gold)", fontWeight: 600 }}>₹{fmt(property.rent)}<span style={{ color: "var(--text-lite)", fontWeight: 400 }}>/mo</span></div></div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              <RevenueChart data={revenueMonths} />
              {!revenueMonths.length && <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-lite)" }}>No payment history yet.</div>}
            </div>
          </div>
        </div>

        {/* Right col */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Property quick facts */}
          <div className="card">
            <div className="card-header"><div className="card-title">Property Details</div><button className="btn-secondary" style={{ fontSize: 11.5, padding: "5px 12px" }} onClick={() => onNavigate("edit")}>Edit</button></div>
            <div className="card-body">
              <div className="info-grid">
                {[["Type", property.bhk + " · " + property.type],
                ["Area", `${property.sizeCarpet} sq.ft carpet`],
                ["Floor", `${property.floorNumber} / ${property.totalFloors}`],
                ["Facing", property.facing],
                ["Furnishing", property.furnishing],
                ["Parking", property.parking],
                ["Pet Policy", property.petPolicy],
                ["Age", `${property.propertyAge} years`]].map(([k, v]) => (
                  <div key={k} className="info-item">
                    <span className="info-key">{k}</span>
                    <span className="info-val-strong">{v}</span>
                  </div>
                ))}
              </div>
              <div className="divider" style={{ margin: "14px 0" }} />
              <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 10 }}>Amenities</div>
              <div className="chips-row">
                {property.amenities.length
                  ? property.amenities.map(a => <span key={a} className="chip-small">{a}</span>)
                  : <span style={{ fontSize: 12.5, color: "var(--text-lite)" }}>No amenities listed</span>}
              </div>
            </div>
          </div>

          {/* Inquiry stats */}
          <div className="card">
            <div className="card-header"><div className="card-title">Listing Performance</div></div>
            <div className="card-body">
              {[["👁 Total Views", property.views, property.views >= 100], ["💬 Inquiries Received", property.inquiries, true], ["⭐ Tenant Rating", property.rating + " / 5", true], ["📅 Listed Since", fmtDate(property.listedAt), true]].map(([label, val, good]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, color: "var(--text-mid)" }}>{label}</span>
                  <span style={{ fontWeight: 600, color: good ? "var(--navy)" : "var(--amber)", fontFamily: "var(--mono)", fontSize: 13 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      {property.description && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-header"><div className="card-title">Property Description</div></div>
          <div className="card-body"><p style={{ fontSize: 13.5, color: "var(--text-mid)", lineHeight: 1.65 }}>{property.description}</p></div>
        </div>
      )}

      {/* House rules */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-header"><div className="card-title">House Rules</div></div>
        <div className="card-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {property.houseRules.length ? (
              property.houseRules.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "10px 14px", background: "var(--surface)", borderRadius: 4, border: "1px solid var(--border)" }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-lite)", fontWeight: 600, marginTop: 1 }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ fontSize: 13.5, color: "var(--text)" }}>{r}</span>
                </div>
              ))
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--text-lite)" }}>No house rules added.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── TENANT TAB ───────────────────────────────────────────────────────────────
function TenantTab({ property, tenant }) {
  const daysLeft = daysUntil(tenant.leaseEnd);
  const lp = leaseProgress(tenant);
  const hasTenant = Boolean(tenant?.id);
  return (
    <>
      {/* Tenant hero */}
      <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", marginBottom: 20, boxShadow: "var(--shadow-sm)" }}>
        <div style={{ background: "linear-gradient(135deg, var(--navy) 0%, var(--navy-lite) 100%)", padding: "24px 28px", display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "rgba(184,148,63,0.25)", border: "2px solid rgba(184,148,63,0.4)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--serif)", fontSize: 22, color: "var(--gold)", fontWeight: 600, flexShrink: 0 }}>
            {hasTenant ? tenant.initials : "—"}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 600, color: "#fff" }}>{hasTenant ? tenant.name : "No active tenant"}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 3 }}>{hasTenant ? tenant.occupation : "Assign a tenant to see details."}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {hasTenant ? (
              <>
                <span className="badge badge-green"><span className="badge-dot" />Active Tenant</span>
                {tenant.policeVerified && <span className="badge" style={{ background: "rgba(30,58,95,0.5)", color: "#7eb8ff" }}>✓ Police Verified</span>}
              </>
            ) : (
              <span className="badge badge-grey">No tenant assigned</span>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", borderTop: "1px solid var(--border)" }}>
          {[["Monthly Rent", `₹${fmt(property.rent)}`, true], ["Lease Remaining", daysLeft == null ? "—" : `${daysLeft} days`, daysLeft == null ? true : daysLeft > 90], ["Monthly Income", hasTenant ? `₹${fmt(tenant.monthlyIncome)}` : "—", true], ["Payment History", hasTenant ? "See payments" : "—", true]].map(([l, v, good]) => (
            <div key={l} style={{ padding: "16px 20px", borderRight: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 5 }}>{l}</div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 600, color: good ? "var(--navy)" : "var(--amber)" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col">
        {/* Contact info */}
        <div className="card">
          <div className="card-header"><div className="card-title">Contact Information</div></div>
          <div className="card-body">
            <div className="info-grid">
              {[["Email", tenant.email], ["Phone", tenant.phone], ["Alternate", tenant.altPhone || "—"], ["Occupation", tenant.occupation]].map(([k, v]) => (
                <div key={k} className="info-item"><span className="info-key">{k}</span><span className="info-val">{v}</span></div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: "14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 10 }}>Emergency Contact</div>
              <div className="info-grid">
                {[["Name", tenant.emergencyName], ["Relation", tenant.emergencyRelation], ["Phone", tenant.emergencyPhone]].map(([k, v]) => (
                  <div key={k} className="info-item"><span className="info-key">{k}</span><span className="info-val-strong">{v}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Lease details */}
        <div className="card">
          <div className="card-header"><div className="card-title">Lease Details</div></div>
          <div className="card-body">
            <div className="info-grid" style={{ marginBottom: 16 }}>
              {[["Lease Start", fmtDate(tenant.leaseStart)], ["Lease End", fmtDate(tenant.leaseEnd)], ["Move-in Date", fmtDate(tenant.moveInDate)], ["Agreement ID", property.registrationNo]].map(([k, v]) => (
                <div key={k} className="info-item"><span className="info-key">{k}</span><span className="info-val-strong">{v}</span></div>
              ))}
            </div>
            <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-lite)" }}>
              <span>Lease progress</span><span>{lp}%</span>
            </div>
            <div className="progress-bar" style={{ marginBottom: 14 }}>
              <div className="progress-fill progress-fill-gold" style={{ width: `${lp}%` }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              {tenant.agreementSigned && <span className="badge badge-green"><span className="badge-dot" />Agreement Signed</span>}
              {tenant.policeVerified && <span className="badge badge-navy"><span className="badge-dot" />Police Verified</span>}
            </div>
          </div>
        </div>

        {/* ID & KYC */}
        <div className="card" style={{ gridColumn: "span 2" }}>
          <div className="card-header"><div className="card-title">KYC Information</div><span style={{ fontSize: 11.5, color: "var(--text-lite)", fontFamily: "var(--mono)" }}>Confidential · Owner use only</span></div>
          <div className="card-body">
            <div className="info-grid-3">
              {[["ID Type", tenant.idType], ["ID Number", tenant.idNumber], ["Income/month", `₹${fmt(tenant.monthlyIncome)}`]].map(([k, v]) => (
                <div key={k} className="info-item"><span className="info-key">{k}</span><span className="info-val-strong">{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── PAYMENTS TAB ─────────────────────────────────────────────────────────────
function PaymentsTab({ property, payments }) {
  const paid = payments.filter(p => p.status === "paid");
  const totalCollected = paid.reduce((s, p) => s + p.total, 0);
  const onTime = paid.length;

  return (
    <>
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-card-top"><div className="stat-icon stat-icon-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="20" height="20"><polyline points="20 6 9 17 4 12" /></svg></div><span className="stat-trend trend-up">All clear</span></div><div><div className="stat-value" style={{ fontSize: 22 }}>₹{fmt(totalCollected)}</div><div className="stat-label">Total Collected (this lease)</div></div></div>
        <div className="stat-card"><div className="stat-card-top"><div className="stat-icon stat-icon-navy"></div></div><div><div className="stat-value" style={{ fontSize: 22 }}>{onTime}/{paid.length}</div><div className="stat-label">On-time Payments</div></div></div>
        <div className="stat-card"><div className="stat-card-top"><div className="stat-icon stat-icon-gold"></div></div><div><div className="stat-value" style={{ fontSize: 22 }}>₹{fmt(property.deposit)}</div><div className="stat-label">Security Deposit Held</div></div></div>
        <div className="stat-card"><div className="stat-card-top"><div className="stat-icon stat-icon-amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="20" height="20"><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg></div><span className="stat-trend trend-neutral">Upcoming</span></div><div><div className="stat-value" style={{ fontSize: 22 }}>₹{fmt(property.rent + property.maintenanceCharges)}</div><div className="stat-label">Next payable amount</div></div></div>
      </div>

      <div className="card">
        <div className="card-header">
          <div><div className="card-title">Payment History</div><div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 2 }}>All rental payments for this tenancy</div></div>
          <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export
          </button>
        </div>
        <div className="table-container">
          <table className="data-table">
            <thead><tr><th>Period</th><th>Rent</th><th>Maintenance</th><th>Total</th><th>Due Date</th><th>Paid Date</th><th>Status</th><th>Receipt</th></tr></thead>
            <tbody>
              {payments.length ? (
                payments.map(p => (
                  <tr key={p.id}>
                    <td className="td-primary">{p.month}</td>
                    <td className="td-mono">₹{fmt(p.amount)}</td>
                    <td className="td-mono">₹{fmt(p.maintenance)}</td>
                    <td className="td-mono" style={{ fontWeight: 700, color: "var(--navy)" }}>₹{fmt(p.total)}</td>
                    <td style={{ fontSize: 12.5, color: "var(--text-mid)" }}>{fmtDate(p.dueDate)}</td>
                    <td style={{ fontSize: 12.5 }}>{p.paidDate ? fmtDate(p.paidDate) : <span style={{ color: "var(--text-lite)", fontStyle: "italic" }}>Pending</span>}</td>
                    <td>
                      <span className={`badge ${p.status === "paid" ? "badge-green" : p.status === "upcoming" ? "badge-navy" : "badge-red"}`}>
                        <span className="badge-dot" />{p.status === "paid" ? "Paid" : p.status === "upcoming" ? "Upcoming" : "Overdue"}
                      </span>
                    </td>
                    <td>{p.receipt ? <button className="btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }}>↓ {p.receipt.split("-").slice(0, 2).join("-")}</button> : <span style={{ color: "var(--text-lite)", fontSize: 12 }}>—</span>}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" style={{ padding: "18px 12px", textAlign: "center", color: "var(--text-lite)" }}>No payments recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ─── MAINTENANCE TAB ──────────────────────────────────────────────────────────
function MaintenanceTab({ maintenance }) {
  const [expanded, setExpanded] = useState(null);
  const statusCfg = { in_progress: ["badge-navy", "In Progress"], pending: ["badge-amber", "Pending"], resolved: ["badge-green", "Resolved"] };
  const priColor = { high: "var(--red)", medium: "var(--amber)", low: "var(--green)" };
  const catIcon = { Plumbing: "🔧", Electrical: "⚡", Appliance: "❄️", Carpentry: "🪵", Civil: "🧱" };

  const open = maintenance.filter(m => m.status !== "resolved");
  const resolved = maintenance.filter(m => m.status === "resolved");
  const totalSpent = maintenance.filter(m => m.cost != null).reduce((s, m) => s + m.cost, 0);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
        {[["Open Requests", open.length, "stat-icon-amber"], ["Resolved", resolved.length, "stat-icon-green"], ["Total Cost", `₹${fmt(totalSpent)}`, "stat-icon-navy"]].map(([l, v, ic]) => (
          <div key={l} className="stat-card">
            <div className="stat-card-top"><div className={`stat-icon ${ic}`}></div></div>
            <div><div className="stat-value">{v}</div><div className="stat-label">{l}</div></div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {maintenance.length ? (
          maintenance.map(req => {
            const [cls, lbl] = statusCfg[req.status] || [];
            const isOpen = expanded === req.id;
            return (
              <div key={req.id} className="card">
                <div style={{ padding: "16px 20px", cursor: "pointer", display: "flex", gap: 14, alignItems: "flex-start" }} onClick={() => setExpanded(isOpen ? null : req.id)}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{catIcon[req.category] || "🔨"}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ fontFamily: "var(--serif)", fontSize: 15, fontWeight: 600, color: "var(--navy)" }}>{req.title}</div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <span className={`badge ${cls}`}><span className="badge-dot" />{lbl}</span>
                        <span className="badge" style={{ background: req.priority === "high" ? "var(--red-bg)" : req.priority === "medium" ? "var(--amber-bg)" : "var(--green-bg)", color: priColor[req.priority] }}>{req.priority}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-lite)", marginTop: 4 }}>{req.category} · {fmtDate(req.date)}{req.assignedTo ? ` · ${req.assignedTo}` : ""}{req.cost != null ? ` · ₹${fmt(req.cost)}` : ""}</div>
                    {!isOpen && <div style={{ fontSize: 12.5, color: "var(--text-mid)", marginTop: 5, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{req.desc}</div>}
                  </div>
                  <span style={{ color: "var(--text-lite)", fontSize: 12, flexShrink: 0 }}>{isOpen ? "▲" : "▼"}</span>
                </div>
                {isOpen && (
                  <div style={{ padding: "0 20px 18px", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
                    <p style={{ fontSize: 13.5, color: "var(--text-mid)", lineHeight: 1.6, marginBottom: 16 }}>{req.desc}</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      {req.status !== "resolved" && <button className="btn-primary" style={{ fontSize: 12, padding: "6px 14px" }}>Mark Resolved</button>}
                      <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 14px" }}>Add Note</button>
                      {req.assignedTo && <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 14px" }}>Reassign</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="card" style={{ padding: "18px 20px", color: "var(--text-lite)" }}>No maintenance requests yet.</div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <button className="btn-primary" style={{ gap: 6 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Create Maintenance Request
        </button>
      </div>
    </>
  );
}

// ─── DOCUMENTS TAB ────────────────────────────────────────────────────────────
function DocumentsTab({ documents }) {
  const [filter, setFilter] = useState("all");
  const cats = [...new Set(documents.map(d => d.category))];
  const list = filter === "all" ? documents : documents.filter(d => d.category === filter);
  const counts = documents.reduce((acc, doc) => {
    const key = String(doc.category || "").trim().toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const countLabel = (value, noun) => `${value} ${noun}${value === 1 ? "" : "s"}`;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
        {[["📋", "Lease Agreements", countLabel(counts.lease || 0, "document"), "var(--navy)"], ["🧾", "Rent Receipts", countLabel(counts.receipt || 0, "receipt"), "var(--green)"], ["⚖️", "Legal Docs", countLabel(counts.legal || 0, "document"), "var(--gold)"], ["🖼️", "Media", countLabel(counts.media || 0, "file"), "var(--blue)"]].map(([ic, l, sub, clr]) => (
          <div key={l} style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 8, padding: "16px 18px", boxShadow: "var(--shadow-sm)", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "box-shadow 0.15s" }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: `color-mix(in srgb, ${clr} 11%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{ic}</div>
            <div><div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 13.5 }}>{l}</div><div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 2 }}>{sub}</div></div>
          </div>
        ))}
      </div>

      <div className="filter-row">
        <button className={`filter-chip${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All</button>
        {cats.map(c => <button key={c} className={`filter-chip${filter === c ? " active" : ""}`} onClick={() => setFilter(c)}>{c}</button>)}
        <div className="filter-spacer" />
        <button className="btn-primary" style={{ fontSize: 12, padding: "6px 14px", gap: 5 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Upload Document
        </button>
      </div>

      <div className="doc-list">
        {list.length ? (
          list.map(d => (
            <div key={d.id} className="doc-row">
              <div className="doc-icon doc-icon-pdf">{d.type === "zip" ? "🗜" : "📄"}</div>
              <div className="doc-info">
                <div className="doc-name">{d.name}</div>
                <div className="doc-meta">{d.category} · {d.size} · Added {d.date}</div>
              </div>
              {d.sharedWithTenant
                ? <span className="badge badge-green" style={{ marginRight: 8, fontSize: 11 }}><span className="badge-dot" />Shared with Tenant</span>
                : <span className="badge badge-grey" style={{ marginRight: 8, fontSize: 11 }}>Owner Only</span>}
              <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: 12 }}>↓ Download</button>
            </div>
          ))
        ) : (
          <div className="card" style={{ padding: "18px 20px", color: "var(--text-lite)" }}>No documents uploaded yet.</div>
        )}
      </div>
    </>
  );
}

// ─── ACTIVITY TAB ─────────────────────────────────────────────────────────────
function ActivityTab({ activity }) {
  const [filter, setFilter] = useState("all");
  const list = filter === "all" ? activity : activity.filter(a => a.type === filter);
  return (
    <>
      <div className="filter-row">
        {[["all", "All"], ["payment", "Payments"], ["maintenance", "Maintenance"], ["system", "System"]].map(([v, l]) => (
          <button key={v} className={`filter-chip${filter === v ? " active" : ""}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>
      <div className="card">
        <div style={{ padding: "8px 20px 20px" }}>
          {list.length ? (
            <div className="activity-feed">
              {list.map((a, i) => (
                <div key={a.id} className="activity-item">
                  <div className="activity-dot-wrap">
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: `color-mix(in srgb, ${a.color} 15%, transparent)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{a.icon}</div>
                    {i < list.length - 1 && <div className="activity-line" style={{ marginTop: 4 }} />}
                  </div>
                  <div className="activity-content">
                    <div className="activity-text">{a.text}</div>
                    <div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 2 }}>{a.detail}</div>
                    <div className="activity-time">{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: "16px 0", color: "var(--text-lite)" }}>No activity yet.</div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function PropertyDetail({ propertyId = 1, onNavigate }) {
  const routerNavigate = useNavigate();
  const location = useLocation();
  const { propertyId: propertyIdParam } = useParams();
  const resolvedPropertyId = propertyIdParam || propertyId || "";
  const nav = onNavigate || ((action, id) => {
    if (action === "list") {
      routerNavigate("/owner/properties");
      return;
    }
    if (action === "edit") {
      routerNavigate(`/owner/properties/${id || resolvedPropertyId}/edit`);
      return;
    }
    if (action === "detail") {
      routerNavigate(`/owner/properties/${id || resolvedPropertyId}`);
    }
  });
  const [tab, setTab] = useState("Overview");
  const [showNotif, setShowNotif] = useState(false);
  const [loadingProperty, setLoadingProperty] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [propertyData, setPropertyData] = useState(EMPTY_PROPERTY);
  const [tenantData, setTenantData] = useState(EMPTY_TENANT);
  const [paymentsData, setPaymentsData] = useState([]);
  const [maintenanceData, setMaintenanceData] = useState([]);
  const [documentsData, setDocumentsData] = useState([]);

  useEffect(() => {
    let active = true;

    const loadProperty = async () => {
      setLoadingProperty(true);
      setLoadError("");
      try {
        if (!resolvedPropertyId) {
          throw new Error("Missing property id.");
        }
        const response = await getOwnerPropertyById(resolvedPropertyId);
        if (!active) return;

        const mappedProperty = mapPropertyForDetail(response?.property, EMPTY_PROPERTY);
        const mappedTenant = mapTenantForDetail(response?.activeTenancy);

        setPropertyData(mappedProperty);
        setTenantData(mappedTenant);
        setPaymentsData(mapPaymentsForDetail(response?.payments, mappedProperty.rent, mappedProperty.maintenanceCharges));
        setMaintenanceData(mapMaintenanceForDetail(response?.maintenance));
        setDocumentsData(mapDocumentsForDetail(response?.documents));
      } catch (error) {
        if (!active) return;
        setPropertyData(EMPTY_PROPERTY);
        setTenantData(EMPTY_TENANT);
        setPaymentsData([]);
        setMaintenanceData([]);
        setDocumentsData([]);
        setLoadError(error?.message || "Unable to load live property details.");
      } finally {
        if (active) setLoadingProperty(false);
      }
    };

    loadProperty();
    return () => {
      active = false;
    };
  }, [resolvedPropertyId]);

  const revenueMonthsData = useMemo(() => {
    if (!Array.isArray(paymentsData) || paymentsData.length === 0) return [];
    const recent = paymentsData.slice(0, 6).reverse();
    return recent.map((payment, index) => ({
      m: payment.month || `M${index + 1}`,
      collected: payment.status === "paid" ? Number(payment.total || 0) : 0,
      expected: Number(payment.total || payment.amount || 0),
    }));
  }, [paymentsData]);

  const activityData = useMemo(() => {
    const paymentActivity = (paymentsData || []).slice(0, 4).map((item, index) => ({
      id: `pay-${item.id || index}`,
      type: "payment",
      icon: item.status === "paid" ? "💰" : "🧾",
      color: item.status === "paid" ? "#2D7D46" : "#C47B1A",
      text: `${item.month}: ₹${fmt(item.total || item.amount || 0)}`,
      detail: item.status === "paid" ? `Paid on ${fmtDate(item.paidDate)}` : `Due on ${fmtDate(item.dueDate)}`,
      time: fmtDate(item.paidDate || item.dueDate),
    }));

    const maintenanceActivity = (maintenanceData || []).slice(0, 4).map((item, index) => ({
      id: `maint-${item.id || index}`,
      type: "maintenance",
      icon: item.status === "resolved" ? "✅" : "🔧",
      color: item.status === "resolved" ? "#2D7D46" : "#C47B1A",
      text: item.title,
      detail: `${item.category} · ${item.priority}`,
      time: fmtDate(item.date),
    }));

    const combined = [...maintenanceActivity, ...paymentActivity];
    return combined;
  }, [maintenanceData, paymentsData]);

  const openMaintenance = maintenanceData.filter(m => m.status !== "resolved").length;
  const leaseDaysLeft = daysUntil(tenantData.leaseEnd);

  return (
    <div className="dash-root">
      {/* Minimal sidebar */}
      <aside className="dash-sidebar" style={{ width: 60 }}>
        <div style={{ padding: "18px 0", display: "flex", justifyContent: "center" }}>
          <svg viewBox="0 0 32 32" fill="none" width="26" height="26"><rect x="2" y="14" width="10" height="16" stroke="#B8943F" strokeWidth="1.5" /><rect x="14" y="8" width="10" height="22" stroke="#B8943F" strokeWidth="1.5" /><rect x="26" y="18" width="4" height="12" stroke="#B8943F" strokeWidth="1.5" /><line x1="2" y1="14" x2="30" y2="14" stroke="#B8943F" strokeWidth="1" /></svg>
        </div>
        {[
          ["M3 9l9-7 9 7v11H5z", "/owner/dashboard"],
          ["M3 9l9-7 9 7v11H5z", "/owner/properties"],
          ["M17 21v-2a4 4 0 0 0-4-4H5", "/owner/leases"],
          ["M14.7 6.3l1.6 1.6 3.77-3.77", "/owner/maintenance"],
        ].map(([d, path]) => (
          <div
            key={path}
            className={`nav-item${location.pathname.startsWith(path) ? " active" : ""}`}
            style={{ justifyContent: "center", padding: "12px", cursor: "pointer" }}
            onClick={() => routerNavigate(path)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><path d={d} /></svg>
          </div>
        ))}
      </aside>

      <main className="dash-main">
        {/* Header */}
        <header className="dash-header">
          <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 12px", marginRight: 12 }} onClick={() => nav("list")}>← Properties</button>
          <div className="header-title-group">
            <div className="header-title">{propertyData.title}</div>
            <div className="header-subtitle">{propertyData.address}</div>
            {loadingProperty && <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 2 }}>Loading live details...</div>}
            {loadError && <div style={{ fontSize: 11.5, color: "var(--amber)", marginTop: 2 }}>{loadError}</div>}
          </div>
          <div className="header-actions" style={{ position: "relative" }}>
            <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 14px" }} onClick={() => nav("edit", resolvedPropertyId)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              Edit Property
            </button>
            <button className="btn-primary btn-gold" style={{ fontSize: 12, padding: "6px 14px", fontWeight: 600 }}>Generate Report</button>
            <div className="icon-btn" onClick={() => setShowNotif(v => !v)} style={{ position: "relative" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="16" height="16"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
              {openMaintenance > 0 && <span className="notif-dot" />}
            </div>
          </div>
          {showNotif && (
            <div className="notif-panel">
              <div className="notif-header"><span className="notif-header-title">Property Alerts</span><span className="notif-mark-all">Dismiss all</span></div>
              {openMaintenance > 0 && (
                <div className="notif-item unread">
                  <div className="notif-avatar" style={{ fontSize: 16 }}>🔧</div>
                  <div><div className="notif-text"><strong>{openMaintenance}</strong> open maintenance request{openMaintenance > 1 ? "s" : ""}</div><div className="notif-time">Tap to view</div></div>
                </div>
              )}
              {tenantData.leaseEnd && (
                <div className="notif-item">
                  <div className="notif-avatar" style={{ fontSize: 16 }}>📋</div>
                  <div><div className="notif-text">Lease expires <strong>{fmtDate(tenantData.leaseEnd)}</strong> ({leaseDaysLeft == null ? "—" : leaseDaysLeft} days)</div><div className="notif-time">Renewal reminder scheduled</div></div>
                </div>
              )}
            </div>
          )}
        </header>

        {/* Property hero image */}
        <PropertyHero property={propertyData} />

        {/* Sub-nav tabs */}
        <div style={{ display: "flex", background: "var(--white)", borderBottom: "1px solid var(--border)", padding: "0 28px", flexShrink: 0, overflowX: "auto" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: "14px 18px", background: "none", border: "none", borderBottom: `2px solid ${tab === t ? "var(--gold)" : "transparent"}`, fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: tab === t ? 600 : 400, color: tab === t ? "var(--navy)" : "var(--text-lite)", cursor: "pointer", transition: "all 0.16s", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
              {t}
              {t === "Maintenance" && openMaintenance > 0 && <span style={{ background: "var(--amber)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 10 }}>{openMaintenance}</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="dash-content">
          {tab === "Overview" && <OverviewTab onNavigate={(action, id) => nav(action, id || resolvedPropertyId)} property={propertyData} tenant={tenantData} payments={paymentsData} maintenance={maintenanceData} revenueMonths={revenueMonthsData} />}
          {tab === "Tenant" && <TenantTab property={propertyData} tenant={tenantData} />}
          {tab === "Payments" && <PaymentsTab property={propertyData} payments={paymentsData} />}
          {tab === "Maintenance" && <MaintenanceTab maintenance={maintenanceData} />}
          {tab === "Documents" && <DocumentsTab documents={documentsData} />}
          {tab === "Activity" && <ActivityTab activity={activityData} />}
        </div>
      </main>
    </div>
  );
}
