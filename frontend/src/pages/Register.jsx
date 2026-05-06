import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';
import './Register.css';

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
        <div className="wera-register">
            <div className="wera-register__split">
                <section className="wera-register__left" aria-label="Inscription">
                    <div className="wera-register__card">
                        <div className="wera-register__cardHeader">
                            <h2 className="wera-register__title">Créer un compte</h2>
                        </div>

                        <div className="wera-register__google">
                            <div ref={googleBtnRef} />
                        </div>

                        <div className="wera-register__divider" aria-hidden="true">
                            <span className="wera-register__dividerLine" />
                            <span className="wera-register__dividerText">ou</span>
                            <span className="wera-register__dividerLine" />
                        </div>

                        {error && (
                            <div className="wera-register__alert wera-register__alert--error">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="wera-register__form">
                            <input
                                type="text"
                                placeholder="Nom d'utilisateur"
                                value={form.username}
                                onChange={e => setForm({ ...form, username: e.target.value })}
                                required
                                className="wera-register__input"
                            />
                            <input
                                type="email"
                                placeholder="Adresse Email"
                                value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })}
                                required
                                className="wera-register__input"
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
                                className="wera-register__input"
                            />
                            <select
                                value={form.sexe}
                                onChange={e => setForm({ ...form, sexe: e.target.value })}
                                required
                                className="wera-register__input"
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
                                className="wera-register__input"
                            />
                            <input
                                type="text"
                                placeholder="Pays"
                                value={form.pays}
                                onChange={e => setForm({ ...form, pays: e.target.value })}
                                required
                                className="wera-register__input"
                            />
                            <div className="wera-register__password">
                                <input
                                    type="password"
                                    placeholder="Mot de Passe"
                                    value={form.password}
                                    onChange={e => setForm({ ...form, password: e.target.value })}
                                    required
                                    className="wera-register__input"
                                />
                                {form.password && passwordErrors.length > 0 && (
                                    <div className="wera-register__hint">
                                        Mot de passe: {passwordErrors.join(' · ')}
                                    </div>
                                )}
                            </div>

                            <button disabled={submitting} type="submit" className="wera-register__button">
                                {submitting ? 'Création…' : 'Créer un compte'}
                            </button>
                        </form>

                        <p className="wera-register__footer">
                            Vous avez déjà un compte ?{' '}
                            <Link to="/login" className="wera-register__footerLink">
                                Connectez‑vous
                            </Link>
                        </p>
                    </div>
                </section>

                <section className="wera-register__right" aria-label="Aperçu">
                    <div className="wera-register__rightOverlay">
                        <div className="wera-register__headline">
                            <div className="wera-register__headlineText">
                                MIRESAKA MIZARA<br />
                                N&apos;IZA N&apos;IZA<br />
                                N&apos;AIZA N&apos;AIZA
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <div className="wera-register__centerLogo" aria-hidden="true">
                <img src="/wera.png" alt="" className="wera-register__centerLogoImg" />
            </div>
        </div>
    );
}