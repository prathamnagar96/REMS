const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^[2-9][0-9]{11}$/;

export const COUNTRIES = [
    { code: "US", name: "United States", dialCode: "+1", postal: /^\d{5}(-\d{4})?$/ },
    { code: "CA", name: "Canada", dialCode: "+1", postal: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/ },
    { code: "GB", name: "United Kingdom", dialCode: "+44", postal: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i },
    { code: "AU", name: "Australia", dialCode: "+61", postal: /^\d{4}$/ },
    { code: "IN", name: "India", dialCode: "+91", postal: /^\d{6}$/ },
    { code: "SG", name: "Singapore", dialCode: "+65", postal: /^\d{6}$/ },
    { code: "AE", name: "United Arab Emirates", dialCode: "+971", postal: /^\d{5}$/ },
    { code: "DE", name: "Germany", dialCode: "+49", postal: /^\d{5}$/ },
    { code: "FR", name: "France", dialCode: "+33", postal: /^\d{5}$/ },
    { code: "BR", name: "Brazil", dialCode: "+55", postal: /^\d{5}-?\d{3}$/ },
    { code: "ZA", name: "South Africa", dialCode: "+27", postal: /^\d{4}$/ },
    { code: "JP", name: "Japan", dialCode: "+81", postal: /^\d{3}-?\d{4}$/ },
    { code: "OTHER", name: "Other", dialCode: "+", postal: /^.{3,}$/ },
];

export const DEFAULT_COUNTRY_CODE = "IN";

export const getCountryMeta = (code) => COUNTRIES.find(c => c.code === code) || COUNTRIES[0];

export const formatCountryLabel = (code) => {
    const country = getCountryMeta(code);
    return `${country.name} (${country.dialCode})`;
};

const ID_HINTS = {
    aadhaar: "12-digit Aadhaar number",
    passport: "Passport number (e.g. M1234567)",
    dl: "Driving licence number",
    voter: "Voter ID number",
    pan: "PAN number (ABCDE1234F)",
};

export const getIdPlaceholder = (type) => ID_HINTS[type] || "Enter ID number";

const stripNonDigits = (val = "") => val.replace(/[^0-9]/g, "");

export const isEmail = (val = "") => EMAIL_RE.test(val.trim());
export const isStrongPassword = (val = "") => val.length >= 8;
export const cleanPhoneDigits = (val = "") => stripNonDigits(val);
export const isPhone = (val = "") => {
    const digits = cleanPhoneDigits(val);
    return digits.length >= 6 && digits.length <= 14;
};
export const isPan = (val = "") => PAN_RE.test(val.toUpperCase());
export const isAadhaar = (val = "") => AADHAAR_RE.test(stripNonDigits(val));

export const validatePostalCode = (countryCode, value = "") => {
    const trimmed = value.trim();
    if (!trimmed) return { valid: false, message: "Enter the postal code" };
    const country = getCountryMeta(countryCode);
    if (country?.postal && !country.postal.test(trimmed)) {
        return { valid: false, message: `Enter a valid ${country.name} postal code` };
    }
    return { valid: true };
};

export const validateIdNumber = (type, value = "") => {
    if (!type) return { valid: false, message: "Select an ID type" };
    if (!value.trim()) return { valid: false, message: "Enter the ID number" };

    switch (type) {
        case "pan":
            return isPan(value)
                ? { valid: true }
                : { valid: false, message: "PAN should match ABCDE1234F" };
        case "aadhaar":
            return isAadhaar(value)
                ? { valid: true }
                : { valid: false, message: "Aadhaar must be 12 digits" };
        case "passport":
            return /^[A-Z][0-9]{7}$/i.test(value)
                ? { valid: true }
                : { valid: false, message: "Passport must be 1 letter + 7 digits" };
        case "dl":
            return /^[A-Z]{2}[0-9]{2}[0-9]{11}$/i.test(value)
                ? { valid: true }
                : { valid: false, message: "DL should match MH0120190000000" };
        case "voter":
            return /^[A-Z]{3}[0-9]{7}$/i.test(value)
                ? { valid: true }
                : { valid: false, message: "Voter ID should match ABC1234567" };
        default:
            return { valid: true };
    }
};

export const pinSummary = (payload) => {
    if (!payload || !Array.isArray(payload)) return null;
    const success = payload.find(entry => entry.Status === "Success");
    if (!success || !Array.isArray(success.PostOffice) || !success.PostOffice.length) return null;
    const match = success.PostOffice[0];
    return {
        city: match.Block || match.District || "",
        state: match.State || "",
        postOffice: match.Name || "",
    };
};

export const validators = {
    email: (val) => (isEmail(val) ? null : "Enter a valid email"),
    password: (val) => (isStrongPassword(val) ? null : "Minimum 8 characters"),
    phone: (val) => (isPhone(val) ? null : "Enter a valid phone number"),
};
