import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { useMediaQuery } from '../hooks/useMediaQuery';

export default function Home() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [locationOk, setLocationOk] = useState(null);
    const isNarrow = useMediaQuery('(max-width: 900px)');

    useEffect(() => {
        axios.get(`${import.meta.env.VITE_API_URL}/api/check-location`)
            .then(res => setLocationOk(res.data.allowed))
            .catch(() => setLocationOk(true));
    }, []);

    const handleStart = () => {
        if (!user) return navigate('/login');
        navigate('/chat');
    };

    if (locationOk === false) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '80vh', flexDirection: 'column', gap: '1rem', textAlign: 'center'
            }}>
                <div style={{ fontSize: '48px' }}>🇲🇬</div>
                <h2 style={{ fontSize: '24px' }}>Wera dia ho an'ny Malagasy ihany</h2>
                <p style={{ color: '#666' }}>
                    Cette application est réservée aux utilisateurs situés à Madagascar.
                </p>
            </div>
        );
    }

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr',
            minHeight: 'calc(100dvh - 57px)'
        }}>

            {/* Côté gauche - jaune */}
            <div style={{
                background: 'var(--yellow)',
                padding: '3rem 2.5rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                position: 'relative'
            }}>
                <h1 style={{
                    fontFamily: "'Black Han Sans', sans-serif",
                    fontSize: 'clamp(48px, 6vw, 80px)',
                    lineHeight: 1,
                    color: '#111',
                    textTransform: 'uppercase',
                    letterSpacing: '-1px'
                }}>
                    NAHITA<br />AKAMA<br />IHANY
                </h1>

                {/* Bouton téléphone */}
                <button
                    onClick={handleStart}
                    style={{
                        position: isNarrow ? 'static' : 'absolute',
                        top: isNarrow ? undefined : '50%',
                        right: isNarrow ? undefined : '-28px',
                        transform: isNarrow ? 'none' : 'translateY(-50%)',
                        width: '56px', height: '56px',
                        borderRadius: '50%',
                        background: '#333',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 10,
                        transition: 'transform 0.2s',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}
                    onMouseEnter={e => {
                        if (!isNarrow) e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)';
                        else e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={e => {
                        if (!isNarrow) e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                        else e.currentTarget.style.transform = 'scale(1)';
                    }}
                    title="Commencer"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                        stroke="#FFE000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.59 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.02z" />
                    </svg>
                </button>
            </div>

            {/* Côté droit - photo */}
            <div style={{
                background: '#b5cce0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: isNarrow ? '320px' : '500px',
                overflow: 'hidden'
            }}>
                <div style={{ textAlign: 'center', color: '#fff', opacity: 0.7 }}>
                    <div style={{ fontSize: '48px', marginBottom: '1rem' }}>🇲🇬</div>
                    <p style={{ fontSize: '14px' }}>
                        Remplace cette zone par<br />une belle photo de Madagascar
                    </p>
                    <p style={{ fontSize: '12px', marginTop: '0.5rem', opacity: 0.6 }}>
                        (dossier: frontend/public/hero.jpg)
                    </p>
                </div>
            </div>

        </div>
    );
}