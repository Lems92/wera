import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import axios from 'axios';
import './Home.css';

export default function Home() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [locationOk, setLocationOk] = useState(null);

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
        <div className="wera-landing">
            <section className="hero">
                <div className="left">
                    <div className="subtitle">Tairo ary</div>

                    <svg className="arrow" viewBox="0 0 200 100" aria-hidden="true">
                        <path
                            d="M10 20 C 100 0, 140 60, 180 80"
                            stroke="#000"
                            strokeWidth="3"
                            fill="none"
                        />
                        <polygon points="170,75 190,80 175,95" fill="#000" />
                    </svg>

                    <div className="title">
                        NAHITA<br />
                        AKAMA<br />
                        IHANY
                    </div>
                </div>

                <button className="video-btn" onClick={handleStart} title="Commencer" aria-label="Commencer">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M17 10.5V7c0-1.1-.9-2-2-2H5C3.9 5 3 5.9 3 7v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-3.5l4 4v-11l-4 4z" />
                    </svg>
                </button>

                <div className="right">
                    <img
                        src="/landing2.png"
                        alt=""
                    />
                </div>
            </section>
        </div>
    );
}