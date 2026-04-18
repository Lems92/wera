import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    return (
        <nav style={{
            display: 'flex', alignItems: 'center', gap: '2rem',
            padding: '0.9rem 2rem',
            borderBottom: '1px solid #e5e5e5',
            background: '#fff',
            fontSize: '14px',
            fontWeight: '500'
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

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem' }}>
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