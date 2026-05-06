import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';
import './Profile.css';

export default function Profile() {
    const { user, token, login, logout } = useAuth();
    const navigate = useNavigate();

    const authHeaders = useMemo(() => ({
        headers: { Authorization: `Bearer ${token}` }
    }), [token]);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const [form, setForm] = useState({
        username: '',
        age: '',
        sexe: '',
        ville: '',
        pays: ''
    });

    useEffect(() => {
        if (!user || !token) {
            navigate('/login');
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                setError('');
                setSuccess('');
                setLoading(true);
                const res = await axios.get(`${API_URL}/users/me`, authHeaders);
                if (cancelled) return;
                const u = res.data?.user;
                setForm({
                    username: u?.username || '',
                    age: (u?.age ?? '').toString(),
                    sexe: u?.sexe || '',
                    ville: u?.ville || '',
                    pays: u?.pays || ''
                });
            } catch (err) {
                const msg = err.response?.data?.error || 'Impossible de charger le profil';
                setError(msg);
                if (err.response?.status === 401) {
                    logout();
                    navigate('/login');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [authHeaders, logout, navigate, token, user]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setError('');
            setSuccess('');
            setSaving(true);

            const payload = {
                username: form.username,
                age: form.age === '' ? undefined : Number(form.age),
                sexe: form.sexe,
                ville: form.ville,
                pays: form.pays
            };

            const res = await axios.put(`${API_URL}/users/me`, payload, authHeaders);
            // Keep AuthContext in sync (navbar username + token payload).
            login(res.data.user, res.data.token);
            setSuccess('Profil mis à jour.');
        } catch (err) {
            const msg = err.response?.data?.error || 'Impossible de sauvegarder le profil';
            setError(msg);
            if (err.response?.status === 401) {
                logout();
                navigate('/login');
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="wera-profile">
            <div className="wera-profile__card">
                <h2 className="wera-profile__title">Mon profil</h2>
                <p className="wera-profile__subtitle">Modifie tes informations.</p>

                {error && <div className="wera-profile__alert wera-profile__alert--error">{error}</div>}
                {success && <div className="wera-profile__alert wera-profile__alert--success">{success}</div>}

                {loading ? (
                    <div className="wera-profile__loading">Chargement…</div>
                ) : (
                    <form onSubmit={handleSubmit} className="wera-profile__form">
                        <label className="wera-profile__field">
                            <span className="wera-profile__label">Username</span>
                            <input
                                value={form.username}
                                onChange={(e) => setForm({ ...form, username: e.target.value })}
                                className="wera-profile__input"
                                placeholder="username"
                                autoComplete="username"
                                required
                            />
                        </label>

                        <div className="wera-profile__grid">
                            <label className="wera-profile__field">
                                <span className="wera-profile__label">Âge</span>
                                <input
                                    type="number"
                                    min="13"
                                    max="120"
                                    value={form.age}
                                    onChange={(e) => setForm({ ...form, age: e.target.value })}
                                    className="wera-profile__input"
                                    placeholder="18"
                                    required
                                />
                            </label>

                            <label className="wera-profile__field">
                                <span className="wera-profile__label">Sexe</span>
                                <select
                                    value={form.sexe}
                                    onChange={(e) => setForm({ ...form, sexe: e.target.value })}
                                    className="wera-profile__input"
                                    required
                                >
                                    <option value="">Choisir…</option>
                                    <option value="Homme">Homme</option>
                                    <option value="Femme">Femme</option>
                                    <option value="Autre">Autre</option>
                                </select>
                            </label>
                        </div>

                        <label className="wera-profile__field">
                            <span className="wera-profile__label">Ville</span>
                            <input
                                value={form.ville}
                                onChange={(e) => setForm({ ...form, ville: e.target.value })}
                                className="wera-profile__input"
                                placeholder="Antananarivo"
                                required
                            />
                        </label>

                        <label className="wera-profile__field">
                            <span className="wera-profile__label">Pays</span>
                            <input
                                value={form.pays}
                                onChange={(e) => setForm({ ...form, pays: e.target.value })}
                                className="wera-profile__input"
                                placeholder="Madagascar"
                                required
                            />
                        </label>

                        <button className="wera-profile__button" disabled={saving} type="submit">
                            {saving ? 'Enregistrement…' : 'Enregistrer'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

