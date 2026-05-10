import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { COUNTRIES, DEFAULT_COUNTRY_CODE, getCountryMeta, getIdPlaceholder, validateIdNumber, validatePostalCode, validators } from "../utils/validation";
import { lookupPin } from "../services/pincodeService";
import { forgotPassword, googleLogin, login, registerOwner, registerTenant, resetPassword, sendSignupOtp, verifySignupOtp } from "../services/apiClient";
import { useAuth } from "../context/AuthContext";
import "./Authpage.css";

const COUNTRY_DIAL_OPTIONS = COUNTRIES.map(country => ({ value: country.code, label: country.name, dialCode: country.dialCode }));
const COUNTRY_NAME_OPTIONS = COUNTRIES.map(country => ({ value: country.code, label: country.name }));
const PHONE_INPUT_PROPS = { inputMode: "tel", pattern: "[0-9+\\s-]*", maxLength: 15 };
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MEDIA_RULES = {
    exteriorImages: { max: 5, required: true, label: "Building / Exterior Photos" },
    livingRoomImages: { max: 5, required: true, label: "Living Room Photos" },
    galleryImages: { max: 5, required: false, label: "Gallery / Balcony Photos" },
    washroomImages: { max: 5, required: true, label: "Washroom Photos" },
    documents: { max: 6, required: true, label: "Ownership & Legal Documents" },
};

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

const ensureGoogleScript = () => {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("Google sign-in requires a browser environment."));
    }

    if (window.google?.accounts?.id) {
        return Promise.resolve(window.google);
    }

    return new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-google-identity="true"]');
        if (existing) {
            existing.addEventListener("load", () => resolve(window.google));
            existing.addEventListener("error", () => reject(new Error("Failed to load Google sign-in.")));
            return;
        }

        const script = document.createElement("script");
        script.src = GOOGLE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.dataset.googleIdentity = "true";
        script.onload = () => resolve(window.google);
        script.onerror = () => reject(new Error("Failed to load Google sign-in."));
        document.head.appendChild(script);
    });
};

const validateMediaFiles = (name, fileList) => {
    const rule = MEDIA_RULES[name];
    if (!rule) return { valid: true };

    const files = Array.from(fileList || []);
    if (!files.length) {
        return rule.required ? { valid: false, message: `${rule.label} are required` } : { valid: true };
    }

    if (files.length > rule.max) {
        return { valid: false, message: `Maximum ${rule.max} files allowed for ${rule.label}` };
    }

    const oversize = files.find(f => f.size > MAX_FILE_SIZE_BYTES);
    if (oversize) {
        return { valid: false, message: `${oversize.name} exceeds 10 MB limit` };
    }

    return { valid: true };
};

const getDialCode = (code) => getCountryMeta(code)?.dialCode || "+";

