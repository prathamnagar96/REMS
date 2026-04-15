const STORAGE_KEY = "rm-auth-session";
const isBrowser = typeof window !== "undefined";

const safeParse = (value) => {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const readStorage = (store) => {
    if (!store) return null;
    try {
        return store.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
};

const writeStorage = (store, value) => {
    if (!store) return;
    try {
        store.setItem(STORAGE_KEY, value);
    } catch {
        // ignore quota / privacy mode errors
    }
};

const removeStorage = (store) => {
    if (!store) return;
    try {
        store.removeItem(STORAGE_KEY);
    } catch {
        // ignore removal errors
    }
};

const removeFromAllStores = () => {
    if (!isBrowser) return;
    removeStorage(window.localStorage);
    removeStorage(window.sessionStorage);
};

const normalizeExpiry = (session) => {
    if (!session) return null;
    const expiresAt = session.expiresAt
        || (session.expiresIn ? Date.now() + Number(session.expiresIn) * 1000 : null);
    return {
        ...session,
        expiresAt: expiresAt && Number.isFinite(expiresAt) ? expiresAt : null,
    };
};

const isExpired = (expiresAt) => {
    if (!expiresAt) return false;
    return Date.now() >= expiresAt;
};

export const loadSession = () => {
    if (!isBrowser) return null;
    const raw = readStorage(window.sessionStorage) || readStorage(window.localStorage);
    if (!raw) return null;

    const session = normalizeExpiry(safeParse(raw));
    if (!session || !session.accessToken) {
        removeFromAllStores();
        return null;
    }

    if (isExpired(session.expiresAt)) {
        removeFromAllStores();
        return null;
    }

    return session;
};

export const persistSession = (session, { remember = false } = {}) => {
    if (!isBrowser || !session?.accessToken) return;

    const normalized = normalizeExpiry(session);
    const payload = JSON.stringify({
        ...normalized,
        remember,
        storedAt: Date.now(),
    });

    const primary = remember ? window.localStorage : window.sessionStorage;
    const secondary = remember ? window.sessionStorage : window.localStorage;

    writeStorage(primary, payload);
    removeStorage(secondary);
};

export const clearSession = () => {
    removeFromAllStores();
};

export const getAuthHeader = () => {
    const session = loadSession();
    if (!session?.accessToken) return {};
    return { Authorization: `Bearer ${session.accessToken}` };
};
