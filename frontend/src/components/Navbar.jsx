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
            padding: isMobile ? '0.75rem 1rem' : '0.9rem 2rem',
            background: '#fff',
            fontSize: '15px',
            fontWeight: '600',
        }}>
            <Link to="/" style={{
                fontSize: '22px',
                fontWeight: '700',
                background: '#f5f0c8',
                borderRadius: '50px',
                padding: '4px 18px',
                color: '#111',
                textDecoration: 'none',
                letterSpacing: '-0.5px',
                flexShrink: 0,
            }}>
                wera
            </Link>

            <div style={{
                display: 'flex',
                gap: isMobile ? '1rem' : '2rem',
                marginLeft: isMobile ? '1rem' : '2.5rem',
                alignItems: 'center',
            }}>
                {!user ? (
                    <>
                        <Link to="/login" style={{ color: '#111', textDecoration: 'none' }}>
                            Se Connecter
                        </Link>
                        <Link to="/register" style={{ color: '#111', textDecoration: 'none' }}>
                            Nouveau compte
                        </Link>
                    </>
                ) : (
                    <span style={{ color: '#111' }}>Salut, {user.username} 👋</span>
                )}
            </div>

            <div style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: isMobile ? '1rem' : '2rem',
                alignItems: 'center',
            }}>
                <Link to="/about" style={{ color: '#111', textDecoration: 'none' }}>A Propos</Link>
                <Link to="/contact" style={{ color: '#111', textDecoration: 'none' }}>Contact</Link>
                {user && (
                    <button onClick={handleLogout} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#e00', fontSize: '15px', fontWeight: '600'
                    }}>
                        Déconnexion
                    </button>
                )}
            </div>
        </nav>
    );
}