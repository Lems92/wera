import { createContext, useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Send the HttpOnly auth cookie on every cross-origin API call.
axios.defaults.withCredentials = true;

const AuthContext = createContext();

export function AuthProvider({ children }) {
    // We deliberately do NOT keep the JWT in localStorage anymore. The token
    // lives in an HttpOnly cookie that JavaScript can't read, so a stray
    // XSS can't steal the session. We only keep a non-sensitive `user`
    // object (id + username) in memory, hydrated from /api/auth/me.
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(null); // legacy: still surfaced for code that needs it
    const [loading, setLoading] = useState(true);

    // On mount, ask the server who we are. If the cookie is valid we get
    // a user back; otherwise we stay logged out.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get(`${API_URL}/auth/me`);
                if (!cancelled) setUser(res.data?.user || null);
            } catch {
                if (!cancelled) setUser(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const login = (userData, userToken) => {
        // The cookie was set by the server on /login, /register or /google.
        // We just remember the user object in memory.
        setUser(userData);
        setToken(userToken || null);
    };

    const logout = async () => {
        try { await axios.post(`${API_URL}/auth/logout`); } catch { /* ignore */ }
        setUser(null);
        setToken(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
