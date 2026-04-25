import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { Container, Row, Col, Button } from 'react-bootstrap';
import AdSlot from '../components/AdSlot';

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
            <Container className="d-flex flex-column align-items-center justify-content-center text-center" style={{ minHeight: '80vh' }}>
                <div style={{ fontSize: '48px' }}>🇲🇬</div>
                <h2 className="fw-bold">Wera dia ho an'ny Malagasy ihany</h2>
                <p className="text-muted">
                    Cette application est réservée aux utilisateurs situés à Madagascar.
                </p>
            </Container>
        );
    }

    return (
        <div className="overflow-hidden">
            <Row className="g-0 min-vh-100">
                {/* Côté gauche - jaune */}
                <Col lg={6} className="bg-warning p-4 p-md-5 d-flex flex-column justify-content-end position-relative" style={{ minHeight: '50vh' }}>
                    <h1 className="display-1 fw-bold text-uppercase lh-1 mb-4" style={{ fontFamily: "'Black Han Sans', sans-serif", letterSpacing: '-2px' }}>
                        NAHITA<br />AKAMA<br />IHANY
                    </h1>

                    <div className="mt-auto mb-4" style={{ maxWidth: '520px' }}>
                        <AdSlot placement="home" minHeight={90} style={{ background: 'rgba(255,255,255,0.3)', borderRadius: '10px' }} />
                    </div>

                    {/* Bouton d'action */}
                    <Button
                        onClick={handleStart}
                        variant="dark"
                        className="rounded-circle d-flex align-items-center justify-content-center shadow-lg border-0 position-absolute start-100 translate-middle d-none d-lg-flex"
                        style={{ width: '64px', height: '64px', zIndex: 10, left: '100%' }}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                            stroke="#ffc107" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.59 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7a2 2 0 0 1 1.72 2.02z" />
                        </svg>
                    </Button>
                    
                    {/* Bouton mobile */}
                    <Button
                        onClick={handleStart}
                        variant="dark"
                        className="rounded-pill d-lg-none mt-3 fw-bold py-3"
                    >
                        COMMENCER
                    </Button>
                </Col>

                {/* Côté droit - photo/illustration */}
                <Col lg={6} className="bg-light d-flex align-items-center justify-content-center overflow-hidden" style={{ minHeight: '40vh', background: '#b5cce0' }}>
                    <div className="text-center text-white opacity-75">
                        <div className="display-4 mb-3">🇲🇬</div>
                        <p className="lead fw-bold">
                            Mirindra sy haingana<br />Wera ho an'ny rehetra
                        </p>
                        <p className="small mt-2">
                            (Image de fond personnalisée possible)
                        </p>
                    </div>
                </Col>
            </Row>
        </div>
    );
}