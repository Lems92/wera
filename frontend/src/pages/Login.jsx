import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

export default function Login() {
    const [form, setForm] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post(`${API_URL}/auth/login`, form);
            login(res.data.user, res.data.token);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Erreur de connexion');
        }
    };

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 'calc(100vh - 57px)', background: 'var(--gray)'
        }}>
            <div style={{
                background: '#fff', padding: '2.5rem', borderRadius: '16px',
                width: '100%', maxWidth: '400px',
                border: '1px solid #e5e5e5'
            }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <span style={{
                        fontSize: '22px', fontWeight: '700', letterSpacing: '-1px',
                        border: '2.5px solid #111', borderRadius: '8px',
                        padding: '2px 10px'
                    }}>wera</span>
                    <h2 style={{ marginTop: '1rem', fontSize: '20px' }}>Se connecter</h2>
                </div>

                {error && (
                    <div style={{
                        background: '#fee', color: '#c00', padding: '0.75rem',
                        borderRadius: '8px', marginBottom: '1rem', fontSize: '14px'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <input
                        type="email" placeholder="Email"
                        value={form.email}
                        onChange={e => setForm({ ...form, email: e.target.value })}
                        required
                        style={{
                            padding: '0.75rem 1rem', borderRadius: '8px',
                            border: '1px solid #ddd', fontSize: '15px', outline: 'none'
                        }}
                    />
                    <input
                        type="password" placeholder="Mot de passe"
                        value={form.password}
                        onChange={e => setForm({ ...form, password: e.target.value })}
                        required
                        style={{
                            padding: '0.75rem 1rem', borderRadius: '8px',
                            border: '1px solid #ddd', fontSize: '15px', outline: 'none'
                        }}
                    />
                    <button type="submit" style={{
                        background: 'var(--yellow)', color: '#111',
                        border: 'none', padding: '0.85rem',
                        borderRadius: '8px', fontSize: '15px',
                        fontWeight: '600', cursor: 'pointer'
                    }}>
                        Se connecter
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '14px', color: '#666' }}>
                    Pas encore de compte ?{' '}
                    <Link to="/register" style={{ color: '#111', fontWeight: '600' }}>
                        S'inscrire
                    </Link>
                </p>
            </div>
        </div>
    );
}