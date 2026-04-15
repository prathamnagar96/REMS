import { createContext, useContext, useMemo, useState } from "react";
import { clearSession, loadSession, persistSession } from "../services/sessionService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [session, setSession] = useState(() => loadSession());

    const loginWithSession = (payload, { remember = false } = {}) => {
        persistSession(payload, { remember });
        setSession(loadSession());
    };

    const logout = () => {
        clearSession();
        setSession(null);
    };

    const value = useMemo(() => ({
        session,
        profile: session?.profile || null,
        role: session?.role || null,
        isLoggedIn: Boolean(session?.accessToken),
        loginWithSession,
        logout,
    }), [session]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
    const value = useContext(AuthContext);
    if (!value) {
        throw new Error("useAuth must be used within AuthProvider");
    }
    return value;
}
