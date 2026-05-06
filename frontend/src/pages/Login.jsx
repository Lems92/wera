import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';
import './Login.css';

export default function Login() {
    const [form, setForm] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();
    const googleBtnRef = useRef(null);

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
            setSubmitting(true);
            const res = await axios.post(`${API_URL}/auth/login`, form);
            login(res.data.user, res.data.token);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Erreur de connexion');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="wera-login">
            <div className="wera-login__split">
                <section className="wera-login__left" aria-label="Connexion">
                    <div className="wera-login__card">
                        <div className="wera-login__cardHeader">
                            <h2 className="wera-login__title">Se connecter</h2>
                        </div>

                        <div className="wera-login__google">
                            <div ref={googleBtnRef} />
                        </div>

                        <div className="wera-login__divider" aria-hidden="true">
                            <span className="wera-login__dividerLine" />
                            <span className="wera-login__dividerText">ou</span>
                            <span className="wera-login__dividerLine" />
                        </div>

                        {error && (
                            <div className="wera-login__alert wera-login__alert--error">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="wera-login__form">
                            <input
                                type="email"
                                placeholder="Adresse Email"
                                value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })}
                                required
                                className="wera-login__input"
                            />
                            <input
                                type="password"
                                placeholder="Mot de Passe"
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                                required
                                className="wera-login__input"
                            />

                            <button disabled={submitting} type="submit" className="wera-login__button">
                                {submitting ? 'Connexion…' : 'Se connecter'}
                            </button>
                        </form>

                        <p className="wera-login__footer">
                            Pas encore de compte ?{' '}
                            <Link to="/register" className="wera-login__footerLink">
                                S&apos;inscrire
                            </Link>
                        </p>
                    </div>
                </section>

                <section className="wera-login__right" aria-label="Aperçu">
                    <div className="wera-login__rightOverlay">
                        <div className="wera-login__headline">
                            <div className="wera-login__headlineText">
                                MIRESAKA, MIZARA<br />
                                N&apos;IZA N&apos;IZA<br />
                                N&apos;AIZA N&apos;AIZA
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <div className="wera-login__centerLogo" aria-hidden="true">
                <img src="/wera.png" alt="" className="wera-login__centerLogoImg" />
            </div>
        </div>
    );
}