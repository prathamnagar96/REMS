import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { applyForProperty, getTenantPropertyById } from "../services/apiClient";
import "./Dashboard.css";
import "./TenantPages.css";

const STEPS = ["Personal", "Preferences", "Consent"];

const normalizeText = (value, fallback = "-") => {
    if (value == null) return fallback;
    const text = String(value).trim();
    return text || fallback;
};

export default function TenantApply() {
    const navigate = useNavigate();
    const { propertyId } = useParams();

    const [step, setStep] = useState(0);
    const [loadingProperty, setLoadingProperty] = useState(true);
    const [propertyTitle, setPropertyTitle] = useState("Property");

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [submitted, setSubmitted] = useState(false);

    const [form, setForm] = useState({
        fullName: "",
        email: "",
        phone: "",
        moveInDate: "",
        leaseMonths: "11",
        offeredRent: "",
        note: "",
        consent: false,
    });

    useEffect(() => {
        let active = true;
        const loadProperty = async () => {
            setLoadingProperty(true);
            try {
                const response = await getTenantPropertyById(propertyId);
                if (!active) return;
                setPropertyTitle(normalizeText(response?.property?.title, "Property"));
            } catch {
                if (!active) return;
                setPropertyTitle("Property");
            } finally {
                if (active) setLoadingProperty(false);
            }
        };

        loadProperty();
        return () => {
            active = false;
        };
    }, [propertyId]);

    const progress = useMemo(() => {
        if (STEPS.length <= 1) return 0;
        return (step / (STEPS.length - 1)) * 100;
    }, [step]);

    const updateField = (event) => {
        const { name, value, type, checked } = event.target;
        setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
    };

    const canContinueStep0 = form.fullName.trim() && form.email.trim();
    const canContinueStep1 = form.leaseMonths.trim();
    const canSubmit = form.consent;

    const submit = async () => {
        setSubmitting(true);
        setSubmitError("");
        try {
            await applyForProperty(propertyId, {
                moveInDate: form.moveInDate || null,
                leaseMonths: Number(form.leaseMonths || 11),
                offeredRent: form.offeredRent === "" ? null : Number(form.offeredRent),
                note: form.note.trim() || null,
            });
            setSubmitted(true);
        } catch (err) {
            setSubmitError(err?.message || "Unable to submit application.");
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        return (
            <div style={{ minHeight: "100vh", background: "var(--cream)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center", padding: 48, maxWidth: 520 }}>
                    <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--green-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, margin: "0 auto 20px" }}>OK</div>
                    <div style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 600, color: "var(--navy)", marginBottom: 10 }}>Application Submitted</div>
                    <div style={{ fontSize: 14, color: "var(--text-mid)", lineHeight: 1.65, marginBottom: 24 }}>
                        Your application for {propertyTitle} has been sent to the owner. You can track its status from your dashboard.
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                        <button className="btn-primary" onClick={() => navigate("/tenant/dashboard")}>Open Dashboard</button>
                        <button className="btn-secondary" onClick={() => navigate("/tenant/search")}>Browse More Properties</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: "100vh", background: "var(--cream)", fontFamily: "var(--sans)" }}>
            <div style={{ background: "var(--white)", borderBottom: "1px solid var(--border)", padding: "14px 28px", display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 10 }}>
                <button className="btn-secondary" style={{ fontSize: 12, padding: "6px 12px" }} onClick={() => navigate(`/tenant/search/${propertyId}`)}>Back to Property</button>
                <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: "var(--serif)", fontSize: 16, fontWeight: 600, color: "var(--navy)" }}>Rental Application</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-lite)" }}>Step {step + 1} of {STEPS.length} - {STEPS[step]}{loadingProperty ? "" : ` - ${propertyTitle}`}</div>
                </div>
                <div style={{ height: 6, width: 180, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress}%`, background: "var(--gold)", borderRadius: 3, transition: "width 0.4s ease" }} />
                </div>
            </div>

            <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 28px 60px" }}>
                {submitError && <div className="card" style={{ marginBottom: 16 }}><div className="card-body" style={{ color: "var(--amber)" }}>{submitError}</div></div>}

                <div style={{ display: "flex", gap: 0, marginBottom: 28, borderBottom: "1px solid var(--border)", paddingBottom: 16 }}>
                    {STEPS.map((label, index) => (
                        <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                            <div
                                style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: "50%",
                                    background: index < step ? "var(--gold)" : index === step ? "rgba(12,27,46,0.06)" : "var(--surface)",
                                    border: `1.5px solid ${index < step ? "var(--gold)" : index === step ? "var(--navy)" : "var(--border)"}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontFamily: "var(--mono)",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: index < step ? "var(--navy)" : index === step ? "var(--navy)" : "var(--text-lite)",
                                }}
                            >
                                {index < step ? "OK" : index + 1}
                            </div>
                            <div style={{ fontSize: 10.5, fontFamily: "var(--mono)", color: index === step ? "var(--navy)" : index < step ? "var(--text-mid)" : "var(--text-lite)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
                        </div>
                    ))}
                </div>

                {step === 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px" }}>
                        <div className="f-grp" style={{ gridColumn: "span 2" }}>
                            <label className="f-lbl">Full Name</label>
                            <input className="f-ctrl" name="fullName" value={form.fullName} onChange={updateField} placeholder="Your full name" />
                        </div>
                        <div className="f-grp">
                            <label className="f-lbl">Email</label>
                            <input className="f-ctrl" name="email" type="email" value={form.email} onChange={updateField} placeholder="you@email.com" />
                        </div>
                        <div className="f-grp">
                            <label className="f-lbl">Phone</label>
                            <input className="f-ctrl" name="phone" value={form.phone} onChange={updateField} placeholder="+91 ..." />
                        </div>
                    </div>
                )}

                {step === 1 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 20px" }}>
                        <div className="f-grp">
                            <label className="f-lbl">Preferred Move-in Date</label>
                            <input className="f-ctrl" type="date" name="moveInDate" value={form.moveInDate} onChange={updateField} />
                        </div>
                        <div className="f-grp">
                            <label className="f-lbl">Preferred Lease Duration</label>
                            <select className="f-ctrl" name="leaseMonths" value={form.leaseMonths} onChange={updateField}>
                                <option value="6">6 Months</option>
                                <option value="11">11 Months</option>
                                <option value="12">12 Months</option>
                                <option value="24">24 Months</option>
                            </select>
                        </div>
                        <div className="f-grp">
                            <label className="f-lbl">Offered Monthly Rent (optional)</label>
                            <input className="f-ctrl" type="number" name="offeredRent" value={form.offeredRent} onChange={updateField} placeholder="Enter amount" />
                        </div>
                        <div className="f-grp" style={{ gridColumn: "span 2" }}>
                            <label className="f-lbl">Message to Owner</label>
                            <textarea className="f-ctrl" rows={4} name="note" value={form.note} onChange={updateField} placeholder="Briefly introduce yourself and mention why you are interested in this property." style={{ resize: "vertical" }} />
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div>
                        <div style={{ marginBottom: 20, padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>
                            <strong style={{ display: "block", marginBottom: 6 }}>Review Summary</strong>
                            {[
                                ["Applicant", form.fullName || "-"],
                                ["Email", form.email || "-"],
                                ["Phone", form.phone || "-"],
                                ["Move-in", form.moveInDate || "-"],
                                ["Lease", `${form.leaseMonths} months`],
                                ["Offered Rent", form.offeredRent ? `INR ${form.offeredRent}` : "Not specified"],
                            ].map(([key, value]) => (
                                <div key={key} style={{ display: "flex", gap: 16, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                                    <span style={{ color: "var(--text-lite)", minWidth: 140, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>{key}</span>
                                    <span style={{ fontWeight: 500, color: "var(--navy)" }}>{value}</span>
                                </div>
                            ))}
                        </div>

                        <label style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 16px", background: "var(--white)", border: "1.5px solid var(--border)", borderRadius: 6, cursor: "pointer" }}>
                            <input type="checkbox" name="consent" checked={form.consent} onChange={updateField} style={{ marginTop: 2, accentColor: "var(--navy)" }} />
                            <span style={{ fontSize: 13, color: "var(--text-mid)", lineHeight: 1.6 }}>I confirm all information provided is accurate and I agree to owner verification and communication for this rental application.</span>
                        </label>
                    </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 28 }}>
                    {step > 0 ? (
                        <button className="btn-secondary" style={{ padding: "12px 20px" }} onClick={() => setStep((prev) => prev - 1)}>Back</button>
                    ) : <div />}

                    {step < STEPS.length - 1 ? (
                        <button
                            className="btn-primary"
                            style={{ padding: "12px 28px", fontSize: 14, fontWeight: 600 }}
                            disabled={(step === 0 && !canContinueStep0) || (step === 1 && !canContinueStep1)}
                            onClick={() => setStep((prev) => prev + 1)}
                        >
                            Continue
                        </button>
                    ) : (
                        <button className="btn-primary btn-gold" style={{ padding: "12px 32px", fontSize: 14, fontWeight: 700 }} disabled={!canSubmit || submitting} onClick={submit}>
                            {submitting ? "Submitting..." : "Submit Application"}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
