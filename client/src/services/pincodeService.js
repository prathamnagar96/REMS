import { pinSummary } from "../utils/validation";

const API_ROOT = "https://api.postalpincode.in/pincode/";

export async function lookupPin(pin, signal) {
    const response = await fetch(`${API_ROOT}${pin}`, { signal });
    if (!response.ok) throw new Error("Unable to connect to India Post");

    const payload = await response.json();
    const summary = pinSummary(payload);
    if (!summary) throw new Error("PIN not found");
    return summary;
}
