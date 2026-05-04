import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Navbar.css';

export default function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isHome = location.pathname === '/';

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    return (
        <header className={`wera-navbar ${isHome ? 'wera-navbar--home' : 'wera-navbar--app'}`}>
            <Link to="/" className="wera-navbar__logo">wera</Link>
            <nav className="wera-navbar__links" aria-label="Primary">
                {!user ? (
                    <>
                        <Link className="wera-navbar__link" to="/login">Se Connecter</Link>
                        <Link className="wera-navbar__link" to="/register">Nouveau compte</Link>
                    </>
                ) : (
                    <span className="wera-navbar__link">Salut, {user.username}</span>
                )}

                <Link className="wera-navbar__link" to="/about">A Propos</Link>
                <Link className="wera-navbar__link" to="/contact">Contact</Link>

                {user && (
                    <button className="wera-navbar__button" onClick={handleLogout}>
                        Déconnexion
                    </button>
                )}
            </nav>
        </header>
    );
}