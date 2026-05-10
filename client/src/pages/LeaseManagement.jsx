import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  createOwnerLease,
  getOwnerLeases,
  getOwnerProperties,
  ownerLeaseAction,
  reviewOwnerMoveOut,
} from "../services/apiClient";
import "./Dashboard.css";
import "./LeasePayments.css";

const STATUS_CFG = {
  active: { label: "Active", cls: "badge-green", color: "var(--green)", dot: "#2D7D46" },
  expiring_soon: { label: "Expiring Soon", cls: "badge-amber", color: "var(--amber)", dot: "#C47B1A" },
  notice_given: { label: "Notice Given", cls: "badge-red", color: "var(--red)", dot: "#B83232" },
  expired: { label: "Expired", cls: "badge-grey", color: "var(--text-lite)", dot: "#9E9B97" },
  renewal_offered: { label: "Renewal Offered", cls: "badge-navy", color: "var(--blue)", dot: "#1e3a5f" },
};

const RENEWAL_CFG = {
  renewal_offered: { label: "Renewal Offered", cls: "badge-navy" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat("en-IN").format(n);
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const daysUntil = d => Math.ceil((new Date(d) - new Date()) / 86400000);
const leaseProgress = (start, end) => {
  const total = new Date(end) - new Date(start);
  const elapsed = new Date() - new Date(start);
  return Math.min(100, Math.max(0, Math.round(elapsed / total * 100)));
};

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <aside className="dash-sidebar" style={{ width: 60 }}>
      <div style={{ padding: "18px 0", display: "flex", justifyContent: "center" }}>
        <svg viewBox="0 0 32 32" fill="none" width="26" height="26"><rect x="2" y="14" width="10" height="16" stroke="#B8943F" strokeWidth="1.5" /><rect x="14" y="8" width="10" height="22" stroke="#B8943F" strokeWidth="1.5" /><rect x="26" y="18" width="4" height="12" stroke="#B8943F" strokeWidth="1.5" /><line x1="2" y1="14" x2="30" y2="14" stroke="#B8943F" strokeWidth="1" /></svg>
      </div>
      {[
        ["M3 9l9-7 9 7v11H5z", "/owner/dashboard"],
        ["M3 9l9-7 9 7v11H5z", "/owner/properties"],
        ["M17 21v-2a4 4 0 0 0-4-4H5", "/owner/leases"],
        ["M14.7 6.3l1.6 1.6 3.77-3.77", "/owner/maintenance"],
        ["M14 2H6a2 2 0 0 0-2 2v16h12a2 2 0 0 0 2-2V8z", "/owner/documents"],
        ["M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5", "/owner/payments"],
      ].map(([d, path]) => (
        <div
          key={path}
          className={`nav-item${location.pathname.startsWith(path) ? " active" : ""}`}
          style={{ justifyContent: "center", padding: "12px", cursor: "pointer" }}
          onClick={() => navigate(path)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18"><path d={d} /></svg>
        </div>
      ))}
    </aside>
  );
}

// ─── New Lease Drawer ─────────────────────────────────────────────────────────
function NewLeaseDrawer({ open, onClose, propertyOptions, onCreate, busy, error }) {
  const [data, setData] = useState({ propertyId: "", tenantName: "", tenantEmail: "", tenantPhone: "", rent: "", deposit: "", maintenance: "", startDate: "", endDate: "", noticePeriod: "2", paymentDay: "5", gracePeriod: "3", escalation: "", notes: "" });
  const ch = e => setData(d => ({ ...d, [e.target.name]: e.target.value }));

  const defaultPropertyId = propertyOptions.length ? String(propertyOptions[0].value) : "";
  const selectedPropertyId = data.propertyId || defaultPropertyId;

  const handleSubmit = () => {
    if (!selectedPropertyId || !data.startDate || !data.endDate) return;
    onCreate({ ...data, propertyId: selectedPropertyId });
  };

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex" }}>
      <div style={{ flex: 1, background: "rgba(12,27,46,0.45)" }} onClick={onClose} />
      <div style={{ width: 520, background: "var(--white)", boxShadow: "-4px 0 24px rgba(12,27,46,0.14)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "20px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 600, color: "var(--navy)" }}>Create New Lease</div>
            <div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 2 }}>Generate a digital lease agreement</div>
          </div>
          <button onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "var(--text-mid)" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {[["Property & Tenant", [
            { label: "Select Property", name: "propertyId", type: "select", options: propertyOptions },
            { label: "Tenant Full Name", name: "tenantName", placeholder: "As on government ID" },
            { label: "Tenant Email", name: "tenantEmail", type: "email", placeholder: "tenant@email.com" },
            { label: "Tenant Phone", name: "tenantPhone", placeholder: "+91 98765 43210" },
          ]], ["Financials", [
            { label: "Monthly Rent (₹)", name: "rent", type: "number", placeholder: "28000" },
            { label: "Security Deposit (₹)", name: "deposit", type: "number", placeholder: "84000" },
            { label: "Maintenance (₹/mo)", name: "maintenance", type: "number", placeholder: "1200" },
          ]], ["Lease Period", [
            { label: "Start Date", name: "startDate", type: "date" },
            { label: "End Date", name: "endDate", type: "date" },
            { label: "Notice Period (months)", name: "noticePeriod", type: "select", options: [{ value: "1", label: "1 Month" }, { value: "2", label: "2 Months" }, { value: "3", label: "3 Months" }] },
            { label: "Rent Due Day", name: "paymentDay", type: "select", options: [1, 5, 10, 15].map(n => ({ value: String(n), label: `${n}${n === 1 ? "st" : n === 5 ? "th" : "th"} of each month` })) },
            { label: "Grace Period (days)", name: "gracePeriod", type: "select", options: [0, 3, 5, 7].map(n => ({ value: String(n), label: `${n} days` })) },
          ]], ["Additional Terms", [
            { label: "Escalation Clause", name: "escalation", placeholder: "e.g. 5% annual increase on renewal" },
            { label: "Special Notes", name: "notes", type: "textarea", placeholder: "Any additional terms or conditions..." },
          ]]].map(([section, fields]) => (
            <div key={section} style={{ marginBottom: 22 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>{section}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
                {fields.map(f => (
                  <div key={f.name} className="f-grp" style={{ gridColumn: f.type === "textarea" || f.name === "tenantName" || f.name === "escalation" || f.name === "notes" ? "span 2" : "span 1" }}>
                    <label className="f-lbl">{f.label}</label>
                    {f.type === "select" ? (
                      <select className="f-ctrl" name={f.name} value={f.name === "propertyId" ? selectedPropertyId : data[f.name]} onChange={ch}>
                        <option value="">Select</option>
                        {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea className="f-ctrl" name={f.name} value={data[f.name]} onChange={ch} placeholder={f.placeholder} rows={3} style={{ resize: "vertical" }} />
                    ) : (
                      <input className="f-ctrl" type={f.type || "text"} name={f.name} value={data[f.name]} onChange={ch} placeholder={f.placeholder} autoComplete="off" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {error && (
          <div style={{ margin: "0 28px 12px", padding: "9px 12px", background: "rgba(196,123,26,0.08)", border: "1px solid rgba(196,123,26,0.35)", borderRadius: 6, fontSize: 12.5, color: "var(--amber)" }}>
            {error}
          </div>
        )}
        <div style={{ padding: "16px 28px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn-primary"
            style={{ flex: 2, justifyContent: "center" }}
            onClick={handleSubmit}
            disabled={busy || !selectedPropertyId || !data.startDate || !data.endDate}
          >
            {busy ? "Creating..." : "Generate Lease Agreement →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Lease Detail Drawer ──────────────────────────────────────────────────────
function LeaseDetailDrawer({ lease, onClose, onAction }) {
  if (!lease) return null;
  const progress = leaseProgress(lease.startDate, lease.endDate);
  const days = daysUntil(lease.endDate);
  const { label, cls } = STATUS_CFG[lease.status] || {};
  const totalRentValue = lease.rent * 11;
  const moveOutStatus = String(lease.moveOutStatus || "").toLowerCase();
  const moveOutVideoUrl = lease.moveOutVideo?.url;
  const hasMoveOutVideo = Boolean(moveOutVideoUrl);

  const eventIcon = { signed: "✍️", start: "🏠", reminder: "🔔", notice: "📋", renewal: "🔄" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex" }}>
      <div style={{ flex: 1, background: "rgba(12,27,46,0.45)" }} onClick={onClose} />
      <div style={{ width: 580, background: "var(--white)", boxShadow: "-4px 0 24px rgba(12,27,46,0.14)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Hero */}
        <div style={{ background: "linear-gradient(135deg, var(--navy) 0%, var(--navy-lite) 100%)", padding: "22px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.2em", color: "rgba(255,255,255,0.35)", marginBottom: 6 }}>LEASE · {lease.id}</div>
              <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 600, color: "#fff", marginBottom: 3 }}>{lease.propertyName}</div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", marginBottom: 14 }}>{lease.propertyAddress}</div>
              <span className={`badge ${cls}`}><span className="badge-dot" />{label}</span>
            </div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", width: 32, height: 32, borderRadius: 6, cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5 }}>
              <span>{fmtDate(lease.startDate)}</span><span>{progress}% · {days > 0 ? `${days}d remaining` : "Expired"}</span><span>{fmtDate(lease.endDate)}</span>
            </div>
            <div style={{ height: 4, background: "rgba(255,255,255,0.12)", borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "var(--gold)", borderRadius: 2 }} />
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 20px" }}>
          {/* Tenant */}
          <div style={{ padding: "18px 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--serif)", fontSize: 15, color: "var(--gold)", fontWeight: 600 }}>{lease.tenantInitials}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: "var(--navy)" }}>{lease.tenantName}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-lite)", marginTop: 2 }}>{lease.tenantEmail} · {lease.tenantPhone}</div>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <button className="btn-secondary" style={{ fontSize: 12, padding: "5px 10px" }}>📞 Call</button>
              <button className="btn-secondary" style={{ fontSize: 12, padding: "5px 10px" }}>📧 Email</button>
            </div>
          </div>

          {/* Financial summary */}
          <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Financial Terms</div>
            <div className="info-grid-3">
              {[["Monthly Rent", `₹${fmt(lease.rent)}`], ["Security Deposit", `₹${fmt(lease.deposit)}`], ["Maintenance", `₹${fmt(lease.maintenanceCharges)}/mo`], ["Lease Value (11mo)", `₹${fmt(totalRentValue)}`], ["Notice Period", `${lease.noticePeriod} months`], ["Payment Due", `${lease.paymentDay}${lease.paymentDay === 1 ? "st" : "th"} + ${lease.gracePeriod}d grace`]].map(([k, v]) => (
                <div key={k} className="info-item"><span className="info-key">{k}</span><span className="info-val-strong">{v}</span></div>
              ))}
            </div>
            {lease.escalationClause && (
              <div style={{ marginTop: 12, padding: "9px 12px", background: "var(--surface)", borderRadius: 4, border: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-mid)" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-lite)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Escalation: </span>{lease.escalationClause}
              </div>
            )}
          </div>

          {/* Legal */}
          <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Legal</div>
            <div className="info-grid">
              {[["Registration No.", lease.registrationNo], ["Signed Date", fmtDate(lease.signedDate)], ["Start Date", fmtDate(lease.startDate)], ["End Date", fmtDate(lease.endDate)]].map(([k, v]) => (
                <div key={k} className="info-item"><span className="info-key">{k}</span><span className="info-val-strong">{v}</span></div>
              ))}
            </div>
          </div>

          {(lease.moveOutStatus || hasMoveOutVideo) && (
            <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Move-out Handover</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className={`badge ${moveOutStatus === "accepted" ? "badge-green" : moveOutStatus === "rejected" ? "badge-red" : "badge-amber"}`}>
                  <span className="badge-dot" />{moveOutStatus || "pending"}
                </span>
                {hasMoveOutVideo ? (
                  <a className="btn-secondary" style={{ fontSize: 12 }} href={moveOutVideoUrl} target="_blank" rel="noreferrer">View Video</a>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--text-lite)" }}>No video uploaded yet.</span>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ padding: "16px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Actions</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => onAction("download", lease)}>📄 Download Agreement</button>
              {hasMoveOutVideo && moveOutStatus !== "accepted" && (
                <button className="btn-secondary" style={{ fontSize: 12, color: "var(--green)", borderColor: "rgba(45,125,70,0.3)" }} onClick={() => onAction("confirm_move_out", lease)}>✅ Confirm Move-out</button>
              )}
              {hasMoveOutVideo && moveOutStatus !== "accepted" && (
                <button className="btn-secondary" style={{ fontSize: 12, color: "var(--red)", borderColor: "rgba(184,50,50,0.3)" }} onClick={() => onAction("reject_move_out", lease)}>⚠️ Reject Move-out</button>
              )}
              {lease.status === "active" && !lease.renewalOffered && (
                <button className="btn-secondary" style={{ fontSize: 12, color: "var(--gold)", borderColor: "rgba(184,148,63,0.4)" }} onClick={() => onAction("send_renewal", lease)}>🔄 Offer Renewal</button>
              )}
              {lease.status === "active" && (
                <button className="btn-secondary" style={{ fontSize: 12, color: "var(--amber)", borderColor: "rgba(196,123,26,0.3)" }} onClick={() => onAction("send_notice", lease)}>📋 Issue Notice</button>
              )}
              {lease.status !== "notice_given" && (
                <button className="btn-secondary" style={{ fontSize: 12, color: "var(--red)", borderColor: "rgba(184,50,50,0.3)" }} onClick={() => onAction("terminate", lease)}>🚫 Early Terminate</button>
              )}
            </div>
          </div>

          {/* History */}
          <div style={{ padding: "16px 0" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-lite)", textTransform: "uppercase", marginBottom: 12 }}>Lease History</div>
            <div className="timeline">
              {lease.history.map((h, i) => (
                <div key={i} className="tl-item">
                  <div className="tl-left">
                    <div className={`tl-dot${i < lease.history.length - 1 ? " tl-dot-filled" : " tl-dot-gold"}`} />
                    {i < lease.history.length - 1 && <div className="tl-connector" />}
                  </div>
                  <div className="tl-content">
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{eventIcon[h.type] || "·"}</span>
                      <div className="tl-title">{h.event}</div>
                    </div>
                    <div className="tl-time">{fmtDate(h.date)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Lease Card ───────────────────────────────────────────────────────────────
function LeaseCard({ lease, onClick, animDelay }) {
  const progress = leaseProgress(lease.startDate, lease.endDate);
  const days = daysUntil(lease.endDate);
  const { label, cls } = STATUS_CFG[lease.status] || {};
  const ren = lease.renewalStatus && RENEWAL_CFG[lease.renewalStatus];

  return (
    <div className="lease-card" style={{ animationDelay: `${animDelay}ms` }} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 15, fontWeight: 600, color: "var(--navy)", marginBottom: 3 }}>{lease.propertyName}</div>
          <div style={{ fontSize: 12, color: "var(--text-lite)" }}>{lease.propertyAddress}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          <span className={`badge ${cls}`}><span className="badge-dot" />{label}</span>
          {ren && <span className={`badge ${ren.cls}`}>{ren.label}</span>}
        </div>
      </div>

      {/* Tenant */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--surface)", borderRadius: 5, marginBottom: 14 }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--gold)", fontWeight: 700, flexShrink: 0 }}>{lease.tenantInitials}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--navy)" }}>{lease.tenantName}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>{lease.tenantEmail}</div>
        </div>
      </div>

      {/* Dates + progress */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-lite)", marginBottom: 5 }}>
          <span>{fmtDate(lease.startDate)}</span>
          <span style={{ color: days < 60 ? "var(--red)" : days < 120 ? "var(--amber)" : "var(--text-mid)", fontWeight: 500 }}>{days > 0 ? `${days} days left` : "Expired"}</span>
          <span>{fmtDate(lease.endDate)}</span>
        </div>
        <div className="progress-bar">
          <div className={`progress-fill ${days < 60 ? "progress-fill-red" : days < 120 ? "progress-fill-gold" : "progress-fill-navy"}`} style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Financials */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 700, color: "var(--navy)" }}>₹{fmt(lease.rent)}<span style={{ fontFamily: "var(--sans)", fontSize: 11, color: "var(--text-lite)", fontWeight: 400 }}>/mo</span></div>
          <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>Deposit: ₹{fmt(lease.deposit)}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-lite)", padding: "3px 8px", background: "var(--surface)", borderRadius: 3, border: "1px solid var(--border)" }}>{lease.id}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Expiry Timeline ──────────────────────────────────────────────────────────
function ExpiryTimeline({ leases }) {
  const sorted = [...leases].sort((a, b) => new Date(a.endDate) - new Date(b.endDate));
  const MAX_DAYS = 400;
  return (
    <div style={{ padding: "4px 0" }}>
      {sorted.map(l => {
        const days = daysUntil(l.endDate);
        const pct = Math.max(0, Math.min(100, (days / MAX_DAYS) * 100));
        const color = days < 60 ? "var(--red)" : days < 120 ? "var(--amber)" : "var(--green)";
        return (
          <div key={l.id} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--navy)" }}>{l.propertyName.split(" ").slice(0, 3).join(" ")}</span>
              <span style={{ fontSize: 11.5, color, fontWeight: 600, fontFamily: "var(--mono)" }}>{days > 0 ? `${days}d` : "Exp"}</span>
            </div>
            <div className="progress-bar">
              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function LeaseManagement() {
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [viewMode, setViewMode] = useState("grid");
  const [sortBy, setSortBy] = useState("endDate");
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState(null);

  const [leases, setLeases] = useState([]);
  const [properties, setProperties] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  const loadData = async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError("");

    try {
      const [leaseRes, propertyRes] = await Promise.all([
        getOwnerLeases(),
        getOwnerProperties(),
      ]);
      setLeases(Array.isArray(leaseRes?.items) ? leaseRes.items : []);
      setProperties(Array.isArray(propertyRes?.items) ? propertyRes.items : []);
    } catch (err) {
      setError(err?.message || "Unable to load leases.");
      setLeases([]);
      setProperties([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const propertyOptions = useMemo(() => {
    const fromProperties = properties
      .filter((item) => item?.id != null)
      .map((item) => ({
        value: String(item.id),
        label: item.city ? `${item.title || `Property ${item.id}`} · ${item.city}` : (item.title || `Property ${item.id}`),
      }));
    if (fromProperties.length > 0) {
      return fromProperties;
    }

    const byId = new Map();
    leases.forEach((item) => {
      if (item?.propertyId == null || byId.has(String(item.propertyId))) return;
      byId.set(String(item.propertyId), {
        value: String(item.propertyId),
        label: item.propertyName || `Property ${item.propertyId}`,
      });
    });
    return Array.from(byId.values());
  }, [properties, leases]);

  const filtered = useMemo(() => {
    let list = leases.filter((l) => {
      const q = search.toLowerCase();
      const mQ = !q
        || String(l?.propertyName || "").toLowerCase().includes(q)
        || String(l?.tenantName || "").toLowerCase().includes(q)
        || String(l?.id || "").toLowerCase().includes(q);
      const mS = statusF === "all" || l?.status === statusF || (statusF === "renewal_offered" && l?.renewalStatus === "renewal_offered");
      return mQ && mS;
    });
    return [...list].sort((a, b) => {
      if (sortBy === "rent") return (b?.rent || 0) - (a?.rent || 0);
      if (sortBy === "name") return String(a?.propertyName || "").localeCompare(String(b?.propertyName || ""));
      return new Date(a?.endDate || 0) - new Date(b?.endDate || 0);
    });
  }, [leases, search, statusF, sortBy]);

  const counts = useMemo(() => ({
    all: leases.length,
    active: leases.filter((l) => l?.status === "active").length,
    expiring_soon: leases.filter((l) => l?.status === "expiring_soon").length,
    notice_given: leases.filter((l) => l?.status === "notice_given").length,
    renewal_offered: leases.filter((l) => l?.renewalStatus === "renewal_offered").length,
    totalRevenue: leases.reduce((s, l) => s + (Number(l?.rent) || 0), 0),
  }), [leases]);

  const totalLeaseValue = useMemo(() => leases.reduce((s, l) => s + (Number(l?.rent) || 0), 0), [leases]);
  const totalDeposits = useMemo(() => leases.reduce((s, l) => s + (Number(l?.deposit) || 0), 0), [leases]);
  const avgLeaseRent = leases.length ? Math.round(totalLeaseValue / leases.length) : 0;
  const avgRemaining = useMemo(() => {
    const remaining = leases
      .map((item) => daysUntil(item?.endDate))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!remaining.length) return 0;
    return Math.round(remaining.reduce((sum, value) => sum + value, 0) / remaining.length);
  }, [leases]);

  const handleCreateLease = async (formData) => {
    setCreateBusy(true);
    setCreateError("");
    try {
      await createOwnerLease({
        propertyId: String(formData.propertyId),
        tenantName: formData.tenantName || null,
        tenantEmail: formData.tenantEmail || null,
        tenantPhone: formData.tenantPhone || null,
        rent: formData.rent ? Number(formData.rent) : null,
        deposit: formData.deposit ? Number(formData.deposit) : null,
        maintenance: formData.maintenance ? Number(formData.maintenance) : null,
        startDate: formData.startDate,
        endDate: formData.endDate,
        noticePeriod: formData.noticePeriod ? Number(formData.noticePeriod) : null,
        paymentDay: formData.paymentDay ? Number(formData.paymentDay) : null,
        gracePeriod: formData.gracePeriod ? Number(formData.gracePeriod) : null,
        escalation: formData.escalation || null,
        notes: formData.notes || null,
      });

      setActionMessage("Lease created successfully.");
      setShowNew(false);
      await loadData({ silent: true });
    } catch (err) {
      setCreateError(err?.message || "Unable to create lease.");
    } finally {
      setCreateBusy(false);
    }
  };

  const handleAction = async (action, lease) => {
    if (action === "download") {
      setActionMessage("Download will be enabled once agreement documents are attached.");
      return;
    }

    if (action === "confirm_move_out" || action === "reject_move_out") {
      setActionMessage("");
      try {
        await reviewOwnerMoveOut(lease.id, { status: action === "confirm_move_out" ? "accepted" : "rejected" });
        await loadData({ silent: true });
        setActionMessage(action === "confirm_move_out" ? "Move-out confirmed." : "Move-out rejected.");
        setSelected(null);
      } catch (err) {
        setActionMessage(err?.message || "Unable to review move-out.");
      }
      return;
    }

    setActionMessage("");
    try {
      await ownerLeaseAction(lease.id, { action });
      await loadData({ silent: true });
      const actionLabel = {
        send_renewal: "Renewal offer sent.",
        send_notice: "Notice issued.",
        terminate: "Lease marked terminated.",
      };
      setActionMessage(actionLabel[action] || "Lease updated.");
      setSelected(null);
    } catch (err) {
      setActionMessage(err?.message || "Unable to update lease.");
    }
  };

  return (
    <div className="dash-root">
      <Sidebar />
      <main className="dash-main">
        <header className="dash-header">
          <div className="header-title-group">
            <div className="header-title">Lease Management</div>
            <div className="header-subtitle">{counts.all} active leases · ₹{fmt(counts.totalRevenue)}/month portfolio</div>
          </div>
          <div className="header-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input placeholder="Search property, tenant, lease ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="header-actions">
            <button className="btn-secondary" style={{ fontSize: 12, gap: 5 }} onClick={() => loadData()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Refresh
            </button>
            <button className="btn-primary btn-gold" style={{ gap: 5 }} onClick={() => setShowNew(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Lease
            </button>
          </div>
        </header>

        <div className="dash-content">
          {loading && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body">Loading lease data...</div>
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

          <div className="stats-grid" style={{ marginBottom: 22 }}>
            {[
              [counts.active, "Active Leases", "stat-icon-green", "Live agreements"],
              [counts.expiring_soon, "Expiring ≤ 90 days", "stat-icon-amber", "Attention needed"],
              [counts.notice_given, "Notice Given", "stat-icon-red", "Vacating soon"],
              [counts.renewal_offered, "Renewals Pending", "stat-icon-navy", "Awaiting tenant"],
            ].map(([n, l, ic, sub]) => (
              <div key={l} className="stat-card">
                <div className="stat-card-top"><div className={`stat-icon ${ic}`} /><span className="stat-trend trend-neutral">{sub}</span></div>
                <div><div className="stat-value">{n}</div><div className="stat-label">{l}</div></div>
              </div>
            ))}
          </div>

          <div className="two-col-wide" style={{ marginTop: 0, marginBottom: 22 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
                <div className="filter-chips-row">
                  {[["all", "All"], ["active", "Active"], ["expiring_soon", "Expiring Soon"], ["notice_given", "Notice"], ["renewal_offered", "Renewal Pending"]].map(([v, l]) => (
                    <button key={v} className={`filter-chip${statusF === v ? " active" : ""}`} onClick={() => setStatusF(v)}>{l}</button>
                  ))}
                </div>
                <div style={{ flex: 1 }} />
                <select className="f-ctrl" style={{ width: "auto", minWidth: 140 }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="endDate">Sort: Expiry</option>
                  <option value="rent">Sort: Rent</option>
                  <option value="name">Sort: Name</option>
                </select>
                <div className="view-toggle">
                  <button className={`view-btn${viewMode === "grid" ? " view-btn-on" : ""}`} onClick={() => setViewMode("grid")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                  </button>
                  <button className={`view-btn${viewMode === "table" ? " view-btn-on" : ""}`} onClick={() => setViewMode("table")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                  </button>
                </div>
              </div>

              {viewMode === "grid" ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 18 }}>
                  {filtered.map((l, i) => <LeaseCard key={l.id} lease={l} onClick={() => setSelected(l)} animDelay={i * 50} />)}
                </div>
              ) : (
                <div className="card">
                  <div style={{ overflowX: "auto" }}>
                    <table className="data-table">
                      <thead>
                        <tr><th style={{ paddingLeft: 16 }}>Lease / Property</th><th>Tenant</th><th>Period</th><th>Rent</th><th>Status</th><th>Expiry</th><th style={{ textAlign: "right", paddingRight: 16 }}>Actions</th></tr>
                      </thead>
                      <tbody>
                        {filtered.map((l) => {
                          const { label, cls } = STATUS_CFG[l.status] || {};
                          const days = daysUntil(l.endDate);
                          return (
                            <tr key={l.id} className="prop-table-row">
                              <td style={{ paddingLeft: 16 }}>
                                <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--navy)" }}>{l.propertyName}</div>
                                <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>{l.id}</div>
                              </td>
                              <td>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--gold)", fontWeight: 700, flexShrink: 0 }}>{l.tenantInitials}</div>
                                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{l.tenantName}</div>
                                </div>
                              </td>
                              <td style={{ fontSize: 12.5, color: "var(--text-mid)" }}>{fmtDate(l.startDate)} → {fmtDate(l.endDate)}</td>
                              <td style={{ fontFamily: "var(--mono)", fontSize: 13.5, fontWeight: 600, color: "var(--navy)" }}>₹{fmt(l.rent)}</td>
                              <td><span className={`badge ${cls}`}><span className="badge-dot" />{label}</span></td>
                              <td><span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: days < 60 ? "var(--red)" : days < 120 ? "var(--amber)" : "var(--green)" }}>{Number.isFinite(days) ? `${days}d` : "-"}</span></td>
                              <td style={{ textAlign: "right", paddingRight: 8 }}>
                                <button className="btn-secondary" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => setSelected(l)}>View</button>
                              </td>
                            </tr>
                          );
                        })}
                        {filtered.length === 0 && (
                          <tr><td colSpan={7} style={{ color: "var(--text-lite)" }}>No leases found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div className="card">
                <div className="card-header"><div className="card-title">Expiry Timeline</div><span style={{ fontSize: 11.5, color: "var(--text-lite)" }}>Next {Math.ceil(400 / 30)} months</span></div>
                <div className="card-body"><ExpiryTimeline leases={leases} /></div>
              </div>

              <div className="card">
                <div className="card-header"><div className="card-title">Upcoming Actions</div></div>
                <div style={{ padding: "8px 20px 16px" }}>
                  {[...leases]
                    .filter((l) => daysUntil(l.endDate) < 120 || l.status === "notice_given" || l.renewalStatus === "renewal_offered")
                    .sort((a, b) => daysUntil(a.endDate) - daysUntil(b.endDate))
                    .slice(0, 5)
                    .map((l, i, arr) => {
                      const days = daysUntil(l.endDate);
                      const icon = l.status === "notice_given" ? "📋" : l.renewalStatus === "renewal_offered" ? "🔄" : days < 60 ? "⚠️" : "🔔";
                      const msg = l.status === "notice_given" ? "Vacating" : l.renewalStatus === "renewal_offered" ? "Renewal pending" : `Expiring in ${days}d`;
                      return (
                        <div key={l.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none", cursor: "pointer" }} onClick={() => setSelected(l)}>
                          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--navy)" }}>{String(l.propertyName || "").split(" ").slice(0, 3).join(" ")}</div>
                            <div style={{ fontSize: 11.5, color: days < 60 ? "var(--red)" : "var(--text-lite)", marginTop: 2 }}>{msg} · {l.tenantName}</div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><div className="card-title">Portfolio Summary</div></div>
                <div className="card-body">
                  {[
                    ["Total Lease Value", `₹${fmt(totalLeaseValue)}/mo`],
                    ["Total Deposits Held", `₹${fmt(totalDeposits)}`],
                    ["Avg. Lease Rent", `₹${fmt(avgLeaseRent)}`],
                    ["Avg. Remaining", `${avgRemaining}d`],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                      <span style={{ color: "var(--text-mid)" }}>{k}</span>
                      <span style={{ fontWeight: 600, color: "var(--navy)", fontFamily: "var(--mono)" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <NewLeaseDrawer
        open={showNew}
        onClose={() => {
          setShowNew(false);
          setCreateError("");
        }}
        propertyOptions={propertyOptions}
        onCreate={handleCreateLease}
        busy={createBusy}
        error={createError}
      />
      {selected && <LeaseDetailDrawer lease={selected} onClose={() => setSelected(null)} onAction={handleAction} />}
    </div>
  );
}
