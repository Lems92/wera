import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useMediaQuery } from '../hooks/useMediaQuery';
import AdSlot from '../components/AdSlot';
import heroImg from '../assets/hero.png';

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
                justifyContent: 'space-between',
                position: 'relative'
            }}>
                {/* Tairo ary avec flèche */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    paddingTop: '1rem'
                }}>
                    <span style={{
                        fontFamily: "'Black Han Sans', sans-serif",
                        fontSize: 'clamp(20px, 2.5vw, 28px)',
                        color: '#111',
                        fontWeight: 700
                    }}>
                        Tairo ary
                    </span>
                    {/* Flèche courbée pointant vers le bouton */}
                    <svg
                        width="90" height="70"
                        viewBox="0 0 90 70"
                        fill="none"
                        style={{ marginLeft: '2rem' }}
                    >
                        <path
                            d="M 10 5 C 40 5, 80 20, 80 55"
                            stroke="#111" strokeWidth="2.5" strokeLinecap="round" fill="none"
                        />
                        <path
                            d="M 72 50 L 80 58 L 87 50"
                            stroke="#111" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
                        />
                    </svg>
                </div>

                {/* Texte principal en bas */}
                <div>
                    <h1 style={{
                        fontFamily: "'Black Han Sans', sans-serif",
                        fontSize: 'clamp(48px, 6vw, 80px)',
                        lineHeight: 1,
                        color: '#111',
                        textTransform: 'uppercase',
                        letterSpacing: '-1px',
                        margin: 0
                    }}>
                        NAHITA<br />AKAMA<br />IHANY
                    </h1>

                    <div style={{ marginTop: '1.25rem', maxWidth: '520px' }}>
                        <AdSlot placement="home" minHeight={90} style={{ background: 'rgba(255,255,255,0.6)' }} />
                    </div>
                </div>

                {/* Bouton caméra vidéo centré entre les deux colonnes */}
                <button
                    onClick={handleStart}
                    style={{
                        position: isNarrow ? 'static' : 'absolute',
                        top: isNarrow ? undefined : '50%',
                        right: isNarrow ? undefined : '-44px',
                        transform: isNarrow ? 'none' : 'translateY(-50%)',
                        width: '88px', height: '88px',
                        borderRadius: '50%',
                        background: '#111',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 10,
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
                        marginTop: isNarrow ? '1.5rem' : undefined
                    }}
                    onMouseEnter={e => {
                        if (!isNarrow) e.currentTarget.style.transform = 'translateY(-50%) scale(1.08)';
                        else e.currentTarget.style.transform = 'scale(1.06)';
                        e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.45)';
                    }}
                    onMouseLeave={e => {
                        if (!isNarrow) e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
                        else e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.35)';
                    }}
                    title="Commencer"
                >
                    {/* Icône caméra vidéo */}
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="white">
                        <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14v-4z" />
                        <rect x="2" y="7" width="13" height="10" rx="2" />
                    </svg>
                </button>
            </div>

            {/* Côté droit - photo */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: isNarrow ? '320px' : '500px',
                overflow: 'hidden',
                position: 'relative'
            }}>
                <img
                    src={heroImg}
                    alt="Wera video call"
                    style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        position: 'absolute',
                        top: 0, left: 0
                    }}
                />
            </div>

        </div>
    );
}