// ─── Three.js — Architectural Model ──────────────────────────────────────────
function ArchCanvas() {
    const mountRef = useRef(null);
    useEffect(() => {
        const mount = mountRef.current;
        const W = mount.clientWidth, H = mount.clientHeight;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(W, H);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 500);
        camera.position.set(20, 22, 32);
        camera.lookAt(0, 4, 0);

        const gridHelper = new THREE.GridHelper(36, 18, 0xB8943F, 0x1e3a5f);
        scene.add(gridHelper);

        const buildings = [
            { x: -7, z: -5, w: 5, h: 18, d: 4 },
            { x: 0, z: -6, w: 3.5, h: 28, d: 3.5 },
            { x: 7, z: -4, w: 4, h: 14, d: 5 },
            { x: -9, z: 2, w: 3, h: 10, d: 3 },
            { x: -3, z: 3, w: 6, h: 8, d: 4 },
            { x: 5, z: 4, w: 4, h: 20, d: 3.5 },
            { x: 10, z: -1, w: 3, h: 12, d: 4 },
            { x: -12, z: -2, w: 3.5, h: 16, d: 3.5 },
        ];

        const wireMat = new THREE.MeshBasicMaterial({ color: 0xB8943F, wireframe: true, transparent: true, opacity: 0.5 });
        const faceMat = new THREE.MeshBasicMaterial({ color: 0x0c1b2e, transparent: true, opacity: 0.88 });

        const group = new THREE.Group();
        buildings.forEach(({ x, z, w, h, d }) => {
            const geo = new THREE.BoxGeometry(w, h, d);
            const face = new THREE.Mesh(geo, faceMat);
            const wire = new THREE.Mesh(geo, wireMat);
            face.position.set(x, h / 2, z);
            wire.position.set(x, h / 2, z);
            group.add(face, wire);
        });
        scene.add(group);

        let frameId;
        const clock = new THREE.Clock();
        const animate = () => {
            frameId = requestAnimationFrame(animate);
            group.rotation.y = clock.getElapsedTime() * 0.055;
            renderer.render(scene, camera);
        };
        animate();

        const onResize = () => {
            const nW = mount.clientWidth, nH = mount.clientHeight;
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
    return <div ref={mountRef} className="arch-canvas" />;
}

// ─── Field Component ──────────────────────────────────────────────────────────
const Field = ({
    label,
    name,
    type = "text",
    value,
    onChange,
    options = [],
    placeholder,
    required,
    half,
    accept,
    error,
    hint,
    onBlur,
    countryName,
    countryValue,
    onCountryChange,
    ...rest
}) => {
    const wrapClass = (extra = "") => `field-wrap${half ? " half" : ""}${extra}${error ? " has-error" : ""}`;
    const message = error
        ? <span className="f-msg f-error">{error}</span>
        : hint ? <span className="f-msg f-hint">{hint}</span> : null;

    if (type === "select") return (
        <div className={wrapClass()}>
            <label className="f-label">{label}{required && <span className="f-req"> *</span>}</label>
            <div className="f-sel-wrap">
                <select className="f-sel" name={name} value={value} onChange={onChange} onBlur={onBlur} {...rest}>
                    <option value="">Select</option>
                    {options.map(o => {
                        const optionValue = typeof o === "string" ? o : o.value;
                        const optionLabel = typeof o === "string" ? o : o.label;
                        return <option key={optionValue || optionLabel} value={optionValue}>{optionLabel}</option>;
                    })}
                </select>
                <span className="sel-caret">▾</span>
            </div>
            {message}
        </div>
    );

    if (type === "phone") return (
        <div className={wrapClass(half ? "" : " full") + " phone-field"}>
            <label className="f-label">{label}{required && <span className="f-req"> *</span>}</label>
            <div className="phone-input">
                <div className="dial-number">
                    <span className="dial-prefix">{getDialCode(countryValue)}</span>
                    <input className="f-in phone-number" type="tel" name={name} value={value} onChange={onChange} onBlur={onBlur}
                        placeholder={placeholder} autoComplete="tel" aria-invalid={Boolean(error)} {...rest} />
                </div>
                <select className="dial-select" name={countryName} value={countryValue} onChange={onCountryChange}>
                    {options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            </div>
            {message}
        </div>
    );

    if (type === "textarea") return (
        <div className={wrapClass(" full")}>
            <label className="f-label">{label}{required && <span className="f-req"> *</span>}</label>
            <textarea className="f-in f-ta" name={name} value={value} onChange={onChange} onBlur={onBlur}
                placeholder={placeholder} rows={3} {...rest} />
            {message}
        </div>
    );

    if (type === "chips") return (
        <div className={wrapClass(" full")}>
            <label className="f-label">{label}</label>
            <div className="chips">
                {options.map(o => (
                    <button key={o} type="button" className={`chip ${(value || []).includes(o) ? "chip-on" : ""}`}
                        onClick={() => onChange(name, o)}>{o}</button>
                ))}
            </div>
            {message}
        </div>
    );

    if (type === "file") return (
        <div className={wrapClass(" full")}>
            <label className="f-label">{label}{required && <span className="f-req"> *</span>}</label>
            <label className="file-drop">
                <input type="file" multiple hidden name={name} onChange={onChange} accept={accept || "image/*,.pdf"} required={required} />
                <div className="file-up-icon">↑</div>
                <span className="file-up-text">Click or drag files here</span>
                <span className="file-up-hint">JPG, PNG, PDF — max 10 MB each</span>
                {value && value.length > 0 && <span className="file-count">{value.length} file(s) ready</span>}
            </label>
            {message}
        </div>
    );

    return (
        <div className={wrapClass()}>
            <label className="f-label">{label}{required && <span className="f-req"> *</span>}</label>
            <input className="f-in" type={type} name={name} value={value} onChange={onChange}
                placeholder={placeholder} required={required} autoComplete="off" onBlur={onBlur}
                aria-invalid={Boolean(error)} {...rest} />
            {message}
        </div>
    );
};

// ─── Step Progress ────────────────────────────────────────────────────────────
const Progress = ({ steps, current }) => (
    <div className="progress">
        {steps.map((s, i) => (
            <div key={i} className={`ps ${i < current ? "ps-done" : i === current ? "ps-active" : ""}`}>
                <div className="ps-dot">{i < current ? "✓" : i + 1}</div>
                <span className="ps-name">{s}</span>
                {i < steps.length - 1 && <div className="ps-line" />}
            </div>
        ))}
    </div>
);

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginForm() {
    const { session, loginWithSession } = useAuth();
    const [data, setData] = useState({ email: "", password: "", role: "tenant" });
    const [errors, setErrors] = useState({});
    const createSubmitStatus = () => ({ loading: false, success: false, error: "", message: "" });
    const [submitStatus, setSubmitStatus] = useState(createSubmitStatus);
    const [rememberMe, setRememberMe] = useState(false);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [forgotData, setForgotData] = useState({
        email: "",
        otp: "",
        newPassword: "",
        confirmPassword: "",
    });
    const [forgotStatus, setForgotStatus] = useState({ loading: false, error: "", message: "", otp: "" });
    const [googleReady, setGoogleReady] = useState(false);
    const [googleLoadError, setGoogleLoadError] = useState("");
    const googleButtonRef = useRef(null);
    const googleInitRef = useRef(false);
    const roleRef = useRef(data.role);
    const rememberRef = useRef(rememberMe);
    const resetSubmitStatus = () => setSubmitStatus(prev => (prev.success || prev.error || prev.message ? createSubmitStatus() : prev));
    const loginChecks = {
        email: validators.email,
        password: (val) => (val ? validators.password(val) : "Enter your password"),
    };
    useEffect(() => {
        if (!session) return;
        setData(prev => ({
            ...prev,
            email: session.profile?.email || prev.email,
            role: session.role || prev.role,
        }));
        setForgotData(prev => ({
            ...prev,
            email: session.profile?.email || prev.email,
        }));
        setRememberMe(Boolean(session.remember));
    }, [session]);

    useEffect(() => {
        roleRef.current = data.role;
    }, [data.role]);

    useEffect(() => {
        rememberRef.current = rememberMe;
    }, [rememberMe]);

    const handleGoogleCredential = useCallback(async (credential) => {
        if (!credential) {
            setSubmitStatus({
                loading: false,
                success: false,
                error: "Google did not return credentials.",
                message: "",
            });
            return;
        }

        setSubmitStatus({ loading: true, success: false, error: "", message: "" });
        try {
            const response = await googleLogin({ credential, role: roleRef.current });
            if (!response?.accessToken) {
                throw new Error("Authentication response missing access token");
            }

            loginWithSession(
                {
                    accessToken: response.accessToken,
                    profile: response.profile,
                    role: response.role,
                    expiresIn: response.expiresIn,
                },
                { remember: rememberRef.current },
            );

            setSubmitStatus({
                loading: false,
                success: true,
                error: "",
                message: "Signed in with Google.",
            });
        } catch (err) {
            setSubmitStatus({
                loading: false,
                success: false,
                error: err?.message || "Unable to sign in with Google",
                message: "",
            });
        }
    }, [loginWithSession]);

    useEffect(() => {
        let active = true;
        if (!GOOGLE_CLIENT_ID) {
            return undefined;
        }

        ensureGoogleScript()
            .then(() => {
                if (!active) return;
                setGoogleReady(true);
            })
            .catch((err) => {
                if (!active) return;
                setGoogleLoadError(err?.message || "Failed to load Google sign-in.");
                setGoogleReady(false);
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!GOOGLE_CLIENT_ID || !googleReady || googleInitRef.current) return;
        if (!googleButtonRef.current || !window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (response) => handleGoogleCredential(response?.credential),
            ux_mode: "popup",
            auto_select: false,
        });

        window.google.accounts.id.renderButton(googleButtonRef.current, {
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "left",
        });

        googleInitRef.current = true;
    }, [googleReady, handleGoogleCredential]);
    const runCheck = (name, value) => {
        const fn = loginChecks[name];
        if (!fn) return null;
        return fn(value ?? data[name]);
    };
    const googleUnavailableMessage = GOOGLE_CLIENT_ID
        ? (googleLoadError || "Google sign-in is still loading. Try again in a moment.")
        : "Google sign-in is not configured.";
    const ch = e => {
        const { name, value } = e.target;
        setData(p => ({ ...p, [name]: value }));
        if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
        resetSubmitStatus();
    };
    const handleBlur = e => {
        const { name } = e.target;
        if (!loginChecks[name]) return;
        setErrors(prev => ({ ...prev, [name]: runCheck(name) }));
    };
    const handleSubmit = async () => {
        const nextErrors = {};
        Object.keys(loginChecks).forEach(key => {
            const message = runCheck(key);
            if (message) nextErrors[key] = message;
        });
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) return;

        setSubmitStatus({ loading: true, success: false, error: "", message: "" });
        try {
            const response = await login({ email: data.email, password: data.password, role: data.role });
            if (!response?.accessToken) {
                throw new Error("Authentication response missing access token");
            }

            loginWithSession(
                {
                    accessToken: response.accessToken,
                    profile: response.profile,
                    role: response.role,
                    expiresIn: response.expiresIn,
                },
                { remember: rememberMe },
            );

            setSubmitStatus({
                loading: false,
                success: true,
                error: "",
                message: "Signed in successfully.",
            });
        } catch (err) {
            setSubmitStatus({
                loading: false,
                success: false,
                error: err?.message || "Unable to sign in",
                message: "",
            });
        }
    };

    const handleForgotInput = (event) => {
        const { name, value } = event.target;
        setForgotData(prev => ({ ...prev, [name]: value }));
        if (forgotStatus.error || forgotStatus.message) {
            setForgotStatus({ loading: false, error: "", message: "", otp: "" });
        }
    };

    const handleForgotRequest = async () => {
        const emailError = validators.email(forgotData.email || data.email);
        if (emailError) {
            setForgotStatus({ loading: false, error: emailError, message: "", otp: "" });
            return;
        }

        setForgotStatus({ loading: true, error: "", message: "", otp: "" });
        try {
            const response = await forgotPassword({ email: forgotData.email || data.email });
            const otp = response?.otp || "";
            setForgotData(prev => ({
                ...prev,
                email: forgotData.email || data.email,
                otp: otp || prev.otp,
            }));
            setForgotStatus({
                loading: false,
                error: "",
                message: response?.message || "If the email exists, reset instructions have been sent.",
                otp,
            });
        } catch (err) {
            setForgotStatus({ loading: false, error: err?.message || "Unable to process request", message: "", otp: "" });
        }
    };

    const handlePasswordReset = async () => {
        const otp = forgotData.otp.trim();
        const newPasswordError = validators.password(forgotData.newPassword);
        const confirmError = forgotData.confirmPassword === forgotData.newPassword ? null : "Passwords must match";

        if (!forgotData.email || validators.email(forgotData.email)) {
            setForgotStatus({ loading: false, error: "Enter a valid email", message: "", otp: forgotStatus.otp });
            return;
        }
        if (!otp) {
            setForgotStatus({ loading: false, error: "Enter the OTP", message: "", otp: forgotStatus.otp });
            return;
        }
        if (newPasswordError) {
            setForgotStatus({ loading: false, error: newPasswordError, message: "", otp: forgotStatus.otp });
            return;
        }
        if (confirmError) {
            setForgotStatus({ loading: false, error: confirmError, message: "", otp: forgotStatus.otp });
            return;
        }

        setForgotStatus(prev => ({ ...prev, loading: true, error: "", message: "" }));
        try {
            const response = await resetPassword({
                email: forgotData.email,
                otp,
                newPassword: forgotData.newPassword,
                confirmPassword: forgotData.confirmPassword,
            });
            setForgotStatus({
                loading: false,
                error: "",
                message: response?.message || "Password has been reset. You can sign in now.",
                otp: "",
            });
            setShowForgotPassword(false);
            setData(prev => ({ ...prev, password: "" }));
            setForgotData(prev => ({ ...prev, otp: "", newPassword: "", confirmPassword: "" }));
        } catch (err) {
            setForgotStatus(prev => ({ ...prev, loading: false, error: err?.message || "Unable to reset password" }));
        }
    };

    const isFormValid = !submitStatus.loading && Object.keys(loginChecks).every(key => !runCheck(key));

    return (
        <div className="form-body">
            <div className="form-head">
                <p className="eyebrow">Welcome back</p>
                <h2 className="heading">Sign In</h2>
                <p className="sub-text">Access your rental management dashboard</p>
            </div>

            <div className="role-toggle">
                {[["tenant", "I'm a Tenant", "👤"], ["owner", "I'm a Property Owner", "🏠"]].map(([r, l, ic]) => (
                    <button key={r} type="button" className={`role-btn ${data.role === r ? "role-on" : ""}`}
                        onClick={() => {
                            setData(p => ({ ...p, role: r }));
                            resetSubmitStatus();
                        }}>
                        <span>{ic}</span> {l}
                    </button>
                ))}
            </div>

            <div className="fields-col">
                <Field label="Email Address" name="email" type="email" value={data.email} onChange={ch}
                    placeholder="you@example.com" required error={errors.email} onBlur={handleBlur} />
                <Field label="Password" name="password" type="password" value={data.password} onChange={ch}
                    placeholder="Enter your password" required error={errors.password} onBlur={handleBlur} />
            </div>

            <div className="row-between">
                <label className="remember">
                    <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={e => {
                            setRememberMe(e.target.checked);
                            resetSubmitStatus();
                        }}
                        disabled={submitStatus.loading}
                    />
                    <span>Remember me</span>
                </label>
                <button
                    type="button"
                    className="txt-link"
                    disabled={submitStatus.loading || forgotStatus.loading}
                    onClick={() => setShowForgotPassword(prev => !prev)}
                >
                    {showForgotPassword ? "Back to login" : "Forgot password?"}
                </button>
            </div>

            {showForgotPassword && (
                <div className="fields-col">
                    <Field
                        label="Recovery Email"
                        name="email"
                        type="email"
                        value={forgotData.email}
                        onChange={handleForgotInput}
                        placeholder="you@example.com"
                        required
                    />
                    <button className="cta" type="button" onClick={handleForgotRequest} disabled={forgotStatus.loading}>
                        {forgotStatus.loading ? "Sending..." : "Send OTP"}
                    </button>

                    <Field
                        label="OTP"
                        name="otp"
                        value={forgotData.otp}
                        onChange={handleForgotInput}
                        placeholder="Enter 6-digit OTP"
                    />
                    <Field
                        label="New Password"
                        name="newPassword"
                        type="password"
                        value={forgotData.newPassword}
                        onChange={handleForgotInput}
                        placeholder="Minimum 8 characters"
                    />
                    <Field
                        label="Confirm New Password"
                        name="confirmPassword"
                        type="password"
                        value={forgotData.confirmPassword}
                        onChange={handleForgotInput}
                        placeholder="Re-enter password"
                    />
                    <button className="cta" type="button" onClick={handlePasswordReset} disabled={forgotStatus.loading}>
                        {forgotStatus.loading ? "Updating..." : "Reset Password"}
                    </button>

                    {forgotStatus.otp && (
                        <p className="f-msg f-hint submit-msg">Use the OTP above. In production, this should only come via email.</p>
                    )}
                    {forgotStatus.message && <p className="f-msg f-hint submit-msg">{forgotStatus.message}</p>}
                    {forgotStatus.error && <p className="f-msg f-error submit-msg">{forgotStatus.error}</p>}
                </div>
            )}

            <button className="cta" type="button" onClick={handleSubmit} disabled={!isFormValid}>
                {submitStatus.loading ? "Signing In..." : <>Sign In <span className="cta-arr">→</span></>}
            </button>

            {submitStatus.success && <p className="f-msg f-hint submit-msg">{submitStatus.message || "Signed in successfully."}</p>}
            {submitStatus.error && <p className="f-msg f-error submit-msg">{submitStatus.error}</p>}

            <div className="or-divider"><span>or continue with</span></div>

            <div className="socials">
                {GOOGLE_CLIENT_ID && googleReady ? (
                    <div className={`google-btn-wrap ${submitStatus.loading ? "is-disabled" : ""}`}>
                        <div ref={googleButtonRef} className="google-btn" />
                    </div>
                ) : (
                    <button
                        className="social-btn"
                        type="button"
                        disabled={submitStatus.loading}
                        onClick={() => setSubmitStatus({ loading: false, success: false, error: googleUnavailableMessage, message: "" })}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                        Google
                    </button>
                )}
            </div>
        </div>
    );
}

// ─── TENANT REGISTER ──────────────────────────────────────────────────────────
const T_STEPS = ["Personal", "Identity", "Preferences", "Emergency"];

function TenantForm({ onSwitch }) {
    const [step, setStep] = useState(0);
    const [data, setData] = useState({
        fullName: "", email: "", emailOtp: "", phoneCountry: DEFAULT_COUNTRY_CODE, phone: "", dob: "", password: "", confirmPassword: "",
        idType: "", idNumber: "", occupation: "", employer: "", monthlyIncome: "", workCity: "",
        preferredCity: "", maxBudget: "", occupants: "", petOwner: "", furnishingPref: "",
        leaseDuration: "", moveInDate: "", specialRequirements: "", amenities: [],
        emergencyName: "", emergencyRelation: "", emergencyPhoneCountry: DEFAULT_COUNTRY_CODE, emergencyPhone: "",
        tenantConsent: false,
    });
    const [errors, setErrors] = useState({});
    const [submitStatus, setSubmitStatus] = useState({ loading: false, success: false, error: "" });
    const [signupOtpStatus, setSignupOtpStatus] = useState({ loading: false, message: "", error: "" });

    const resetSubmitStatus = () => setSubmitStatus(prev => (prev.success || prev.error ? { loading: false, success: false, error: "" } : prev));

    const tenantChecks = {
        fullName: (val) => (val.trim() ? null : "Enter your full name"),
        email: validators.email,
        emailOtp: (val) => (/^\d{6}$/.test((val || "").trim()) ? null : "Enter the 6-digit email OTP"),
        phone: validators.phone,
        dob: (val) => (val ? null : "Select your birth date"),
        password: validators.password,
        confirmPassword: (val, form) => (val && val === form.password ? null : "Passwords must match"),
        idType: (val) => (val ? null : "Choose an ID type"),
        idNumber: (val, form) => {
            const result = validateIdNumber(form.idType, val);
            return result.valid ? null : result.message;
        },
        occupation: (val) => (val ? null : "Select employment type"),
        monthlyIncome: (val) => (Number(val) > 0 ? null : "Enter monthly income"),
        preferredCity: (val) => (val.trim() ? null : "Enter preferred locality"),
        maxBudget: (val) => (Number(val) > 0 ? null : "Enter a valid budget"),
        occupants: (val) => (val ? null : "Select number of occupants"),
        petOwner: (val) => (val ? null : "Select an option"),
        furnishingPref: (val) => (val ? null : "Choose furnishing"),
        leaseDuration: (val) => (val ? null : "Select lease duration"),
        emergencyName: (val) => (val.trim() ? null : "Enter emergency contact"),
        emergencyRelation: (val) => (val ? null : "Select relationship"),
        emergencyPhone: validators.phone,
        tenantConsent: (val) => (val ? null : "Please accept the terms"),
    };

    const TENANT_STEP_FIELDS = [
        ["fullName", "email", "emailOtp", "phone", "dob", "password", "confirmPassword"],
        ["idType", "idNumber", "occupation", "monthlyIncome"],
        ["preferredCity", "maxBudget", "occupants", "petOwner", "furnishingPref", "leaseDuration"],
        ["emergencyName", "emergencyRelation", "emergencyPhone", "tenantConsent"],
    ];

    const allTenantFields = Array.from(new Set(TENANT_STEP_FIELDS.flat()));
    const runValidation = (field) => {
        const fn = tenantChecks[field];
        if (!fn) return null;
        return fn(data[field], data) || null;
    };

    const ch = e => {
        const { name, value } = e.target;
        setData(p => ({ ...p, [name]: value }));
        if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
        if (name === "email" || name === "emailOtp") {
            setSignupOtpStatus({ loading: false, message: "", error: "" });
        }
        resetSubmitStatus();
    };

    const handleSendSignupOtp = async () => {
        const emailError = validators.email(data.email);
        if (emailError) {
            setErrors(prev => ({ ...prev, email: emailError }));
            setSignupOtpStatus({ loading: false, message: "", error: "Enter a valid email before requesting OTP" });
            return;
        }

        setSignupOtpStatus({ loading: true, message: "", error: "" });
        try {
            const response = await sendSignupOtp({ email: data.email, role: "tenant" });
            setSignupOtpStatus({
                loading: false,
                message: response?.message || "Signup OTP sent to your email.",
                error: "",
            });
        } catch (err) {
            setSignupOtpStatus({ loading: false, message: "", error: err?.message || "Unable to send signup OTP" });
        }
    };

    const toggle = (name, val) => {
        setData(p => {
            const current = p[name] || [];
            const next = current.includes(val) ? current.filter(x => x !== val) : [...current, val];
            return { ...p, [name]: next };
        });
        if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
        resetSubmitStatus();
    };

    const handleBlur = e => {
        const { name } = e.target;
        if (!tenantChecks[name]) return;
        setErrors(prev => ({ ...prev, [name]: runValidation(name) }));
    };

    const validateStep = () => {
        const fields = TENANT_STEP_FIELDS[step] || [];
        const nextErrors = {};
        fields.forEach(field => {
            const message = runValidation(field);
            if (message) nextErrors[field] = message;
        });
        if (Object.keys(nextErrors).length) {
            setErrors(prev => ({ ...prev, ...nextErrors }));
            return false;
        }
        return true;
    };

    const handleNext = async () => {
        if (signupOtpStatus.loading) return;
        if (!validateStep()) return;

        if (step === 0) {
            setSignupOtpStatus({ loading: true, message: "", error: "" });
            try {
                await verifySignupOtp({
                    email: data.email,
                    otp: data.emailOtp.trim(),
                });
                setSignupOtpStatus({ loading: false, message: "OTP verified.", error: "" });
            } catch (err) {
                setSignupOtpStatus({
                    loading: false,
                    message: "",
                    error: err?.message || "Invalid or expired signup OTP",
                });
                return;
            }
        }

        setStep(s => s + 1);
    };

    const handleComplete = async () => {
        if (submitStatus.loading) return;
        const nextErrors = {};
        allTenantFields.forEach(field => {
            const message = runValidation(field);
            if (message) nextErrors[field] = message;
        });
        setErrors(prev => ({ ...prev, ...nextErrors }));
        if (Object.keys(nextErrors).length) return;

        setSubmitStatus({ loading: true, success: false, error: "" });
        try {
            await registerTenant(data);
            setSubmitStatus({ loading: false, success: true, error: "" });
        } catch (err) {
            setSubmitStatus({
                loading: false,
                success: false,
                error: err?.message || "Unable to submit registration",
            });
        }
    };

    const canAdvance = (TENANT_STEP_FIELDS[step] || []).every(field => !runValidation(field));
    const canComplete = allTenantFields.every(field => !runValidation(field));

    return (
        <div className="form-body">
            <div className="form-head">
                <p className="eyebrow">Tenant Registration</p>
                <h2 className="heading">Create Your Account</h2>
                <p className="sub-text">Find and manage your rental home</p>
            </div>
            <Progress steps={T_STEPS} current={step} />

            {step === 0 && (
                <div className="fields-grid">
                    <Field label="Full Legal Name" name="fullName" value={data.fullName} onChange={ch}
                        placeholder="As on government ID" required error={errors.fullName} onBlur={handleBlur} />
                    <Field label="Email Address" name="email" type="email" value={data.email} onChange={ch}
                        placeholder="you@email.com" required error={errors.email} onBlur={handleBlur} />
                    <div className={`field-wrap half${errors.emailOtp ? " has-error" : ""}`}>
                        <label className="f-label">Email OTP<span className="f-req"> *</span></label>
                        <input
                            className="f-in"
                            type="text"
                            name="emailOtp"
                            value={data.emailOtp}
                            onChange={ch}
                            onBlur={handleBlur}
                            placeholder="Enter 6-digit OTP"
                            inputMode="numeric"
                            pattern="\\d*"
                            maxLength={6}
                            autoComplete="one-time-code"
                            aria-invalid={Boolean(errors.emailOtp)}
                        />
                        {errors.emailOtp && <span className="f-msg f-error">{errors.emailOtp}</span>}
                    </div>
                    <button
                        type="button"
                        className="cta otp-send-btn"
                        onClick={handleSendSignupOtp}
                        disabled={signupOtpStatus.loading}
                    >
                        {signupOtpStatus.loading ? "Sending OTP..." : "Send Email OTP"}
                    </button>
                    {signupOtpStatus.message && <p className="f-msg f-hint submit-msg otp-status">{signupOtpStatus.message}</p>}
                    {signupOtpStatus.error && <p className="f-msg f-error submit-msg otp-status">{signupOtpStatus.error}</p>}
                    <Field label="Phone Number" name="phone" type="phone" value={data.phone} onChange={ch}
                        countryName="phoneCountry" countryValue={data.phoneCountry} onCountryChange={ch}
                        options={COUNTRY_DIAL_OPTIONS} placeholder="Enter your number" required half error={errors.phone}
                        onBlur={handleBlur} {...PHONE_INPUT_PROPS} />
                    <Field label="Date of Birth" name="dob" type="date" value={data.dob} onChange={ch}
                        required half error={errors.dob} onBlur={handleBlur} />
                    <Field label="Password" name="password" type="password" value={data.password} onChange={ch}
                        placeholder="Minimum 8 characters" required half error={errors.password} onBlur={handleBlur} />
                    <Field label="Confirm Password" name="confirmPassword" type="password" value={data.confirmPassword} onChange={ch}
                        placeholder="Re-enter password" required half error={errors.confirmPassword} onBlur={handleBlur} />
                </div>
            )}
            {step === 1 && (
                <div className="fields-grid">
                    <Field label="Government ID Type" name="idType" type="select" value={data.idType} onChange={ch}
                        required error={errors.idType} onBlur={handleBlur}
                        options={[{ value: "aadhaar", label: "Aadhaar Card" }, { value: "passport", label: "Passport" }, { value: "dl", label: "Driving Licence" }, { value: "voter", label: "Voter ID" }, { value: "pan", label: "PAN Card" }]} />
                    <Field label="ID Number" name="idNumber" value={data.idNumber} onChange={ch}
                        placeholder={getIdPlaceholder(data.idType)} required error={errors.idNumber} onBlur={handleBlur} />
                    <Field label="Employment Type" name="occupation" type="select" value={data.occupation} onChange={ch}
                        required error={errors.occupation} onBlur={handleBlur}
                        options={[{ value: "salaried", label: "Salaried Employee" }, { value: "self", label: "Self-Employed" }, { value: "business", label: "Business Owner" }, { value: "student", label: "Student" }, { value: "retired", label: "Retired" }, { value: "other", label: "Other" }]} />
                    <Field label="Employer / Institution" name="employer" value={data.employer} onChange={ch}
                        placeholder="Company or college" />
                    <Field label="Monthly Net Income (₹)" name="monthlyIncome" type="number" value={data.monthlyIncome} onChange={ch}
                        placeholder="55000" required half error={errors.monthlyIncome} onBlur={handleBlur} min="0" />
                    <Field label="Work Location" name="workCity" value={data.workCity} onChange={ch}
                        placeholder="e.g. Bandra, Mumbai" half />
                </div>
            )}
            {step === 2 && (
                <div className="fields-grid">
                    <Field label="Preferred Area / Locality" name="preferredCity" value={data.preferredCity} onChange={ch}
                        placeholder="e.g. Powai, Andheri" required error={errors.preferredCity} onBlur={handleBlur} />
                    <Field label="Maximum Monthly Budget (₹)" name="maxBudget" type="number" value={data.maxBudget} onChange={ch}
                        placeholder="30000" required error={errors.maxBudget} onBlur={handleBlur} min="0" />
                    <Field label="Number of Occupants" name="occupants" type="select" value={data.occupants} onChange={ch}
                        half required error={errors.occupants} onBlur={handleBlur}
                        options={[1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} person${n > 1 ? "s" : ""}` }))} />
                    <Field label="Do you have pets?" name="petOwner" type="select" value={data.petOwner} onChange={ch}
                        half required error={errors.petOwner} onBlur={handleBlur}
                        options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }, { value: "planning", label: "Planning to get one" }]} />
                    <Field label="Furnishing Preference" name="furnishingPref" type="select" value={data.furnishingPref} onChange={ch}
                        half required error={errors.furnishingPref} onBlur={handleBlur}
                        options={[{ value: "fully", label: "Fully Furnished" }, { value: "semi", label: "Semi Furnished" }, { value: "unfurnished", label: "Unfurnished" }, { value: "any", label: "No Preference" }]} />
                    <Field label="Preferred Lease Duration" name="leaseDuration" type="select" value={data.leaseDuration} onChange={ch}
                        half required error={errors.leaseDuration} onBlur={handleBlur}
                        options={[{ value: "3", label: "3 Months" }, { value: "6", label: "6 Months" }, { value: "11", label: "11 Months" }, { value: "12", label: "12 Months" }, { value: "24", label: "24 Months" }, { value: "flex", label: "Flexible" }]} />
                    <Field label="Expected Move-in Date" name="moveInDate" type="date" value={data.moveInDate} onChange={ch} half />
                    <Field label="Required Amenities" name="amenities" type="chips" value={data.amenities} onChange={toggle}
                        options={["Parking", "Gym", "Security", "Lift", "Generator", "WiFi", "Laundry", "CCTV", "Swimming Pool"]} />
                    <Field label="Special Requirements" name="specialRequirements" type="textarea" value={data.specialRequirements} onChange={ch}
                        placeholder="Accessibility needs, workspace requirements, medical considerations..." />
                </div>
            )}
            {step === 3 && (
                <div className="fields-grid">
                    <div className="info-bar">
                        <span>ℹ</span> Emergency contact information is strictly confidential and used only in critical situations.
                    </div>
                    <Field label="Emergency Contact Name" name="emergencyName" value={data.emergencyName} onChange={ch}
                        placeholder="Full name" required error={errors.emergencyName} onBlur={handleBlur} />
                    <Field label="Relationship" name="emergencyRelation" type="select" value={data.emergencyRelation} onChange={ch}
                        required half error={errors.emergencyRelation} onBlur={handleBlur}
                        options={[{ value: "parent", label: "Parent" }, { value: "spouse", label: "Spouse" }, { value: "sibling", label: "Sibling" }, { value: "friend", label: "Friend" }, { value: "colleague", label: "Colleague" }, { value: "other", label: "Other" }]} />
                    <Field label="Emergency Phone" name="emergencyPhone" type="phone" value={data.emergencyPhone} onChange={ch}
                        countryName="emergencyPhoneCountry" countryValue={data.emergencyPhoneCountry} onCountryChange={ch}
                        options={COUNTRY_DIAL_OPTIONS} placeholder="Contact number" required half error={errors.emergencyPhone}
                        onBlur={handleBlur} {...PHONE_INPUT_PROPS} />
                    <label className="consent">
                        <input type="checkbox" name="tenantConsent" checked={data.tenantConsent}
                            onChange={e => {
                                setData(p => ({ ...p, tenantConsent: e.target.checked }));
                                if (errors.tenantConsent) setErrors(prev => ({ ...prev, tenantConsent: undefined }));
                            }} />
                        <span>I confirm all information is accurate and agree to the <u>Tenancy Terms</u> and <u>Privacy Policy</u>.</span>
                    </label>
                    {errors.tenantConsent && <span className="f-msg f-error">{errors.tenantConsent}</span>}
                </div>
            )}

            <div className="form-nav">
                {step > 0 && <button type="button" className="btn-back" onClick={() => setStep(s => s - 1)}>← Back</button>}
                {step < T_STEPS.length - 1
                    ? <button type="button" className="cta" onClick={handleNext} disabled={!canAdvance}>Continue <span className="cta-arr">→</span></button>
                    : <button type="button" className="cta cta-final" onClick={handleComplete} disabled={!canComplete || submitStatus.loading}>
                        {submitStatus.loading ? "Submitting..." : "Complete Registration ✓"}
                    </button>}
            </div>

            {submitStatus.success && <p className="f-msg f-hint submit-msg">Registration submitted successfully.</p>}
            {submitStatus.error && <p className="f-msg f-error submit-msg">{submitStatus.error}</p>}

            <p className="switch-text">Already have an account?{" "}
                <button type="button" className="txt-link-btn" onClick={() => onSwitch("login")}>Sign In</button>
                {" · "}
                <button type="button" className="txt-link-btn" onClick={() => onSwitch("owner-reg")}>Register as Owner</button>
            </p>
        </div>
    );
}

// ─── OWNER REGISTER ───────────────────────────────────────────────────────────
const O_STEPS = ["Personal", "Property", "Specs", "Lease Terms", "Media"];

function OwnerForm({ onSwitch }) {
    const [step, setStep] = useState(0);
    const [data, setData] = useState({
        fullName: "", email: "", emailOtp: "", phoneCountry: DEFAULT_COUNTRY_CODE, phone: "",
        altPhoneCountry: DEFAULT_COUNTRY_CODE, altPhone: "", password: "", confirmPassword: "",
        propertyName: "", propertyType: "", bhk: "", totalUnits: "", address: "", city: "", stateRegion: "",
        propertyCountry: DEFAULT_COUNTRY_CODE, postalCode: "",
        sizeSqft: "", builtupSqft: "", floorNumber: "", totalFloors: "", furnishing: "", parking: "", petPolicy: "", facing: "",
        amenities: [],
        expectedRent: "", securityDeposit: "", maintenanceCharges: "", negotiable: "",
        minAgreement: "", maxAgreement: "", noticePeriod: "", preferredTenants: "", houseRules: "",
        exteriorImages: [], livingRoomImages: [], galleryImages: [], washroomImages: [],
        documents: [], availableFrom: "", description: "", ownerConsent: false,
    });
    const [errors, setErrors] = useState({});
    const [postalStatus, setPostalStatus] = useState({ loading: false, info: null, error: "" });
    const [editedLocation, setEditedLocation] = useState({ city: false, stateRegion: false });
    const [submitStatus, setSubmitStatus] = useState({ loading: false, success: false, error: "" });
    const [signupOtpStatus, setSignupOtpStatus] = useState({ loading: false, message: "", error: "" });

    const resetSubmitStatus = () => setSubmitStatus(prev => (prev.success || prev.error ? { loading: false, success: false, error: "" } : prev));
    const fileNames = (files = []) => (files || [])
        .map(file => (typeof file === "string" ? file : file?.name || ""))
        .filter(Boolean);

    const ownerChecks = {
        fullName: (val) => (val.trim() ? null : "Enter your full name"),
        email: validators.email,
        emailOtp: (val) => (/^\d{6}$/.test((val || "").trim()) ? null : "Enter the 6-digit email OTP"),
        phone: validators.phone,
        altPhone: (val) => (val ? validators.phone(val) : null),
        password: validators.password,
        confirmPassword: (val, form) => (val && val === form.password ? null : "Passwords must match"),
        propertyName: (val) => (val.trim() ? null : "Enter a listing title"),
        propertyType: (val) => (val ? null : "Select property type"),
        bhk: (val) => (val ? null : "Select configuration"),
        totalUnits: (val) => (Number(val) >= 1 ? null : "Units must be at least 1"),
        address: (val) => (val.trim() ? null : "Enter property address"),
        city: (val) => (val.trim() ? null : "Enter city"),
        stateRegion: (val) => (val.trim() ? null : "Enter state / region"),
        propertyCountry: (val) => (val ? null : "Select country"),
        postalCode: (val, form) => {
            const result = validatePostalCode(form.propertyCountry, val);
            return result.valid ? null : result.message;
        },
        sizeSqft: (val) => (Number(val) > 0 ? null : "Enter carpet area"),
        builtupSqft: (val, form) => (val ? (Number(val) >= Number(form.sizeSqft || 0) ? null : "Built-up should be >= carpet") : null),
        totalFloors: (val) => (val ? null : "Enter total floors"),
        furnishing: (val) => (val ? null : "Select furnishing"),
        parking: (val) => (val ? null : "Select parking"),
        petPolicy: (val) => (val ? null : "Select pet policy"),
        expectedRent: (val) => (Number(val) > 0 ? null : "Enter monthly rent"),
        securityDeposit: (val) => (Number(val) >= 0 ? null : "Enter deposit"),
        maintenanceCharges: (val) => (val ? (Number(val) >= 0 ? null : "Amount cannot be negative") : null),
        negotiable: (val) => (val ? null : "Select an option"),
        minAgreement: (val) => (val ? null : "Select minimum term"),
        maxAgreement: (val, form) => {
            if (!val) return "Select maximum term";
            if (form.minAgreement && Number(val) < Number(form.minAgreement)) return "Max term must exceed min";
            return null;
        },
        noticePeriod: (val) => (val ? null : "Select notice period"),
        preferredTenants: (val) => (val ? null : "Select preferred tenants"),
        exteriorImages: (val) => {
            const result = validateMediaFiles("exteriorImages", val);
            return result.valid ? null : result.message;
        },
        livingRoomImages: (val) => {
            const result = validateMediaFiles("livingRoomImages", val);
            return result.valid ? null : result.message;
        },
        galleryImages: (val) => {
            const result = validateMediaFiles("galleryImages", val);
            return result.valid ? null : result.message;
        },
        washroomImages: (val) => {
            const result = validateMediaFiles("washroomImages", val);
            return result.valid ? null : result.message;
        },
        documents: (val) => {
            const result = validateMediaFiles("documents", val);
            return result.valid ? null : result.message;
        },
        ownerConsent: (val) => (val ? null : "Please accept the owner terms"),
    };

    const OWNER_STEP_FIELDS = [
        ["fullName", "email", "emailOtp", "phone", "password", "confirmPassword"],
        ["propertyName", "propertyType", "bhk", "totalUnits", "address", "city", "stateRegion", "propertyCountry", "postalCode"],
        ["sizeSqft", "totalFloors", "furnishing", "parking", "petPolicy"],
        ["expectedRent", "securityDeposit", "negotiable", "minAgreement", "maxAgreement", "noticePeriod", "preferredTenants"],
        ["exteriorImages", "livingRoomImages", "washroomImages", "documents", "ownerConsent"],
    ];

    const allOwnerFields = Array.from(new Set(OWNER_STEP_FIELDS.flat()));

    const runValidation = (field) => {
        const fn = ownerChecks[field];
        if (!fn) return null;
        return fn(data[field], data) || null;
    };

    const ch = e => {
        const { name } = e.target;
        let { value } = e.target;
        setData(p => ({ ...p, [name]: value }));
        if (errors[name]) setErrors(prev => ({ ...prev, [name]: undefined }));
        if (name === "email" || name === "emailOtp") {
            setSignupOtpStatus({ loading: false, message: "", error: "" });
        }
        if (name === "city" && !editedLocation.city) setEditedLocation(prev => ({ ...prev, city: true }));
        if (name === "stateRegion" && !editedLocation.stateRegion) setEditedLocation(prev => ({ ...prev, stateRegion: true }));
        if (name === "propertyCountry") {
            setEditedLocation({ city: false, stateRegion: false });
            setPostalStatus({ loading: false, info: null, error: "" });
        }
        resetSubmitStatus();
    };

    const chFile = e => {
        const { name, files } = e.target;
        const result = validateMediaFiles(name, files);
        if (!result.valid) {
            setErrors(prev => ({ ...prev, [name]: result.message }));
            return;
        }
        setErrors(prev => ({ ...prev, [name]: undefined }));
        setData(p => ({ ...p, [name]: Array.from(files) }));
        resetSubmitStatus();
    };

    const toggle = (name, val) => {
        setData(p => {
            const current = p[name] || [];
            const next = current.includes(val) ? current.filter(x => x !== val) : [...current, val];
            return { ...p, [name]: next };
        });
        resetSubmitStatus();
    };

    const handleBlur = e => {
        const { name } = e.target;
        if (!ownerChecks[name]) return;
        setErrors(prev => ({ ...prev, [name]: runValidation(name) }));
    };

    const handleSendSignupOtp = async () => {
        const emailError = validators.email(data.email);
        if (emailError) {
            setErrors(prev => ({ ...prev, email: emailError }));
            setSignupOtpStatus({ loading: false, message: "", error: "Enter a valid email before requesting OTP" });
            return;
        }

        setSignupOtpStatus({ loading: true, message: "", error: "" });
        try {
            const response = await sendSignupOtp({ email: data.email, role: "owner" });
            setSignupOtpStatus({
                loading: false,
                message: response?.message || "Signup OTP sent to your email.",
                error: "",
            });
        } catch (err) {
            setSignupOtpStatus({ loading: false, message: "", error: err?.message || "Unable to send signup OTP" });
        }
    };

    const validateStep = () => {
        const fields = OWNER_STEP_FIELDS[step] || [];
        const nextErrors = {};
        fields.forEach(field => {
            const message = runValidation(field);
            if (message) nextErrors[field] = message;
        });
        if (Object.keys(nextErrors).length) {
            setErrors(prev => ({ ...prev, ...nextErrors }));
            return false;
        }
        return true;
    };

    const handleNext = async () => {
        if (signupOtpStatus.loading) return;
        if (!validateStep()) return;

        if (step === 0) {
            setSignupOtpStatus({ loading: true, message: "", error: "" });
            try {
                await verifySignupOtp({
                    email: data.email,
                    otp: data.emailOtp.trim(),
                });
                setSignupOtpStatus({ loading: false, message: "OTP verified.", error: "" });
            } catch (err) {
                setSignupOtpStatus({
                    loading: false,
                    message: "",
                    error: err?.message || "Invalid or expired signup OTP",
                });
                return;
            }
        }

        setStep(s => s + 1);
    };

    const handleComplete = async () => {
        if (submitStatus.loading) return;
        const nextErrors = {};
        allOwnerFields.forEach(field => {
            const message = runValidation(field);
            if (message) nextErrors[field] = message;
        });
        setErrors(prev => ({ ...prev, ...nextErrors }));
        if (Object.keys(nextErrors).length) return;

        const payload = {
            ...data,
            exteriorImages: fileNames(data.exteriorImages),
            livingRoomImages: fileNames(data.livingRoomImages),
            galleryImages: fileNames(data.galleryImages),
            washroomImages: fileNames(data.washroomImages),
            documents: fileNames(data.documents),
        };

        setSubmitStatus({ loading: true, success: false, error: "" });
        try {
            await registerOwner(payload);
            setSubmitStatus({ loading: false, success: true, error: "" });
        } catch (err) {
            setSubmitStatus({
                loading: false,
                success: false,
                error: err?.message || "Unable to submit registration",
            });
        }
    };

    const canAdvance = (OWNER_STEP_FIELDS[step] || []).every(field => !runValidation(field));
    const canComplete = allOwnerFields.every(field => !runValidation(field));
    const supportsPostalLookup = data.propertyCountry === "IN";
    const postalDigits = data.postalCode.replace(/[^0-9]/g, "");
    const canLookupPostal = supportsPostalLookup && postalDigits.length === 6;

    useEffect(() => {
        if (!canLookupPostal) {
            return;
        }

        const controller = new AbortController();
        lookupPin(postalDigits, controller.signal)
            .then(info => {
                setPostalStatus({ loading: false, info, error: "" });
                if (!info) return;

                let didUpdateCity = false;
                let didUpdateState = false;
                setData(prev => {
                    const nextCity = editedLocation.city ? prev.city : (info.city || prev.city);
                    const nextState = editedLocation.stateRegion ? prev.stateRegion : (info.state || prev.stateRegion);
                    didUpdateCity = nextCity !== prev.city;
                    didUpdateState = nextState !== prev.stateRegion;
                    if (!didUpdateCity && !didUpdateState) return prev;
                    return { ...prev, city: nextCity, stateRegion: nextState };
                });

                if (didUpdateCity || didUpdateState) {
                    setErrors(prev => {
                        const next = { ...prev };
                        if (didUpdateCity) next.city = undefined;
                        if (didUpdateState) next.stateRegion = undefined;
                        return next;
                    });
                }
            })
            .catch(err => {
                if (err.name === "AbortError") return;
                setPostalStatus({ loading: false, info: null, error: err.message || "Postal lookup failed" });
            });
        return () => controller.abort();
    }, [canLookupPostal, postalDigits, editedLocation.city, editedLocation.stateRegion]);

    const effectivePostalStatus = canLookupPostal
        ? postalStatus
        : { loading: false, info: null, error: "" };

    const postalError = errors.postalCode
        || (supportsPostalLookup && !effectivePostalStatus.loading && effectivePostalStatus.error ? effectivePostalStatus.error : null);
    const postalHint = supportsPostalLookup
        ? (effectivePostalStatus.loading
            ? "Fetching city & state..."
            : effectivePostalStatus.info ? `${effectivePostalStatus.info.postOffice}${effectivePostalStatus.info.city ? ` · ${effectivePostalStatus.info.city}` : ""}` : undefined)
        : "Auto-fill available for India-based addresses";

    return (
        <div className="form-body">
            <div className="form-head">
                <p className="eyebrow eyebrow-owner">Property Owner Registration</p>
                <h2 className="heading">List Your Property</h2>
                <p className="sub-text">Reach thousands of verified tenants</p>
            </div>
            <Progress steps={O_STEPS} current={step} />

            {step === 0 && (
                <div className="fields-grid">
                    <Field label="Full Legal Name" name="fullName" value={data.fullName} onChange={ch}
                        placeholder="As on government ID" required error={errors.fullName} onBlur={handleBlur} />
                    <Field label="Email Address" name="email" type="email" value={data.email} onChange={ch}
                        placeholder="you@email.com" required error={errors.email} onBlur={handleBlur} />
                    <div className={`field-wrap half${errors.emailOtp ? " has-error" : ""}`}>
                        <label className="f-label">Email OTP<span className="f-req"> *</span></label>
                        <input
                            className="f-in"
                            type="text"
                            name="emailOtp"
                            value={data.emailOtp}
                            onChange={ch}
                            onBlur={handleBlur}
                            placeholder="Enter 6-digit OTP"
                            inputMode="numeric"
                            pattern="\\d*"
                            maxLength={6}
                            autoComplete="one-time-code"
                            aria-invalid={Boolean(errors.emailOtp)}
                        />
                        {errors.emailOtp && <span className="f-msg f-error">{errors.emailOtp}</span>}
                    </div>
                    <button
                        type="button"
                        className="cta cta-owner otp-send-btn"
                        onClick={handleSendSignupOtp}
                        disabled={signupOtpStatus.loading}
                    >
                        {signupOtpStatus.loading ? "Sending OTP..." : "Send Email OTP"}
                    </button>
                    {signupOtpStatus.message && <p className="f-msg f-hint submit-msg otp-status">{signupOtpStatus.message}</p>}
                    {signupOtpStatus.error && <p className="f-msg f-error submit-msg otp-status">{signupOtpStatus.error}</p>}
                    <Field label="Phone / WhatsApp" name="phone" type="phone" value={data.phone} onChange={ch}
                        countryName="phoneCountry" countryValue={data.phoneCountry} onCountryChange={ch}
                        options={COUNTRY_DIAL_OPTIONS} placeholder="Primary contact" required half error={errors.phone}
                        onBlur={handleBlur} {...PHONE_INPUT_PROPS} />
                    <Field label="Alternate Phone" name="altPhone" type="phone" value={data.altPhone} onChange={ch}
                        countryName="altPhoneCountry" countryValue={data.altPhoneCountry} onCountryChange={ch}
                        options={COUNTRY_DIAL_OPTIONS} placeholder="Optional" half error={errors.altPhone}
                        onBlur={handleBlur} {...PHONE_INPUT_PROPS} />
                    <Field label="Password" name="password" type="password" value={data.password} onChange={ch}
                        placeholder="Minimum 8 characters" required half error={errors.password} onBlur={handleBlur} />
                    <Field label="Confirm Password" name="confirmPassword" type="password" value={data.confirmPassword} onChange={ch}
                        placeholder="Re-enter password" required half error={errors.confirmPassword} onBlur={handleBlur} />
                </div>
            )}
            {step === 1 && (
                <div className="fields-grid">
                    <Field label="Listing Title" name="propertyName" value={data.propertyName} onChange={ch}
                        placeholder='e.g. "Sunlit 2BHK in Powai"' required error={errors.propertyName} onBlur={handleBlur} />
                    <Field label="Property Type" name="propertyType" type="select" value={data.propertyType} onChange={ch}
                        required error={errors.propertyType} onBlur={handleBlur}
                        options={[{ value: "apartment", label: "Apartment / Flat" }, { value: "independent", label: "Independent House / Villa" }, { value: "pg", label: "PG / Hostel" }, { value: "commercial", label: "Commercial Space" }, { value: "studio", label: "Studio Apartment" }]} />
                    <Field label="Configuration (BHK)" name="bhk" type="select" value={data.bhk} onChange={ch} half
                        required error={errors.bhk} onBlur={handleBlur}
                        options={["Studio", "1 RK", "1 BHK", "2 BHK", "3 BHK", "4 BHK", "4+ BHK"].map(v => ({ value: v, label: v }))} />
                    <Field label="Units Available" name="totalUnits" type="number" value={data.totalUnits} onChange={ch}
                        placeholder="1" required half error={errors.totalUnits} onBlur={handleBlur} min="1" />
                    <Field label="Full Property Address" name="address" type="textarea" value={data.address} onChange={ch}
                        placeholder="Street, Locality, Landmark..." required error={errors.address} onBlur={handleBlur} />
                    <Field label="City" name="city" value={data.city} onChange={ch}
                        placeholder="City" required half error={errors.city} onBlur={handleBlur}
                        hint={!errors.city && postalStatus.info && !editedLocation.city ? "Auto-filled from postal lookup" : undefined} />
                    <Field label="State / Region" name="stateRegion" value={data.stateRegion} onChange={ch}
                        placeholder="State or province" required half error={errors.stateRegion} onBlur={handleBlur}
                        hint={!errors.stateRegion && postalStatus.info && !editedLocation.stateRegion ? "Auto-filled" : undefined} />
                    <Field label="Country" name="propertyCountry" type="select" value={data.propertyCountry} onChange={ch}
                        required half error={errors.propertyCountry}
                        options={COUNTRY_NAME_OPTIONS} />
                    <Field label="Postal Code" name="postalCode" value={data.postalCode} onChange={ch}
                        placeholder="e.g. 94105" required half error={postalError} hint={postalHint} onBlur={handleBlur} />
                </div>
            )}
            {step === 2 && (
                <div className="fields-grid">
                    <Field label="Carpet Area (sq. ft.)" name="sizeSqft" type="number" value={data.sizeSqft} onChange={ch}
                        placeholder="850" required half error={errors.sizeSqft} onBlur={handleBlur} min="0" />
                    <Field label="Built-up Area (sq. ft.)" name="builtupSqft" type="number" value={data.builtupSqft} onChange={ch}
                        placeholder="1000" half error={errors.builtupSqft} onBlur={handleBlur} min="0" />
                    <Field label="Floor Number" name="floorNumber" value={data.floorNumber} onChange={ch}
                        placeholder="3rd" half />
                    <Field label="Total Floors in Building" name="totalFloors" value={data.totalFloors} onChange={ch}
                        placeholder="12" half required error={errors.totalFloors} onBlur={handleBlur} />
                    <Field label="Furnishing Status" name="furnishing" type="select" value={data.furnishing} onChange={ch}
                        required half error={errors.furnishing} onBlur={handleBlur}
                        options={[{ value: "fully", label: "Fully Furnished" }, { value: "semi", label: "Semi Furnished" }, { value: "unfurnished", label: "Unfurnished" }]} />
                    <Field label="Facing" name="facing" type="select" value={data.facing} onChange={ch} half
                        options={["North", "South", "East", "West", "North-East", "North-West", "South-East", "South-West"].map(f => ({ value: f, label: f }))} />
                    <Field label="Parking Availability" name="parking" type="select" value={data.parking} onChange={ch}
                        half required error={errors.parking} onBlur={handleBlur}
                        options={[{ value: "none", label: "No Parking" }, { value: "two", label: "2-Wheeler" }, { value: "four", label: "4-Wheeler" }, { value: "both", label: "Both" }, { value: "covered", label: "Covered Parking" }]} />
                    <Field label="Pet Policy" name="petPolicy" type="select" value={data.petPolicy} onChange={ch}
                        half required error={errors.petPolicy} onBlur={handleBlur}
                        options={[{ value: "no_pets", label: "No Pets" }, { value: "small", label: "Small Pets Only" }, { value: "any", label: "All Pets Welcome" }, { value: "negotiable", label: "Negotiable" }]} />
                    <Field label="Available Amenities" name="amenities" type="chips" value={data.amenities} onChange={toggle}
                        options={["Lift", "Gym", "Swimming Pool", "Security", "CCTV", "Generator", "Club House", "Intercom", "Gas Pipeline", "24/7 Water", "Children's Play Area", "Rooftop Access"]} />
                </div>
            )}
            {step === 3 && (
                <div className="fields-grid">
                    <Field label="Monthly Rent (₹)" name="expectedRent" type="number" value={data.expectedRent} onChange={ch}
                        placeholder="28000" required half error={errors.expectedRent} onBlur={handleBlur} min="0" />
                    <Field label="Security Deposit (₹)" name="securityDeposit" type="number" value={data.securityDeposit} onChange={ch}
                        placeholder="84000" required half error={errors.securityDeposit} onBlur={handleBlur} min="0" />
                    <Field label="Maintenance Charges (₹ / mo)" name="maintenanceCharges" type="number" value={data.maintenanceCharges} onChange={ch}
                        placeholder="1500" half error={errors.maintenanceCharges} onBlur={handleBlur} min="0" />
                    <Field label="Rent Negotiable?" name="negotiable" type="select" value={data.negotiable} onChange={ch}
                        half required error={errors.negotiable} onBlur={handleBlur}
                        options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "slightly", label: "Slightly" }]} />
                    <Field label="Minimum Lease Duration" name="minAgreement" type="select" value={data.minAgreement} onChange={ch}
                        half required error={errors.minAgreement} onBlur={handleBlur}
                        options={[3, 6, 11, 12, 24].map(n => ({ value: String(n), label: `${n} Months` }))} />
                    <Field label="Maximum Lease Duration" name="maxAgreement" type="select" value={data.maxAgreement} onChange={ch}
                        half required error={errors.maxAgreement} onBlur={handleBlur}
                        options={[6, 11, 12, 24, 36, 60].map(n => ({ value: String(n), label: `${n} Months` }))} />
                    <Field label="Notice Period" name="noticePeriod" type="select" value={data.noticePeriod} onChange={ch}
                        half required error={errors.noticePeriod} onBlur={handleBlur}
                        options={[1, 2, 3].map(n => ({ value: String(n), label: `${n} Month${n > 1 ? "s" : ""}` }))} />
                    <Field label="Preferred Tenants" name="preferredTenants" type="select" value={data.preferredTenants} onChange={ch}
                        half required error={errors.preferredTenants} onBlur={handleBlur}
                        options={[{ value: "family", label: "Family" }, { value: "bachelor", label: "Bachelors" }, { value: "female", label: "Female Only" }, { value: "working", label: "Working Professionals" }, { value: "any", label: "No Preference" }]} />
                    <Field label="House Rules & Additional Terms" name="houseRules" type="textarea" value={data.houseRules} onChange={ch}
                        placeholder="e.g. No smoking indoors, no loud music after 10 PM, no subletting..." />
                </div>
            )}
            {step === 4 && (
                <div className="fields-grid">
                    <div className="info-bar">
                        <span>ℹ</span> Upload distinct photo sets for each area so we can verify listings quickly and give tenants a transparent view.
                    </div>
                    <Field label="Building / Exterior Photos" name="exteriorImages" type="file" value={data.exteriorImages} onChange={chFile}
                        required accept="image/*" error={errors.exteriorImages} />
                    <Field label="Living Room Photos" name="livingRoomImages" type="file" value={data.livingRoomImages} onChange={chFile}
                        required accept="image/*" error={errors.livingRoomImages} />
                    <Field label="Gallery / Balcony Photos (if any)" name="galleryImages" type="file" value={data.galleryImages} onChange={chFile}
                        accept="image/*" error={errors.galleryImages} />
                    <Field label="Washroom Photos" name="washroomImages" type="file" value={data.washroomImages} onChange={chFile}
                        required accept="image/*" error={errors.washroomImages} />
                    <Field label="Ownership & Legal Documents" name="documents" type="file" value={data.documents} onChange={chFile}
                        accept=".pdf,.doc,.docx,image/*" error={errors.documents} />
                    <Field label="Property Description" name="description" type="textarea" value={data.description} onChange={ch}
                        placeholder="Describe the property: highlights, nearby schools, transport links, markets..." />
                    <Field label="Available From" name="availableFrom" type="date" value={data.availableFrom} onChange={ch} half />
                    <label className="consent">
                        <input type="checkbox" name="ownerConsent" checked={data.ownerConsent}
                            onChange={e => {
                                setData(p => ({ ...p, ownerConsent: e.target.checked }));
                                if (errors.ownerConsent) setErrors(prev => ({ ...prev, ownerConsent: undefined }));
                            }} />
                        <span>I confirm I am the legal owner or authorised representative and all information is accurate. I agree to the <u>Owner Terms of Service</u>.</span>
                    </label>
                    {errors.ownerConsent && <span className="f-msg f-error">{errors.ownerConsent}</span>}
                </div>
            )}

            <div className="form-nav">
                {step > 0 && <button type="button" className="btn-back" onClick={() => setStep(s => s - 1)}>← Back</button>}
                {step < O_STEPS.length - 1
                    ? <button type="button" className="cta cta-owner" onClick={handleNext} disabled={!canAdvance}>Continue <span className="cta-arr">→</span></button>
                    : <button type="button" className="cta cta-owner cta-final" onClick={handleComplete} disabled={!canComplete || submitStatus.loading}>
                        {submitStatus.loading ? "Submitting..." : "List My Property ✓"}
                    </button>}
            </div>

            {submitStatus.success && <p className="f-msg f-hint submit-msg">Property listing submitted successfully.</p>}
            {submitStatus.error && <p className="f-msg f-error submit-msg">{submitStatus.error}</p>}

            <p className="switch-text">Already have an account?{" "}
                <button type="button" className="txt-link-btn" onClick={() => onSwitch("login")}>Sign In</button>
                {" · "}
                <button type="button" className="txt-link-btn" onClick={() => onSwitch("tenant-reg")}>Register as Tenant</button>
            </p>
        </div>
    );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function AuthPage() {
    const [mode, setMode] = useState("login");

    return (
        <div className="auth-root">
            <aside className="brand-aside">
                <ArchCanvas />
                <div className="brand-overlay" />
                <div className="brand-content">
                    <div className="brand-logo">
                        <svg viewBox="0 0 32 32" fill="none" width="28" height="28">
                            <rect x="2" y="14" width="10" height="16" stroke="#B8943F" strokeWidth="1.5" />
                            <rect x="14" y="8" width="10" height="22" stroke="#B8943F" strokeWidth="1.5" />
                            <rect x="26" y="18" width="4" height="12" stroke="#B8943F" strokeWidth="1.5" />
                            <line x1="2" y1="14" x2="30" y2="14" stroke="#B8943F" strokeWidth="1" />
                        </svg>
                        <span className="logo-name">REMS</span>
                    </div>

                    <div className="brand-text">
                        <h1 className="brand-headline">Rental Management,<br />Elevated.</h1>
                        <p className="brand-desc">The complete platform connecting property owners with quality tenants — smart, transparent, and efficient.</p>
                    </div>

                    <div className="brand-features">
                        {["Smart lease & agreement management", "Real-time maintenance request tracking", "Automated rent reminders & receipts", "Verified tenant background screening"].map(f => (
                            <div key={f} className="feat">
                                <span className="feat-dot" />
                                <span>{f}</span>
                            </div>
                        ))}
                    </div>

                    <div className="brand-stats">
                        {[["12,400+", "Properties Listed"], ["48,000+", "Active Tenants"], ["4.9 ★", "Owner Rating"]].map(([n, l]) => (
                            <div key={l} className="stat">
                                <span className="stat-n">{n}</span>
                                <span className="stat-l">{l}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </aside>

            <main className="form-main">
                <div className="tab-row">
                    {[["login", "Sign In"], ["tenant-reg", "Tenant Sign Up"], ["owner-reg", "Owner Sign Up"]].map(([m, l]) => (
                        <button key={m} type="button" className={`tab ${mode === m ? "tab-on" : ""}`} onClick={() => setMode(m)}>{l}</button>
                    ))}
                </div>

                <div className="form-scroll">
                    {mode === "login" && <LoginForm onSwitch={setMode} />}
                    {mode === "tenant-reg" && <TenantForm onSwitch={setMode} />}
                    {mode === "owner-reg" && <OwnerForm onSwitch={setMode} />}
                </div>

                <footer className="f-footer">
                    © 2025 REMS &nbsp;·&nbsp; <span>Privacy Policy</span> &nbsp;·&nbsp; <span>Terms of Service</span> &nbsp;·&nbsp; <span>Support</span>
                </footer>
            </main>
        </div>
    );
}