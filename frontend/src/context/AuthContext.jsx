import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem('wera_user');
        if (!saved) return null;
        try { return JSON.parse(saved); } catch { return null; }
    });
    const [token, setToken] = useState(() => localStorage.getItem('wera_token'));

    useEffect(() => {
        const saved = localStorage.getItem('wera_user');
        if (!saved) return;
        try { setUser(JSON.parse(saved)); } catch { /* ignore */ }
    }, []);

    const login = (userData, userToken) => {
        setUser(userData);
        setToken(userToken);
        localStorage.setItem('wera_token', userToken);
        localStorage.setItem('wera_user', JSON.stringify(userData));
    };

    const logout = () => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('wera_token');
        localStorage.removeItem('wera_user');
    };

    return (
        <AuthContext.Provider value={{ user, token, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);