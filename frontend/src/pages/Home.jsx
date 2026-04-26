import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { Row, Col, Button } from 'react-bootstrap';

export default function Home() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [locationOk, setLocationOk] = useState(null);

    useEffect(() => {
        axios.get(`${API_URL}/api/check-location`)
            .then(res => setLocationOk(res.data.allowed))
            .catch(() => setLocationOk(true));
    }, []);

    const handleStart = () => {
        if (!user) return navigate('/login');
        navigate('/chat');
    };

    if (locationOk === false) {
        return (
            <div className="d-flex flex-column align-items-center justify-content-center text-center p-5" style={{ minHeight: '80vh' }}>
                <div style={{ fontSize: '48px' }}>🇲🇬</div>
                <h2 className="fw-bold">Wera dia ho an'ny Malagasy ihany</h2>
                <p className="text-muted">
                    Cette application est réservée aux utilisateurs situés à Madagascar.
                </p>
            </div>
        );
    }

    return (
        <div className="overflow-hidden min-vh-100">
            <Row className="g-0 min-vh-100">
                {/* Côté gauche - jaune */}
                <Col lg={6} className="bg-warning p-4 p-md-5 d-flex flex-column justify-content-between position-relative" style={{ minHeight: '50vh', background: '#FFEC3D !important' }}>
                    
                    {/* Spacer for navbar */}
                    <div className="mt-5 pt-5 d-none d-lg-block"></div>

                    <div className="ps-md-4 flex-grow-1 d-flex flex-column justify-content-center">
                        <div className="d-flex align-items-center mb-4 ms-md-5 translate-middle-y" style={{ marginTop: '20vh' }}>
                            <h2 className="fw-bold mb-0 me-3" style={{ fontSize: '2.5rem', color: '#1A2332', fontFamily: "'Outfit', sans-serif" }}>Tairo ary</h2>
                            {/* Decorative Arrow */}
                            <svg width="100" height="60" viewBox="0 0 100 60" fill="none" className="d-none d-md-block">
                                <path d="M10 20C30 10 70 10 90 50" stroke="#1A2332" strokeWidth="3" strokeLinecap="round"/>
                                <path d="M80 45L90 50L95 40" stroke="#1A2332" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </div>
                    </div>

                    <h1 className="fw-bold text-uppercase p-4 p-md-5 mb-0" style={{ 
                        fontSize: 'clamp(40px, 8vw, 100px)', 
                        lineHeight: '0.85', 
                        color: '#1A2332',
                        fontFamily: "'Black Han Sans', sans-serif",
                        zIndex: 5
                    }}>
                        NAHITA<br />AKAMA<br />IHANY
                    </h1>

                    {/* Central Button Overlay */}
                    <Button
                        onClick={handleStart}
                        className="rounded-circle d-flex align-items-center justify-content-center shadow-lg border-0 position-absolute pulse-button"
                        style={{ 
                            width: '100px', 
                            height: '100px', 
                            zIndex: 100, 
                            left: '100%', 
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            background: '#1A2332'
                        }}
                    >
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                            stroke="#FFEC3D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.59 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.02z" />
                        </svg>
                    </Button>
                </Col>

                {/* Côté droit - photo */}
                <Col lg={6} className="position-relative overflow-hidden" style={{ minHeight: '50vh' }}>
                    <img 
                        src="/hero.png" 
                        alt="Video Call" 
                        className="w-100 h-100 object-fit-cover"
                        style={{ position: 'absolute', top: 0, left: 0 }}
                    />
                </Col>
            </Row>

            <style>{`
                .bg-warning { background-color: #FFEC3D !important; }
                
                .pulse-button {
                    animation: heartbeat 2s infinite;
                }

                @keyframes heartbeat {
                    0% {
                        transform: translate(-50%, -50%) scale(1);
                        box-shadow: 0 0 0 0 rgba(26, 35, 50, 0.7);
                    }
                    50% {
                        transform: translate(-50%, -50%) scale(1.08);
                        box-shadow: 0 0 0 25px rgba(26, 35, 50, 0);
                    }
                    100% {
                        transform: translate(-50%, -50%) scale(1);
                        box-shadow: 0 0 0 0 rgba(26, 35, 50, 0);
                    }
                }

                @media (max-width: 991px) {
                    h1 { position: static !important; margin-top: 50px !important; }
                    .rounded-circle { left: 50% !important; top: 100% !important; margin-top: -50px; }
                    
                    @keyframes heartbeat {
                        0% {
                            transform: translate(-50%, -50%) scale(1);
                        }
                        50% {
                            transform: translate(-50%, -50%) scale(1.1);
                        }
                        100% {
                            transform: translate(-50%, -50%) scale(1);
                        }
                    }
                }
            `}</style>
        </div>
    );
}