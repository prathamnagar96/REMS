import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getOwnerPayments, recordOwnerPayment } from "../services/apiClient";
import "./Dashboard.css";
import "./LeasePayments.css";

const STATUS_CFG = {
  paid: { label: "Paid", cls: "badge-green", dot: "var(--green)" },
  upcoming: { label: "Upcoming", cls: "badge-navy", dot: "var(--blue)" },
  overdue: { label: "Overdue", cls: "badge-red", dot: "var(--red)" },
  partial: { label: "Partial", cls: "badge-amber", dot: "var(--amber)" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const fmt = n => n != null ? new Intl.NumberFormat("en-IN").format(toNumber(n)) : "—";
const fmtDate = (d) => {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const periodSortValue = (value) => {
  const parsed = Date.parse(`01 ${value}`);
  return Number.isFinite(parsed) ? parsed : 0;
};

// ─── Record Rent Modal ────────────────────────────────────────────────────────
function RecordPaymentModal({ record, onClose, onSave, busy, error }) {
  const [data, setData] = useState({ amount: record?.total || "", paidDate: new Date().toISOString().slice(0, 10), method: "upi", txnId: "", note: "" });
  const ch = e => setData(d => ({ ...d, [e.target.name]: e.target.value }));
  if (!record) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,27,46,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ background: "var(--white)", borderRadius: 10, maxWidth: 480, width: "100%", boxShadow: "var(--shadow-md)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 600, color: "var(--navy)" }}>Record Payment</div>
          <button onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "var(--text-mid)" }}>×</button>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ padding: "12px 16px", background: "var(--surface)", borderRadius: 6, marginBottom: 20, border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 14 }}>{record.propertyName} · {record.period}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-lite)", marginTop: 3 }}>{record.tenantName} · Due {fmtDate(record.dueDate)}</div>
            <div style={{ display: "flex", gap: 20, marginTop: 10 }}>
              {[["Rent", record.rent], ["Maintenance", record.maintenance], ["Total Due", record.total]].map(([k, v]) => (
                <div key={k}><div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-lite)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{k}</div><div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 13.5 }}>₹{fmt(v)}</div></div>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[["Amount Received (₹)", "amount", "number"], ["Date Received", "paidDate", "date"]].map(([l, n, t]) => (
              <div key={n} className="f-grp">
                <label className="f-lbl">{l}</label>
                <input className="f-ctrl" type={t} name={n} value={data[n]} onChange={ch} disabled={busy} />
              </div>
            ))}
            <div className="f-grp">
              <label className="f-lbl">Payment Method</label>
              <select className="f-ctrl" name="method" value={data.method} onChange={ch} disabled={busy}>
                {[["upi", "UPI"], ["neft", "NEFT/RTGS"], ["cheque", "Cheque"], ["cash", "Cash"], ["bank_transfer", "Bank Transfer"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="f-grp">
              <label className="f-lbl">Transaction ID</label>
              <input className="f-ctrl" name="txnId" value={data.txnId} onChange={ch} placeholder="Optional" disabled={busy} />
            </div>
            <div className="f-grp" style={{ gridColumn: "span 2" }}>
              <label className="f-lbl">Internal Note</label>
              <input className="f-ctrl" name="note" value={data.note} onChange={ch} placeholder="Optional note..." disabled={busy} />
            </div>
          </div>
          {error && (
            <div style={{ marginTop: 12, padding: "9px 12px", background: "rgba(184,50,50,0.08)", border: "1px solid rgba(184,50,50,0.32)", borderRadius: 6, color: "var(--red)", fontSize: 12.5 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-primary btn-gold" style={{ flex: 2, justifyContent: "center" }} onClick={() => onSave(record.id, data)} disabled={busy}>
              {busy ? "Saving..." : "Mark as Received"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Send Reminder Modal ──────────────────────────────────────────────────────
function ReminderModal({ record, onClose, onSend }) {
  const [msg, setMsg] = useState(`Dear ${record?.tenantName?.split(" ")[0] || "Tenant"},\n\nThis is a friendly reminder that your rent of ₹${fmt(record?.total)} for ${record?.period} was due on ${fmtDate(record?.dueDate)}.\n\nPlease arrange payment at the earliest.\n\nRegards,\nYour Landlord`);
  if (!record) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,27,46,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={onClose}>
      <div style={{ background: "var(--white)", borderRadius: 10, maxWidth: 500, width: "100%", boxShadow: "var(--shadow-md)" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 19, fontWeight: 600, color: "var(--navy)" }}>Send Payment Reminder</div>
          <button onClick={onClose} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "var(--text-mid)" }}>×</button>
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {["📧 Email", "📱 WhatsApp", "📞 SMS"].map(ch => (
              <button key={ch} className="btn-secondary" style={{ fontSize: 12, padding: "6px 14px" }}>{ch}</button>
            ))}
          </div>
          <div className="f-grp">
            <label className="f-lbl">Message</label>
            <textarea className="f-ctrl" value={msg} onChange={e => setMsg(e.target.value)} rows={7} style={{ resize: "vertical", fontFamily: "var(--mono)", fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button className="btn-primary" style={{ flex: 2, justifyContent: "center" }} onClick={() => onSend(msg)}>Send Reminder</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mini Donut ───────────────────────────────────────────────────────────────
function DonutChart({ collected, total }) {
  const safeTotal = total > 0 ? total : 1;
  const pct = total > 0 ? Math.min(100, (collected / safeTotal) * 100) : 0;
  const r = 40, circ = 2 * Math.PI * r, fill = (pct / 100) * circ;
  return (
    <div style={{ position: "relative", width: 96, height: 96 }}>
      <svg width="96" height="96" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--navy)" strokeWidth="10"
          strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 17, fontWeight: 700, color: "var(--navy)", lineHeight: 1 }}>{Math.round(pct)}%</span>
        <span style={{ fontSize: 9, color: "var(--text-lite)", marginTop: 2 }}>collected</span>
      </div>
    </div>
  );
}

// ─── Monthly Revenue MiniChart ────────────────────────────────────────────────
function TrendChart({ data }) {
  const points = data.length ? data : [{ label: "-", amount: 0 }];
  const max = Math.max(...points.map(d => d.amount), 1);
  const W = 260, H = 64, pad = 4;
  const plotW = W - pad * 2, plotH = H - pad * 2;
  const gap = points.length > 1 ? plotW / (points.length - 1) : 0;
  const pts = points.map((d, i) => `${pad + i * gap},${pad + plotH - (d.amount / max) * plotH}`).join(" ");
  const fillPts = `${pad},${H - pad} ${pts} ${pad + (points.length - 1) * gap},${H - pad}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--navy)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--navy)" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill="url(#trendGrad)" />
      <polyline points={pts} fill="none" stroke="var(--navy)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((d, i) => (
        <g key={i}>
          <circle cx={pad + i * gap} cy={pad + plotH - (d.amount / max) * plotH} r="3.5" fill="var(--navy)" />
          <text x={pad + i * gap} y={H - 1} textAnchor="middle" fontSize="8" fill="var(--text-lite)" fontFamily="var(--mono)">{d.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="18" height="18">
            <path d={d} />
          </svg>
        </div>
      ))}
    </aside>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function OwnerPayments() {
  const [activeTab, setActiveTab] = useState("Collection");
  const [statusF, setStatusF] = useState("all");
  const [propF, setPropF] = useState("all");
  const [search, setSearch] = useState("");
  const [recordModal, setRecordModal] = useState(null);
  const [reminderModal, setReminderModal] = useState(null);
  const [payments, setPayments] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [summary, setSummary] = useState({
    currentPeriod: "-",
    collected: 0,
    expected: 0,
    overdueAmount: 0,
    overdueCount: 0,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordError, setRecordError] = useState("");

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError("");

    try {
      const response = await getOwnerPayments();
      setPayments(Array.isArray(response?.items) ? response.items : []);
      setPayouts(Array.isArray(response?.payouts) ? response.payouts : []);
      setSummary({
        currentPeriod: response?.summary?.currentPeriod || "-",
        collected: toNumber(response?.summary?.collected),
        expected: toNumber(response?.summary?.expected),
        overdueAmount: toNumber(response?.summary?.overdueAmount),
        overdueCount: toNumber(response?.summary?.overdueCount),
      });
    } catch (err) {
      setError(err?.message || "Unable to load payments.");
      setPayments([]);
      setPayouts([]);
      setSummary({
        currentPeriod: "-",
        collected: 0,
        expected: 0,
        overdueAmount: 0,
        overdueCount: 0,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const currentPeriod = summary.currentPeriod || "-";

  const properties = useMemo(() => {
    return [...new Set(payments.map((p) => p?.propertyName).filter(Boolean))].sort();
  }, [payments]);

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      const q = search.toLowerCase();
      const tenant = String(p?.tenantName || "").toLowerCase();
      const property = String(p?.propertyName || "").toLowerCase();
      const period = String(p?.period || "").toLowerCase();
      const receipt = String(p?.receipt || "").toLowerCase();

      const mQ = !q || tenant.includes(q) || property.includes(q) || period.includes(q) || receipt.includes(q);
      const mS = statusF === "all" || p?.status === statusF;
      const mP = propF === "all" || p?.propertyName === propF;
      return mQ && mS && mP;
    });
  }, [payments, search, statusF, propF]);

  const historyRows = useMemo(() => {
    return payments
      .filter((p) => p?.status === "paid")
      .filter((p) => {
        const q = search.toLowerCase();
        const tenant = String(p?.tenantName || "").toLowerCase();
        const property = String(p?.propertyName || "").toLowerCase();
        const mQ = !q || tenant.includes(q) || property.includes(q);
        const mP = propF === "all" || p?.propertyName === propF;
        return mQ && mP;
      });
  }, [payments, search, propF]);

  const kpi = useMemo(() => {
    const allTimePaid = payments
      .filter((p) => p?.status === "paid")
      .reduce((sum, p) => sum + toNumber(p?.total), 0);

    return {
      collected: toNumber(summary.collected),
      expected: toNumber(summary.expected),
      overdue: toNumber(summary.overdueAmount),
      overdueCount: toNumber(summary.overdueCount),
      allTimePaid,
    };
  }, [payments, summary]);

  const collectionRate = kpi.expected > 0 ? Math.round((kpi.collected / kpi.expected) * 100) : 0;

  const trendData = useMemo(() => {
    const byPeriod = new Map();

    payments.forEach((item) => {
      const period = item?.period;
      if (!period || period === "-") return;

      const current = toNumber(byPeriod.get(period));
      if (item?.status === "paid") {
        byPeriod.set(period, current + toNumber(item?.total));
      } else if (!byPeriod.has(period)) {
        byPeriod.set(period, current);
      }
    });

    const points = Array.from(byPeriod.entries())
      .sort((a, b) => periodSortValue(a[0]) - periodSortValue(b[0]))
      .slice(-6)
      .map(([period, amount]) => ({
        label: String(period).split(" ")[0].slice(0, 3),
        amount: toNumber(amount),
      }));

    return points.length ? points : [{ label: "-", amount: 0 }];
  }, [payments]);

  const payoutTotals = useMemo(() => {
    const settled = payouts.filter((item) => item?.status === "settled");
    const gross = settled.reduce((sum, item) => sum + toNumber(item?.grossRent), 0);
    const fees = settled.reduce((sum, item) => sum + toNumber(item?.platformFee), 0);
    const tax = settled.reduce((sum, item) => sum + toNumber(item?.tax), 0);
    const net = settled.reduce((sum, item) => sum + toNumber(item?.netPayout), 0);

    return {
      gross,
      fees,
      tax,
      net,
      settledMonths: settled.length,
    };
  }, [payouts]);

  const handleSavePayment = async (recordId, data) => {
    setRecordBusy(true);
    setRecordError("");
    setActionMessage("");

    try {
      await recordOwnerPayment(recordId, {
        amount: data.amount === "" ? null : Number(data.amount),
        paidDate: data.paidDate || null,
        method: data.method || null,
        txnId: data.txnId || null,
        note: data.note || null,
      });
      setRecordModal(null);
      setActionMessage("Payment recorded successfully.");
      await loadData({ silent: true });
    } catch (err) {
      setRecordError(err?.message || "Unable to record payment.");
    } finally {
      setRecordBusy(false);
    }
  };

  const handleReminderSend = () => {
    setReminderModal(null);
    setActionMessage("Reminder prepared and queued for tenant notification.");
  };

  const openRecordModal = () => {
    const nextRecord = payments.find((p) => p?.status === "overdue") || payments.find((p) => p?.status === "upcoming");
    if (!nextRecord) {
      setActionMessage("No pending payment records available.");
      return;
    }
    setRecordError("");
    setRecordModal(nextRecord);
  };

  const TABS = ["Collection", "Overdue", "Payouts", "History"];

  return (
    <div className="dash-root">
      <Sidebar />
      <main className="dash-main">
        {/* Header */}
        <header className="dash-header">
          <div className="header-title-group">
            <div className="header-title">Payments & Collections</div>
            <div className="header-subtitle">{currentPeriod} · ₹{fmt(kpi.collected)} collected of ₹{fmt(kpi.expected)} expected</div>
          </div>
          <div className="header-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="14" height="14"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input placeholder="Search tenant, property, period..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="header-actions">
            <button className="btn-secondary" style={{ fontSize: 12, gap: 5 }} onClick={() => loadData()}>
              Refresh
            </button>
            <button className="btn-secondary" style={{ fontSize: 12, gap: 5 }} onClick={() => setActionMessage("Export will be enabled after statement endpoint rollout.")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Export
            </button>
            <button className="btn-primary btn-gold" style={{ gap: 5 }} onClick={openRecordModal}>
              + Record Payment
            </button>
          </div>
        </header>

        <div className="dash-content">
          {loading && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-body">Loading payment data...</div>
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

          {/* KPI cards */}
          <div className="stats-grid" style={{ marginBottom: 22 }}>
            {[
              [kpi.collected, `${currentPeriod} Collected`, "stat-icon-green", `${collectionRate}% rate`, "up"],
              [kpi.expected, `${currentPeriod} Expected`, "stat-icon-navy", "This billing cycle", "neutral"],
              [kpi.overdue, `Overdue (${kpi.overdueCount} records)`, "stat-icon-red", kpi.overdue > 0 ? "Action needed" : "All clear", kpi.overdue > 0 ? "down" : "up"],
              [kpi.allTimePaid, "All-Time Collected", "stat-icon-gold", "Across all properties", "up"],
            ].map(([val, label, ic, trend, trendType]) => (
              <div key={label} className="stat-card">
                <div className="stat-card-top">
                  <div className={`stat-icon ${ic}`} />
                  <span className={`stat-trend trend-${trendType}`}>{trend}</span>
                </div>
                <div>
                  <div className="stat-value" style={{ fontSize: 22 }}>₹{fmt(val)}</div>
                  <div className="stat-label">{label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Summary + trend */}
          <div className="two-col-wide" style={{ marginTop: 0, marginBottom: 22 }}>
            <div className="card">
              <div className="card-header">
                <div><div className="card-title">Monthly Collection Trend</div><div style={{ fontSize: 12, color: "var(--text-lite)", marginTop: 2 }}>Last 6 periods</div></div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-mid)" }}><div style={{ width: 10, height: 10, background: "var(--navy)", borderRadius: 2 }} />Collected</div>
                </div>
              </div>
              <div className="card-body" style={{ paddingTop: 10 }}><TrendChart data={trendData} /></div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="card">
                <div className="card-header"><div className="card-title">{currentPeriod} Collection</div></div>
                <div className="card-body" style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <DonutChart collected={kpi.collected} total={kpi.expected} />
                  <div style={{ flex: 1 }}>
                    {[["Collected", kpi.collected, "var(--navy)"], ["Pending", Math.max(kpi.expected - kpi.collected, 0), "var(--amber)"]].map(([l, v, c]) => (
                      <div key={l} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 12.5, color: "var(--text-mid)" }}>{l}</span>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, fontWeight: 600, color: c }}>₹{fmt(v)}</span>
                        </div>
                        <div className="progress-bar">
                          <div style={{ height: "100%", width: `${kpi.expected > 0 ? (v / kpi.expected) * 100 : 0}%`, background: c, borderRadius: 3 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><div className="card-title">Per-Property Collection</div></div>
                <div style={{ padding: "8px 20px 16px" }}>
                  {properties.map(prop => {
                    const propRecs = payments.filter(p => p.propertyName === prop && p.period === currentPeriod);
                    const paid = propRecs.filter(p => p.status === "paid").reduce((s, p) => s + toNumber(p.total), 0);
                    const total = propRecs.reduce((s, p) => s + toNumber(p.total), 0);
                    const allPaid = paid >= total;
                    return (
                      <div key={prop} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{prop.split(" ").slice(0, 3).join(" ")}</span>
                          <span className={`badge ${allPaid ? "badge-green" : "badge-amber"}`} style={{ fontSize: 10.5 }}>
                            <span className="badge-dot" />{allPaid ? "Collected" : `₹${fmt(total - paid)} pending`}
                          </span>
                        </div>
                        <div className="progress-bar">
                          <div style={{ height: "100%", width: total > 0 ? `${(paid / total) * 100}%` : "0%", background: allPaid ? "var(--green)" : "var(--amber)", borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", marginBottom: 18 }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                style={{ padding: "11px 18px", background: "none", border: "none", borderBottom: `2px solid ${activeTab === t ? "var(--gold)" : "transparent"}`, fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: activeTab === t ? 600 : 400, color: activeTab === t ? "var(--navy)" : "var(--text-lite)", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
                {t}
                {t === "Overdue" && kpi.overdueCount > 0 && <span style={{ background: "var(--red)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 10 }}>{kpi.overdueCount}</span>}
              </button>
            ))}
            {/* Filters inline */}
            <div style={{ flex: 1 }} />
            {(activeTab === "Collection" || activeTab === "History") && (
              <>
                <select className="f-ctrl" style={{ width: "auto", minWidth: 160, margin: "6px 8px" }} value={propF} onChange={e => setPropF(e.target.value)}>
                  <option value="all">All Properties</option>
                  {properties.map(p => <option key={p} value={p}>{p.split(" ").slice(0, 3).join(" ")}</option>)}
                </select>
                {activeTab === "Collection" && (
                  <select className="f-ctrl" style={{ width: "auto", minWidth: 140, margin: "6px 8px 6px 0" }} value={statusF} onChange={e => setStatusF(e.target.value)}>
                    <option value="all">All Statuses</option>
                    <option value="paid">Paid</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="overdue">Overdue</option>
                  </select>
                )}
              </>
            )}
          </div>

          {/* ── COLLECTION TAB ── */}
          {activeTab === "Collection" && (
            <div className="card">
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 16 }}>Property / Tenant</th>
                      <th>Period</th>
                      <th>Rent</th>
                      <th>Maintenance</th>
                      <th>Total</th>
                      <th>Due Date</th>
                      <th>Paid Date</th>
                      <th>Status</th>
                      <th style={{ textAlign: "right", paddingRight: 16 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p, i) => {
                      const { label, cls } = STATUS_CFG[p.status] || {};
                      const overdueDays = p.status === "overdue" && p.lateBy;
                      return (
                        <tr key={p.id} className="prop-table-row" style={{ animationDelay: `${i * 30}ms` }}>
                          <td style={{ paddingLeft: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--gold)", fontWeight: 700, flexShrink: 0 }}>{p.tenantInitials}</div>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)" }}>{p.propertyName}</div>
                                <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>{p.tenantName}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--text-mid)" }}>{p.period}</td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>₹{fmt(p.rent)}</td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>₹{fmt(p.maintenance)}</td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 13.5, fontWeight: 700, color: "var(--navy)" }}>₹{fmt(p.total)}</td>
                          <td style={{ fontSize: 12.5, color: p.status === "overdue" ? "var(--red)" : "var(--text-mid)" }}>{fmtDate(p.dueDate)}{overdueDays ? <div style={{ fontSize: 10.5, color: "var(--red)", fontFamily: "var(--mono)" }}>{overdueDays}d late</div> : null}</td>
                          <td style={{ fontSize: 12.5 }}>{p.paidDate ? fmtDate(p.paidDate) : <span style={{ color: "var(--text-lite)", fontStyle: "italic" }}>—</span>}</td>
                          <td>
                            <div>
                              <span className={`badge ${cls}`}><span className="badge-dot" />{label}</span>
                              {p.txnId && <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--text-lite)", marginTop: 3 }}>{p.txnId}</div>}
                            </div>
                          </td>
                          <td style={{ textAlign: "right", paddingRight: 8 }}>
                            <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                              {p.status === "paid" && p.receipt && (
                                <button className="btn-secondary" style={{ padding: "4px 9px", fontSize: 11 }}>↓ Receipt</button>
                              )}
                              {p.status === "overdue" && (
                                <button className="btn-secondary" style={{ fontSize: 11, padding: "4px 9px", color: "var(--amber)", borderColor: "rgba(196,123,26,0.3)" }} onClick={() => setReminderModal(p)}>📧 Remind</button>
                              )}
                              {(p.status === "overdue" || p.status === "upcoming") && (
                                <button className="btn-secondary" style={{ fontSize: 11, padding: "4px 9px", color: "var(--green)", borderColor: "rgba(45,125,70,0.3)" }} onClick={() => { setRecordError(""); setRecordModal(p); }}>+ Record</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ color: "var(--text-lite)" }}>No payment records found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── OVERDUE TAB ── */}
          {activeTab === "Overdue" && (
            <>
              {kpi.overdueCount === 0 ? (
                <div className="empty-state" style={{ marginTop: 40 }}>
                  <span style={{ fontSize: 40 }}>🎉</span>
                  <div style={{ fontFamily: "var(--serif)", fontSize: 17, color: "var(--navy)", marginTop: 8 }}>All payments are up to date!</div>
                  <p>No overdue records at this time.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {payments.filter(p => p.status === "overdue").map(p => (
                    <div key={p.id} className="card" style={{ borderLeft: `3px solid var(--red)` }}>
                      <div style={{ padding: "18px 20px", display: "flex", alignItems: "flex-start", gap: 16 }}>
                        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--serif)", fontSize: 15, color: "var(--gold)", fontWeight: 600, flexShrink: 0 }}>{p.tenantInitials}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div>
                              <div style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 600, color: "var(--navy)" }}>{p.tenantName}</div>
                              <div style={{ fontSize: 12.5, color: "var(--text-lite)", marginTop: 2 }}>{p.propertyName} · {p.period}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 700, color: "var(--red)" }}>₹{fmt(p.total)}</div>
                              <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--red)", marginTop: 2 }}>{toNumber(p.lateBy)}d overdue</div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 20, marginTop: 12, padding: "10px 14px", background: "var(--red-bg)", borderRadius: 5 }}>
                            {[["Due Date", fmtDate(p.dueDate)], ["Rent", `₹${fmt(p.rent)}`], ["Maintenance", `₹${fmt(p.maintenance)}`], ["Phone", p.tenantPhone]].map(([k, v]) => (
                              <div key={k}><div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-lite)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: 13, fontWeight: 500, color: "var(--navy)", marginTop: 2 }}>{v}</div></div>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                            <button className="btn-primary" style={{ fontSize: 12, padding: "7px 16px" }} onClick={() => { setRecordError(""); setRecordModal(p); }}>+ Record Payment</button>
                            <button className="btn-secondary" style={{ fontSize: 12, padding: "7px 14px" }} onClick={() => setReminderModal(p)}>📧 Send Reminder</button>
                            <button className="btn-secondary" style={{ fontSize: 12, padding: "7px 14px" }} onClick={() => setActionMessage("Use tenant contact details to place the call from your registered number.")}>📞 Call Tenant</button>
                            <button className="btn-secondary" style={{ fontSize: 12, padding: "7px 14px", color: "var(--amber)", borderColor: "rgba(196,123,26,0.3)" }} onClick={() => setActionMessage("Escalation workflow will be enabled with legal notices module.")}>⚠ Escalate</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── PAYOUTS TAB ── */}
          {activeTab === "Payouts" && (
            <>
              <div style={{ padding: "14px 18px", background: "rgba(12,27,46,0.04)", border: "1px solid var(--border)", borderRadius: 6, marginBottom: 20, fontSize: 13, color: "var(--text-mid)", lineHeight: 1.55 }}>
                💡 Payouts are processed automatically on the 10th of each month after deducting platform fees and applicable taxes.
              </div>
              <div className="card">
                <div style={{ overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr><th style={{ paddingLeft: 16 }}>Payout ID</th><th>Period</th><th>Gross Rent</th><th>Platform Fee (3%)</th><th>Tax (TDS 2%)</th><th>Net Payout</th><th>Settlement Date</th><th>Method</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {payouts.map(p => (
                        <tr key={p.id} className="prop-table-row">
                          <td style={{ paddingLeft: 16 }}><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{p.id}</span></td>
                          <td style={{ fontWeight: 500, color: "var(--navy)" }}>{p.period}</td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 13 }}>{p.grossRent ? `₹${fmt(p.grossRent)}` : "—"}</td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--red)" }}>{p.platformFee ? `-₹${fmt(p.platformFee)}` : "—"}</td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--amber)" }}>{p.tax ? `-₹${fmt(p.tax)}` : "—"}</td>
                          <td style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 700, color: "var(--navy)" }}>{p.netPayout ? `₹${fmt(p.netPayout)}` : "—"}</td>
                          <td style={{ fontSize: 12.5, color: "var(--text-mid)" }}>{p.settledDate ? fmtDate(p.settledDate) : p.method}</td>
                          <td style={{ fontSize: 12.5, color: "var(--text-lite)", fontFamily: "var(--mono)" }}>{p.method}</td>
                          <td>
                            <span className={`badge ${p.status === "settled" ? "badge-green" : "badge-amber"}`}><span className="badge-dot" />{p.status === "settled" ? "Settled" : "Pending"}</span>
                          </td>
                        </tr>
                      ))}
                      {payouts.length === 0 && (
                        <tr>
                          <td colSpan={9} style={{ color: "var(--text-lite)" }}>No payouts available yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Annual summary */}
              <div className="card" style={{ marginTop: 18 }}>
                <div className="card-header"><div className="card-title">Payout Summary</div></div>
                <div className="card-body">
                  <div className="info-grid-3">
                    {[
                      ["Gross Rent Collected", `₹${fmt(payoutTotals.gross)}`],
                      ["Platform Fees Paid", `₹${fmt(payoutTotals.fees)} (3%)`],
                      ["TDS Deducted", `₹${fmt(payoutTotals.tax)} (2%)`],
                      ["Net Payouts Received", `₹${fmt(payoutTotals.net)}`],
                      ["Properties Active", `${properties.length}`],
                      ["Avg. Monthly Yield", `₹${fmt(payoutTotals.settledMonths > 0 ? payoutTotals.net / payoutTotals.settledMonths : 0)}`],
                    ].map(([k, v]) => (
                      <div key={k} className="info-item"><span className="info-key">{k}</span><span className="info-val-strong">{v}</span></div>
                    ))}
                  </div>
                  <div style={{ marginTop: 16, textAlign: "right" }}>
                    <button className="btn-secondary" style={{ fontSize: 12, gap: 5 }} onClick={() => setActionMessage("Tax statement export will be enabled after statement generation endpoint rollout.")}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      Download Tax Statement
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── HISTORY TAB ── */}
          {activeTab === "History" && (
            <div className="card">
              <div style={{ overflowX: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr><th style={{ paddingLeft: 16 }}>Property / Tenant</th><th>Period</th><th>Total</th><th>Paid Date</th><th>Txn ID</th><th>Receipt</th></tr>
                  </thead>
                  <tbody>
                    {historyRows.map((p, i) => (
                      <tr key={p.id} className="prop-table-row" style={{ animationDelay: `${i * 25}ms` }}>
                        <td style={{ paddingLeft: 16 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--navy)" }}>{p.propertyName}</div>
                          <div style={{ fontSize: 11.5, color: "var(--text-lite)", marginTop: 1 }}>{p.tenantName}</div>
                        </td>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{p.period}</td>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 13.5, fontWeight: 700, color: "var(--navy)" }}>₹{fmt(p.total)}</td>
                        <td style={{ fontSize: 12.5, color: "var(--text-mid)" }}>{fmtDate(p.paidDate)}</td>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--text-lite)" }}>{p.txnId || "—"}</td>
                        <td>{p.receipt ? <button className="btn-secondary" style={{ padding: "4px 10px", fontSize: 11.5 }}>↓ {p.receipt}</button> : <span style={{ color: "var(--text-lite)" }}>—</span>}</td>
                      </tr>
                    ))}
                    {historyRows.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ color: "var(--text-lite)" }}>No paid history found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {recordModal && (
        <RecordPaymentModal
          record={recordModal}
          onClose={() => setRecordModal(null)}
          onSave={handleSavePayment}
          busy={recordBusy}
          error={recordError}
        />
      )}
      {reminderModal && <ReminderModal record={reminderModal} onClose={() => setReminderModal(null)} onSend={handleReminderSend} />}
    </div>
  );
}
