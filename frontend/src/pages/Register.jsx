import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';

function validatePassword(pw) {
    const errors = [];
    if (!pw || pw.length < 8) errors.push('Au moins 8 caractères');
    if (!/[a-z]/.test(pw)) errors.push('1 lettre minuscule');
    if (!/[A-Z]/.test(pw)) errors.push('1 lettre majuscule');
    if (!/\d/.test(pw)) errors.push('1 chiffre');
    if (!/[^\w\s]/.test(pw)) errors.push('1 caractère spécial');
    return errors;
}

export default function Register() {
    const [form, setForm] = useState({
        username: '',
        email: '',
        password: '',
        age: '',
        sexe: '',
        ville: '',
        pays: ''
    });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();
    const googleBtnRef = useRef(null);

    const passwordErrors = useMemo(() => validatePassword(form.password), [form.password]);

    useEffect(() => {
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
        if (!clientId) return;
        if (!googleBtnRef.current) return;

        let cancelled = false;
        const tryInit = () => {
            if (cancelled) return false;
            if (!window.google?.accounts?.id) return false;

            try {
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: async (response) => {
                        try {
                            setError('');
                            setSubmitting(true);
                            const res = await axios.post(`${API_URL}/auth/google`, { credential: response.credential });
                            login(res.data.user, res.data.token);
                            navigate('/');
                        } catch (err) {
                            setError(err.response?.data?.error || 'Erreur Google');
                        } finally {
                            setSubmitting(false);
                        }
                    }
                });
                googleBtnRef.current.innerHTML = '';
                window.google.accounts.id.renderButton(googleBtnRef.current, {
                    theme: 'outline',
                    size: 'large',
                    shape: 'pill',
                    width: 340,
                    text: 'continue_with'
                });
                return true;
            } catch {
                return false;
            }
        };

        // Script loads async; retry briefly.
        if (tryInit()) return () => { cancelled = true; };
        const interval = setInterval(() => {
            if (tryInit()) clearInterval(interval);
        }, 250);
        const timeout = setTimeout(() => clearInterval(interval), 5000);

        return () => {
            cancelled = true;
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [login, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setError('');
            const ageNum = Number(form.age);
            if (!Number.isInteger(ageNum) || ageNum < 13 || ageNum > 120) {
                setError("Âge invalide (13–120)");
                return;
            }
            if (passwordErrors.length) {
                setError(`Mot de passe trop faible: ${passwordErrors.join(', ')}`);
                return;
            }

            setSubmitting(true);
            const payload = {
                ...form,
                age: ageNum
            };
            const res = await axios.post(`${API_URL}/auth/register`, payload);
            login(res.data.user, res.data.token);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Erreur inscription');
        } finally {
            setSubmitting(false);
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
                    <h2 style={{ marginTop: '1rem', fontSize: '20px' }}>Créer un compte</h2>
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
                        type="text" placeholder="Nom d'utilisateur"
                        value={form.username}
                        onChange={e => setForm({ ...form, username: e.target.value })}
                        required
                        style={{
                            padding: '0.75rem 1rem', borderRadius: '8px',
                            border: '1px solid #ddd', fontSize: '15px', outline: 'none'
                        }}
                    />
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
                        type="number"
                        inputMode="numeric"
                        placeholder="Âge"
                        value={form.age}
                        onChange={e => setForm({ ...form, age: e.target.value })}
                        required
                        min={13}
                        max={120}
                        style={{
                            padding: '0.75rem 1rem', borderRadius: '8px',
                            border: '1px solid #ddd', fontSize: '15px', outline: 'none'
                        }}
                    />
                    <select
                        value={form.sexe}
                        onChange={e => setForm({ ...form, sexe: e.target.value })}
                        required
                        style={{
                            padding: '0.75rem 1rem', borderRadius: '8px',
                            border: '1px solid #ddd', fontSize: '15px', outline: 'none',
                            background: '#fff'
                        }}
                    >
                        <option value="" disabled>Sexe</option>
                        <option value="Homme">Homme</option>
                        <option value="Femme">Femme</option>
                        <option value="Autre">Autre</option>
                    </select>
                    <input
                        type="text"
                        placeholder="Ville"
                        value={form.ville}
                        onChange={e => setForm({ ...form, ville: e.target.value })}
                        required
                        style={{
                            padding: '0.75rem 1rem', borderRadius: '8px',
                            border: '1px solid #ddd', fontSize: '15px', outline: 'none'
                        }}
                    />
                    <input
                        type="text"
                        placeholder="Pays"
                        value={form.pays}
                        onChange={e => setForm({ ...form, pays: e.target.value })}
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
                    {form.password && passwordErrors.length > 0 && (
                        <div style={{
                            fontSize: '12px',
                            color: '#666',
                            background: '#f7f7f7',
                            border: '1px solid #eee',
                            borderRadius: '8px',
                            padding: '0.75rem 1rem'
                        }}>
                            Mot de passe: {passwordErrors.join(' · ')}
                        </div>
                    )}

                    <button disabled={submitting} type="submit" style={{
                        background: 'var(--yellow)', color: '#111',
                        border: 'none', padding: '0.85rem',
                        borderRadius: '8px', fontSize: '15px',
                        fontWeight: '600', cursor: submitting ? 'not-allowed' : 'pointer',
                        opacity: submitting ? 0.7 : 1
                    }}>
                        S'inscrire
                    </button>
                </form>

                <div style={{ marginTop: '1rem' }}>
                    <div ref={googleBtnRef} />
                </div>

                <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '14px', color: '#666' }}>
                    Déjà un compte ?{' '}
                    <Link to="/login" style={{ color: '#111', fontWeight: '600' }}>
                        Se connecter
                    </Link>
                </p>
            </div>
        </div>
    );
}