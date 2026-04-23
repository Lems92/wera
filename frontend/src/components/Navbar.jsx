import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMediaQuery } from '../hooks/useMediaQuery';

export default function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const isMobile = useMediaQuery('(max-width: 600px)');

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    return (
        <nav style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? '1rem' : '2rem',
            padding: isMobile ? '0.75rem 1rem' : '0.9rem 2rem',
            borderBottom: '1px solid #e5e5e5',
            background: '#fff',
            fontSize: '14px',
            fontWeight: '500',
            flexWrap: 'wrap'
        }}>
            <Link to="/" style={{
                fontSize: '22px', fontWeight: '700', letterSpacing: '-1px',
                border: '2.5px solid #111', borderRadius: '8px',
                padding: '2px 10px', color: '#111', textDecoration: 'none'
            }}>
                wera
            </Link>

            {!user ? (
                <>
                    <Link to="/login" style={{ color: '#111', textDecoration: 'none' }}>
                        Se Connecter
                    </Link>
                    <Link to="/register" style={{ color: '#111', textDecoration: 'none' }}>
                        Nouveau Compte
                    </Link>
                </>
            ) : (
                <span style={{ color: '#111' }}>Salut, {user.username} 👋</span>
            )}

            <div style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: isMobile ? '1rem' : '1.5rem',
                flexWrap: 'wrap',
                justifyContent: isMobile ? 'flex-start' : 'flex-end',
                flexBasis: isMobile ? '100%' : 'auto'
            }}>
                <Link to="/about" style={{ color: '#111', textDecoration: 'none' }}>A propos</Link>
                <Link to="/contact" style={{ color: '#111', textDecoration: 'none' }}>Contact</Link>
                {user && (
                    <button onClick={handleLogout} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#e00', fontSize: '14px', fontWeight: '500'
                    }}>
                        Déconnexion
                    </button>
                )}
            </div>
        </nav>
    );
}