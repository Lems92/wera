import { useEffect, useState } from 'react';
import axios from 'axios';

export default function Home() {
    const [locationOk, setLocationOk] = useState(null);

    useEffect(() => {
        axios.get(`${import.meta.env.VITE_API_URL}/api/check-location`)
            .then(res => setLocationOk(res.data.allowed))
            .catch(() => setLocationOk(true));
    }, []);

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
        <div style={{ padding: '0 1rem' }}>
            <div
                style={{
                    position: 'relative',
                    width: '100%',
                    height: 0,
                    paddingTop: '56.2225%',
                    paddingBottom: 0,
                    boxShadow: '0 2px 8px 0 rgba(63,69,81,0.16)',
                    marginTop: '1.6em',
                    marginBottom: '0.9em',
                    overflow: 'hidden',
                    borderRadius: '8px',
                    willChange: 'transform'
                }}
            >
                <iframe
                    loading="lazy"
                    style={{
                        position: 'absolute',
                        width: '100%',
                        height: '100%',
                        top: 0,
                        left: 0,
                        border: 'none',
                        padding: 0,
                        margin: 0
                    }}
                    src="https://www.canva.com/design/DAHH2vqNTgg/8JsDs6aRngf4IG_W6iIEjg/view?embed"
                    allowFullScreen
                    allow="fullscreen"
                    title="NAHITA AKAMA IHANY"
                />
            </div>
            <a
                href="https://www.canva.com/design/DAHH2vqNTgg/8JsDs6aRngf4IG_W6iIEjg/view?utm_content=DAHH2vqNTgg&utm_campaign=designshare&utm_medium=embeds&utm_source=link"
                target="_blank"
                rel="noopener"
            >
                NAHITA AKAMA IHANY
            </a>
        </div>
    );
}